/* /api/genui/*: the app's side of generative UI (packages/genui, web2/src/genui).
     GET  /api/genui/events?session=    SSE of AgentToUI frames: ui.ops, ui.end, ui.text, turn, say
     POST /api/genui/turn    {session, prompt}        the person's message starts a turn
     POST /api/genui/action  {session, action}        a click: actionToPrompt(action) goes in as a user message
     POST /api/genui/repair  {session, diagnostics}    the repair round: {ops} or {text}
     POST /api/genui/ingest?session=&key=  {surface, ops, done}   the MCP `ui` tool delivers here
     GET  /api/genui/surfaces?chat=      the settled surfaces saved with a chat (genuiStore.ts)
     POST /api/genui/surfaces            {chat, turn, surface, spec}   keep the final spec of one surface

   THE SESSION. A `session` is the id the SSE client subscribes with, and the id an ingest names. The app
   gives a spawned agent's MCP server `SEQUENCE_GENUI_URL=<origin>/api/genui/ingest?session=<chat id>&key=<key>`
   (sequenceMcp.ts, `genuiIngestUrl`), so a surface an agent draws reaches the chat that owns that agent session
   and no other. A chat opens `events?session=<its chat id>`.

   THE HUB. Frames are fanned out to the open streams of a session. The ops of a surface that has not finished yet
   are kept, so a stream that connects mid-turn (a reload) is caught up and then follows live; once a surface is
   `done` it is dropped from the hub (the client saves the settled spec with the turn, genuiStore.ts).

   WHO MAY CALL. The browser routes are session-gated under auth (SENSITIVE_EXACT in repoServer.ts). `ingest` is
   called by the agent's MCP process, which has no cookie: it takes a key derived from the chat id (HMAC under a process secret) that only the URL holds, and
   only from this machine. Nothing the agent sends is trusted: the client validates every op against the catalog. */

import crypto from 'node:crypto';
import type http from 'node:http';

import { actionToPrompt, type UIAction, type UIOp } from '@sequence/genui';

import { peerIsLoopback } from './agentEvents.js';
import { GENUI_SPEC_MAX_BYTES, GenuiStoreError, listSurfaces, saveSurface } from './genuiStore.js';
import { startSse } from './routeHttp.js';
import { isOriginAllowed } from './terminal.js';

export type AgentToUIFrame =
  | { kind: 'ui.text'; surfaceId: string; chunk: string }
  | { kind: 'ui.ops'; surfaceId: string; ops: UIOp[] }
  | { kind: 'ui.end'; surfaceId: string }
  | { kind: 'turn'; busy: boolean; label?: string }
  | { kind: 'say'; text: string }
  /** The surface outgrew the hub's replay budget: a client that joined late has no base for it and must not apply the tail. */
  | { kind: 'ui.reset'; surfaceId: string; reason: 'replay-unavailable' };

/** What answers a turn, a click or a repair round. The app attaches one that drives the chat's agent; none is attached by default. */
export interface GenuiRunner {
  turn?(session: string, prompt: string, hub: GenuiHub): void | Promise<void>;
  action?(session: string, prompt: string, action: UIAction, hub: GenuiHub): void | Promise<void>;
  repair?(session: string, prompt: string, hub: GenuiHub): Promise<{ ops?: unknown[]; text?: string } | null>;
}

/* A chat or surface id: printable, no spaces, short. Chat ids are the app's own (any plain token). */
// eslint-disable-next-line no-control-regex
const ID_RE = /^[^\s\u0000-\u001f\u007f]{1,200}$/;
/** Most ops one ingest may carry, and the most the hub keeps for one unfinished surface. */
export const INGEST_MAX_OPS = 500;
const BACKLOG_MAX_OPS = 2000;
/** Open surfaces one chat keeps a replay record for. The oldest beyond this loses its replay (a late client is told so). */
const BACKLOG_MAX_SURFACES = 64;
const HEARTBEAT_MS = 20_000;
/** Chats the hub keeps a replay record for, and how long an idle one (no open stream) is kept. A caller may invent session ids, so both are bounded. */
export const GENUI_MAX_SESSIONS = 256;
export const GENUI_IDLE_MS = 30 * 60_000;

export interface GenuiHubOptions {
  maxSessions?: number;
  idleMs?: number;
  now?: () => number;
}

/** What the hub knows of one open surface. `entries` is empty and `unavailable` true once it outgrew the replay budget. */
interface SurfaceRecord {
  entries: { id: number; ops: UIOp[] }[];
  opCount: number;
  lastId: number;
  unavailable: boolean;
}

interface SessionState {
  seq: number;
  touched: number;
  surfaces: Map<string, SurfaceRecord>;
}

export class GenuiHub {
  /** The process secret the per-chat keys are derived from. It never leaves this process. */
  private readonly secret = crypto.randomBytes(32);
  /** Per open stream: the surfaces it cannot be given a faithful replay of, so it is sent nothing more of them. */
  private streams = new Map<string, Map<http.ServerResponse, Set<string>>>();
  private sessions = new Map<string, SessionState>();
  private readonly maxSessions: number;
  private readonly idleMs: number;
  private readonly now: () => number;

  constructor(opts: GenuiHubOptions = {}) {
    this.maxSessions = opts.maxSessions ?? GENUI_MAX_SESSIONS;
    this.idleMs = opts.idleMs ?? GENUI_IDLE_MS;
    this.now = opts.now ?? Date.now;
  }

  /** The URL an agent's MCP server posts surfaces to, for the chat that owns the agent. */
  ingestUrl(port: number, session: string): string {
    return `http://127.0.0.1:${port}/api/genui/ingest?session=${encodeURIComponent(session)}&key=${this.keyFor(session)}`;
  }

  /** The ingest key of ONE chat: an HMAC of its id under the process secret. A key for chat A is refused for chat B. */
  keyFor(session: string): string {
    return crypto.createHmac('sha256', this.secret).update(session).digest('hex').slice(0, 32);
  }

  keyOk(session: string, k: string | null): boolean {
    if (!k) return false;
    const a = Buffer.from(k);
    const b = Buffer.from(this.keyFor(session));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Streams open for a session (tests and diagnostics). */
  streamCount(session: string): number {
    return this.streams.get(session)?.size ?? 0;
  }

  /** Chats with a replay record (tests and diagnostics). */
  sessionCount(): number {
    return this.sessions.size;
  }

  /** Drop the records of chats nobody is watching: idle past the limit, then the least recently used while over the cap. */
  private prune(keep: string): void {
    const t = this.now();
    for (const [id, st] of this.sessions) {
      if (id !== keep && t - st.touched > this.idleMs && !this.streams.has(id)) this.sessions.delete(id);
    }
    if (this.sessions.size < this.maxSessions) return;
    const idle = [...this.sessions].filter(([id]) => id !== keep && !this.streams.has(id)).sort((x, y) => x[1].touched - y[1].touched);
    for (const [id] of idle) {
      if (this.sessions.size < this.maxSessions) break;
      this.sessions.delete(id);
    }
  }

  private state(session: string): SessionState {
    let st = this.sessions.get(session);
    if (!st) {
      this.prune(session);
      this.sessions.set(session, (st = { seq: 0, touched: this.now(), surfaces: new Map() }));
    }
    st.touched = this.now();
    return st;
  }

  publish(session: string, frame: AgentToUIFrame): void {
    const st = this.state(session);
    const id = ++st.seq;
    if (frame.kind === 'ui.ops') {
      let rec = st.surfaces.get(frame.surfaceId);
      if (!rec) {
        if (st.surfaces.size >= BACKLOG_MAX_SURFACES) {
          /* the oldest open surface loses its replay but stays as a marker, so a late client is told rather than given a tail */
          const oldest = st.surfaces.values().next().value as SurfaceRecord;
          if (!oldest.unavailable) dropReplay(oldest);
          else st.surfaces.delete(st.surfaces.keys().next().value as string);
        }
        st.surfaces.set(frame.surfaceId, (rec = { entries: [], opCount: 0, lastId: id, unavailable: false }));
      }
      rec.lastId = id;
      if (!rec.unavailable) {
        if (rec.opCount + frame.ops.length <= BACKLOG_MAX_OPS) {
          rec.entries.push({ id, ops: frame.ops });
          rec.opCount += frame.ops.length;
        } else {
          /* Too long to replay faithfully. A late client is NOT given the tail: it is told the replay is unavailable. */
          dropReplay(rec);
        }
      }
    }
    const surfaceId = 'surfaceId' in frame ? frame.surfaceId : null;
    for (const [res, stale] of [...(this.streams.get(session) ?? [])]) {
      if (res.writableEnded || res.destroyed) continue;
      /* a client that joined after this surface lost its replay has no base for it: it is sent nothing more of it */
      if (surfaceId !== null && stale.has(surfaceId)) {
        if (frame.kind === 'ui.end') stale.delete(surfaceId);
        continue;
      }
      try {
        writeEvent(res, id, frame);
      } catch {
        /* a dead socket is removed by its close handler */
      }
    }
    if (frame.kind === 'ui.end') st.surfaces.delete(frame.surfaceId);
  }

  /**
   * Attach an SSE response. A new client is caught up on every unfinished surface. A reconnecting one (EventSource sends
   * `Last-Event-ID`) receives only what it missed, so a non-idempotent append is not applied twice. A surface whose replay
   * was dropped is announced with `ui.reset` instead of a tail with no base. Returns the detach.
   */
  attach(session: string, res: http.ServerResponse, lastEventId?: number | null): () => void {
    let set = this.streams.get(session);
    if (!set) this.streams.set(session, (set = new Map()));
    const stale = new Set<string>();
    set.set(res, stale);
    const st = this.sessions.get(session);
    if (st) {
      st.touched = this.now();
      /* an id ahead of ours is from before a restart or from another run: treat the client as new */
      const after = typeof lastEventId === 'number' && Number.isInteger(lastEventId) && lastEventId > 0 && lastEventId <= st.seq ? lastEventId : 0;
      const out: { id: number; frame: AgentToUIFrame }[] = [];
      for (const [surfaceId, rec] of st.surfaces) {
        if (rec.unavailable) {
          if (rec.lastId > after) {
            stale.add(surfaceId);
            out.push({ id: rec.lastId, frame: { kind: 'ui.reset', surfaceId, reason: 'replay-unavailable' } });
          }
          continue;
        }
        const missed = rec.entries.filter((e) => e.id > after);
        if (missed.length === 0) continue;
        out.push({ id: missed[missed.length - 1]!.id, frame: { kind: 'ui.ops', surfaceId, ops: missed.flatMap((e) => e.ops) } });
      }
      /* ascending ids, so the last id the client holds covers everything it was sent */
      for (const o of out.sort((x, y) => x.id - y.id)) writeEvent(res, o.id, o.frame);
    }
    const beat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(': ping\n\n');
    }, HEARTBEAT_MS);
    beat.unref();
    return () => {
      clearInterval(beat);
      set!.delete(res);
      if (set!.size === 0 && this.streams.get(session) === set) this.streams.delete(session);
    };
  }
}

function dropReplay(rec: SurfaceRecord): void {
  rec.entries = [];
  rec.opCount = 0;
  rec.unavailable = true;
}

/** One SSE event with an id, so EventSource sends `Last-Event-ID` on reconnect. */
function writeEvent(res: http.ServerResponse, id: number, frame: AgentToUIFrame): void {
  res.write(`id: ${id}\ndata: ${JSON.stringify(frame)}\n\n`);
}

/** The one hub of this server process. */
export const genuiHub = new GenuiHub();

/** The `SEQUENCE_GENUI_URL` for the MCP server of an agent session that belongs to `session` (a chat). */
export const genuiIngestUrl = (port: number, session: string): string => genuiHub.ingestUrl(port, session);

export interface GenuiRouteDeps {
  root: string | null;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void;
  sendError: (res: http.ServerResponse, status: number, message: string) => void;
  /** The cross-tenant owner check: true when it has already answered 403. */
  requireOwner?: () => boolean;
  hub?: GenuiHub;
  runner?: GenuiRunner;
}

async function json(req: http.IncomingMessage, deps: GenuiRouteDeps, res: http.ServerResponse): Promise<Record<string, unknown> | null> {
  try {
    const v = JSON.parse((await deps.readBody(req)) || '{}') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch (e) {
    const big = e instanceof Error && /too large/.test(e.message);
    deps.sendError(res, big ? 413 : 400, big ? 'the request is too large' : 'invalid JSON');
    return null;
  }
  deps.sendError(res, 400, 'expected a JSON object');
  return null;
}

export async function handleGenuiRoute(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, deps: GenuiRouteDeps): Promise<boolean> {
  if (!pathname.startsWith('/api/genui/')) return false;
  const hub = deps.hub ?? genuiHub;
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? pathname, 'http://x');
  const route = pathname.slice('/api/genui/'.length);

  /* The agent's door: this machine only, with the key, never the owner check (the MCP process has no cookie). */
  if (route === 'ingest') {
    if (method !== 'POST') return void deps.sendError(res, 405, 'method not allowed'), true;
    if (!isOriginAllowed(req) || !peerIsLoopback(req)) return void deps.sendError(res, 403, 'genui ingest is local-only'), true;
    /* The chat is named by the URL only: a body `session` would let one chat's key post into another. */
    const session = url.searchParams.get('session') ?? 'default';
    if (!hub.keyOk(session, url.searchParams.get('key'))) return void deps.sendError(res, 403, 'bad ingest key'), true;
    const b = await json(req, deps, res);
    if (!b) return true;
    const surface = typeof b.surface === 'string' ? b.surface : 'main';
    if (!ID_RE.test(session) || !ID_RE.test(surface)) return void deps.sendError(res, 400, 'session and surface must be short plain ids'), true;
    const ops = b.ops === undefined ? [] : b.ops;
    if (!Array.isArray(ops) || ops.length > INGEST_MAX_OPS || ops.some((o) => !o || typeof o !== 'object' || Array.isArray(o) || typeof (o as { op?: unknown }).op !== 'string')) {
      return void deps.sendError(res, 400, `ops must be an array of at most ${INGEST_MAX_OPS} op objects`), true;
    }
    if (ops.length > 0) hub.publish(session, { kind: 'ui.ops', surfaceId: surface, ops: ops as UIOp[] });
    if (b.done === true) hub.publish(session, { kind: 'ui.end', surfaceId: surface });
    return void deps.sendJson(res, 200, { ok: true, ops: ops.length, subscribers: hub.streamCount(session) }), true;
  }

  if (deps.requireOwner?.()) return true;

  if (route === 'events') {
    if (method !== 'GET') return void deps.sendError(res, 405, 'method not allowed'), true;
    const session = url.searchParams.get('session') ?? 'default';
    if (!ID_RE.test(session)) return void deps.sendError(res, 400, 'session must be a short plain id'), true;
    startSse(res);
    const last = Number(req.headers['last-event-id']);
    const detach = hub.attach(session, res, Number.isInteger(last) ? last : null);
    req.on('close', detach);
    return true;
  }

  if (route === 'surfaces') {
    const root = deps.root;
    if (root === null) return void deps.sendError(res, 409, 'no project open'), true;
    try {
      if (method === 'GET') return void deps.sendJson(res, 200, { surfaces: listSurfaces(root, url.searchParams.get('chat') ?? '') }), true;
      if (method === 'POST') {
        /* An oversize body is a 413 up front: the shared body reader would destroy the socket instead. */
        if (Number(req.headers['content-length'] ?? 0) > GENUI_SPEC_MAX_BYTES * 2) return void deps.sendError(res, 413, `a surface is at most ${GENUI_SPEC_MAX_BYTES} bytes`), true;
        const b = await json(req, deps, res);
        if (!b) return true;
        const r = saveSurface(root, { chat: String(b.chat ?? ''), turn: String(b.turn ?? ''), surface: String(b.surface ?? ''), spec: b.spec, ...(typeof b.at === 'number' ? { at: b.at } : {}) });
        return void deps.sendJson(res, r.created ? 201 : 200, r), true;
      }
    } catch (e) {
      if (e instanceof GenuiStoreError) return void deps.sendError(res, e.status, e.message), true;
      throw e;
    }
    return void deps.sendError(res, 405, 'method not allowed'), true;
  }

  if (route === 'turn' || route === 'action' || route === 'repair') {
    if (method !== 'POST') return void deps.sendError(res, 405, 'method not allowed'), true;
    const b = await json(req, deps, res);
    if (!b) return true;
    const session = typeof b.session === 'string' ? b.session : 'default';
    if (!ID_RE.test(session)) return void deps.sendError(res, 400, 'session must be a short plain id'), true;
    if (route === 'turn') {
      if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 20_000) return void deps.sendError(res, 400, 'prompt must be a non-empty string of at most 20000 characters'), true;
      await deps.runner?.turn?.(session, b.prompt, hub);
      return void deps.sendJson(res, 202, { accepted: true, runner: Boolean(deps.runner?.turn) }), true;
    }
    if (route === 'action') {
      const a = b.action as Partial<UIAction> | undefined;
      if (!a || a.kind !== 'ui.action' || typeof a.name !== 'string' || typeof a.surfaceId !== 'string' || typeof a.elementId !== 'string' || !a.name || a.name.length > 128) {
        return void deps.sendError(res, 400, 'action must be a ui.action with name, surfaceId and elementId'), true;
      }
      const action: UIAction = { kind: 'ui.action', name: a.name, surfaceId: a.surfaceId, elementId: a.elementId, params: a.params && typeof a.params === 'object' && !Array.isArray(a.params) ? a.params : {}, state: a.state && typeof a.state === 'object' && !Array.isArray(a.state) ? a.state : {}, at: typeof a.at === 'number' ? a.at : Date.now() };
      const prompt = actionToPrompt(action);
      await deps.runner?.action?.(session, prompt, action, hub);
      return void deps.sendJson(res, 202, { accepted: true, runner: Boolean(deps.runner?.action), prompt }), true;
    }
    const d = b.diagnostics as { prompt?: unknown } | undefined;
    if (!d || typeof d.prompt !== 'string' || !d.prompt) return void deps.sendError(res, 400, 'diagnostics.prompt is required'), true;
    if (!deps.runner?.repair) return void deps.sendError(res, 501, 'no agent is attached to answer a repair round'), true;
    const out = await deps.runner.repair(session, d.prompt, hub);
    if (!out) return void deps.sendError(res, 501, 'the agent had no repair'), true;
    return void deps.sendJson(res, 200, out.ops ? { ops: out.ops } : { text: out.text ?? '' }), true;
  }

  return void deps.sendError(res, 404, 'unknown genui route'), true;
}
