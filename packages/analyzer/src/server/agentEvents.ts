/* ══════════════════════════════════════════════════════════════════════════
   AGENT EVENTS — what a coding agent is doing, on the architecture board
   packages/analyzer/src/server/agentEvents.ts

   Spec: docs/research/overhaul-formats-v2.md §3.4 (overhaul ba996a28).

     POST /api/agent-event    a Claude Code hook payload, unchanged (local-only)
     GET  /api/agent-events   SSE: every buffered AgentEvent, then each new one

   Each payload is normalised into ONE AgentEvent (agentEventTypes.ts). Its
   paths are resolved against the graph the server already holds — file node,
   module, service, and the edges whose evidence sits in that file — so the
   board, roster, tree and timeline all fold the same events (the AgentNode
   tree is built client-side, in packages/web2/src/agents/agentTree.ts).

   Replies (Claude Code reads a 2xx JSON body with the hook output schema):
     PostToolUse Edit|Write|MultiEdit → additionalContext, only when the file
       sits on a cross-service edge, at most 600 characters, from the graph only;
     SessionStart → additionalContext = the first 1k tokens of map.md.

   Same gate as the onboarding probes (onboardingRoutes.ts): refused in hosted
   mode and for any caller that is not on this machine.
   ══════════════════════════════════════════════════════════════════════════ */

import type http from 'node:http';
import path from 'node:path';
import type { ArchEdge, ArchGraph } from '@sequence/schema';
import { isOriginAllowed } from './terminal.js';
import { crossPair, mapHead, mapIndex, renderAgentMap } from '../agentMap.js';
import type { AgentEvent, AgentEventKind, AgentToolKind, BoardHit } from './agentEventTypes.js';
import type { TurnSnapshotGate } from './turnSnapshotGate.js';
export type { AgentEvent, AgentEventKind, AgentToolKind, BoardHit } from './agentEventTypes.js';

const MAX_EVENTS = 2000;
export const CONTEXT_CAP = 600;
export const SESSION_MAP_TOKENS = 1000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

type Payload = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/* ─────────────────────────── normalising ─────────────────────────── */

export function toolKindOf(tool: string): AgentToolKind {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit';
  if (/^(Read|NotebookRead)$/.test(tool)) return 'read';
  if (/^(Grep|Glob|LS|ToolSearch)$/.test(tool)) return 'search';
  if (/^(Bash|PowerShell|BashOutput|KillShell)$/.test(tool)) return 'execute';
  if (/^(WebFetch|WebSearch)$/.test(tool)) return 'fetch';
  if (/^(Task|Agent|TodoWrite|ExitPlanMode)$/.test(tool)) return 'think';
  return 'other';
}

/** The file paths a tool call names, from its `tool_input`. */
export function toolPaths(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const o = input as Payload;
  const out: string[] = [];
  for (const k of ['file_path', 'notebook_path', 'path']) {
    const v = str(o[k]);
    if (v) out.push(v);
  }
  return out;
}

/** Repo-relative POSIX path, or null when it is outside `root`. */
export function repoRelative(root: string, p: string, cwd?: string | null): string | null {
  const abs = path.resolve(cwd ?? root, p);
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function failedOf(p: Payload): boolean {
  if (p.hook_event_name === 'PostToolUseFailure') return true;
  for (const k of ['tool_response', 'tool_output']) {
    const r = p[k];
    if (r && typeof r === 'object') {
      const o = r as Payload;
      if (o.isError === true || o.is_error === true || o.success === false) return true;
    }
  }
  return false;
}

/** A failed hook step's own words: the hook's `error`, else the tool's stderr / error text. First line, 300 chars. */
function errorOf(p: Payload): string | undefined {
  const cut = (t: string): string | undefined => {
    const line = t.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '');
    return line ? (line.length > 300 ? `${line.slice(0, 299)}…` : line) : undefined;
  };
  const direct = str(p.error);
  if (direct) return cut(direct);
  for (const k of ['tool_response', 'tool_output']) {
    const r = p[k];
    if (typeof r === 'string') return cut(r);
    if (r && typeof r === 'object') {
      const o = r as Payload;
      const t = str(o.error) ?? str(o.stderr) ?? str(o.content) ?? str(o.output);
      if (t) return cut(t);
    }
  }
  return undefined;
}

const EVENT_KIND: Record<string, AgentEventKind> = {
  SessionStart: 'session_start',
  PreToolUse: 'tool_start',
  PostToolUse: 'tool_end',
  PostToolUseFailure: 'tool_end',
  SubagentStart: 'subagent_start',
  SubagentStop: 'subagent_stop',
  Stop: 'stop',
};

/* ─────────────────────────── the board ─────────────────────────── */

interface BoardIndex {
  byPath: Map<string, string>;
  /** evidence file → edges citing it. */
  byEvidence: Map<string, ArchEdge[]>;
  servicePaths: { prefix: string; id: string }[];
}
const boardCache = new WeakMap<ArchGraph, BoardIndex>();

function boardIndex(graph: ArchGraph): BoardIndex {
  const hit = boardCache.get(graph);
  if (hit) return hit;
  const byPath = new Map<string, string>();
  for (const n of graph.nodes) if (n.kind === 'file' && n.path) byPath.set(n.path, n.id);
  const byEvidence = new Map<string, ArchEdge[]>();
  for (const e of graph.edges) {
    for (const f of new Set(e.evidence.map((x) => x.file))) {
      const list = byEvidence.get(f) ?? [];
      list.push(e);
      byEvidence.set(f, list);
    }
  }
  const servicePaths = graph.nodes
    .filter((n) => n.kind === 'service' && n.path)
    .map((n) => ({ prefix: `${n.path!.replace(/\/+$/, '')}/`, id: n.id }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const bi = { byPath, byEvidence, servicePaths };
  boardCache.set(graph, bi);
  return bi;
}

/** Path to board: file node by path, then up through parentId to module and service. */
export function resolvePath(graph: ArchGraph | null, rel: string): BoardHit {
  const hit: BoardHit = { path: rel, fileNodeId: null, moduleId: null, serviceId: null, serviceLabel: null, touchedEdgeIds: [], liftedEdges: [] };
  if (!graph) return hit;
  const idx = mapIndex(graph);
  const bi = boardIndex(graph);
  hit.fileNodeId = bi.byPath.get(rel) ?? null;
  if (hit.fileNodeId) {
    const seen = new Set<string>();
    let cur = idx.byId.get(hit.fileNodeId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.kind === 'module' && !hit.moduleId) hit.moduleId = cur.id;
      cur = cur.parentId ? idx.byId.get(cur.parentId) : undefined;
    }
  }
  const top = hit.fileNodeId
    ? idx.top(hit.fileNodeId)
    : idx.byId.get(bi.servicePaths.find((s) => rel.startsWith(s.prefix))?.id ?? '');
  if (top) {
    hit.serviceId = top.id;
    hit.serviceLabel = top.label;
  }
  const lifted = new Set<string>();
  for (const e of bi.byEvidence.get(rel) ?? []) {
    hit.touchedEdgeIds.push(e.id);
    const p = crossPair(graph, e);
    if (p) lifted.add(`${p.src.id}>${p.dst.id}`);
  }
  hit.liftedEdges = [...lifted].sort();
  return hit;
}

const VERB: Record<string, [string, string]> = {
  /* [as the caller, as the callee] */
  http: ['calls', 'calls it'],
  grpc: ['calls', 'calls it over gRPC'],
  queue_publish: ['publishes to', 'is published to by it'],
  queue_consume: ['consumes', 'is consumed by it'],
  db_read: ['reads table', 'is read by it'],
  db_write: ['writes table', 'is written by it'],
  db_access: ['uses', 'is used by it'],
  import: ['imports', 'imports it'],
};
const PEER_VERB: Record<string, string> = { db_read: 'reads', db_write: 'writes', db_access: 'uses', queue_publish: 'publishes to', queue_consume: 'consumes' };

const atFor = (e: ArchEdge, file: string): string | null => {
  const ev = e.evidence.find((x) => x.file === file && x.line > 0) ?? e.evidence.find((x) => x.line > 0);
  return ev ? `${ev.file}:${ev.line}` : null;
};

/**
 * The PostToolUse context: the service the file is in and the cross-service
 * edges it carries, from the graph only. Null when the file is on none.
 */
export function contextFor(graph: ArchGraph | null, hit: BoardHit): string | null {
  if (!graph || !hit.serviceLabel) return null;
  const bi = boardIndex(graph);
  const cross = (bi.byEvidence.get(hit.path) ?? []).filter((e) => crossPair(graph, e));
  if (!cross.length) return null;
  const order = (e: ArchEdge): number => (e.kind === 'import' ? 1 : 0);
  cross.sort((a, b) => order(a) - order(b) || b.confidence - a.confidence || (a.id < b.id ? -1 : 1));
  const parts = [`${hit.path} is in service ${hit.serviceLabel}.`];
  const said = new Set<string>();
  for (const e of cross) {
    const p = crossPair(graph, e)!;
    const mine = p.src.id === hit.serviceId;
    const other = mine ? p.dst : p.src;
    const at = atFor(e, hit.path);
    const table = typeof e.detail?.table === 'string' ? e.detail.table : null;
    const [asCaller, asCallee] = VERB[e.kind] ?? ['touches', 'touches it'];
    const target = /table$/.test(asCaller) ? (table ?? other.label) : other.label;
    parts.push(mine ? `It ${asCaller} ${target}${at ? ` (${at})` : ''}.` : `${other.label} ${asCallee}${at ? ` (${at})` : ''}.`);
    /* Who else is on the far side of a datastore or topic. */
    if (mine && (other.kind === 'datastore' || other.kind === 'topic') && !said.has(other.id)) {
      said.add(other.id);
      for (const peer of graph.edges) {
        const pp = crossPair(graph, peer);
        if (!pp || peer.id === e.id) continue;
        const peerSvc = pp.dst.id === other.id ? pp.src : pp.src.id === other.id ? pp.dst : null;
        if (!peerSvc || peerSvc.id === hit.serviceId || peerSvc.kind !== 'service') continue;
        const pat = atFor(peer, '');
        const what = other.kind === 'datastore' ? (table ? 'that table' : other.label) : 'that topic';
        parts.push(`${peerSvc.label} ${PEER_VERB[peer.kind] ?? 'uses'} ${what}${pat ? ` (${pat})` : ''}.`);
        if (parts.join(' ').length > CONTEXT_CAP) break;
      }
    }
    if (parts.join(' ').length > CONTEXT_CAP) break;
  }
  let text = parts.join(' ');
  if (text.length > CONTEXT_CAP) {
    /* Cut at a sentence so nothing is half-said. */
    const cut = text.lastIndexOf('. ', CONTEXT_CAP - 1);
    text = cut > 0 ? text.slice(0, cut + 1) : text.slice(0, CONTEXT_CAP);
  }
  return text;
}

const mapHeadCache = new WeakMap<ArchGraph, string>();
/** The first 1k tokens of map.md for this graph. */
export function sessionMapContext(graph: ArchGraph | null): string | null {
  if (!graph) return null;
  let t = mapHeadCache.get(graph);
  if (t === undefined) {
    t = mapHead(renderAgentMap(graph), SESSION_MAP_TOKENS);
    mapHeadCache.set(graph, t);
  }
  return t;
}

/* ─────────────────────────── the hub ─────────────────────────── */

export interface AgentEventHubOptions {
  getGraph: () => ArchGraph | null;
  getRoot: () => string | null;
  now?: () => number;
  /**
   * S3 turn snapshots, through the gate (turnSnapshotGate.ts): a prompt's
   * snapshot is started and not awaited; an edit's PreToolUse waits for it.
   */
  snapshots?: TurnSnapshotGate;
  /**
   * Claims-audit 2.6 (F3): answer the FIRST Grep or Glob of a turn with find_files results, as hook context.
   * `enabled` is read on every call (the setting `findFilesFirst`, off by default); `run` returns the
   * ranked-files text for a query and may be slow or fail (the hook then answers nothing and the search runs as usual).
   */
  findFilesFirst?: { enabled: () => boolean; run: (root: string, query: string) => Promise<string> };
}

export interface IngestResult {
  event: AgentEvent | null;
  /** The JSON body to answer the hook with. */
  reply: Record<string, unknown>;
}

/** The per-server event log plus its SSE subscribers. */
export class AgentEventHub {
  private events: AgentEvent[] = [];
  private subscribers = new Set<http.ServerResponse>();
  private seq = 0;
  constructor(private readonly opts: AgentEventHubOptions) {}

  log(): readonly AgentEvent[] {
    return this.events;
  }

  /** Normalise one Claude Code hook payload. Null for an event we do not draw. */
  normalize(p: Payload): AgentEvent | null {
    const hook = str(p.hook_event_name) ?? '';
    const kind = EVENT_KIND[hook];
    if (!kind) return null;
    const at = (this.opts.now ?? Date.now)();
    const tool = str(p.tool_name) ?? undefined;
    const root = this.opts.getRoot();
    const cwd = str(p.cwd);
    const paths = root && tool
      ? [...new Set(toolPaths(p.tool_input).map((x) => repoRelative(root, x, cwd)).filter((x): x is string => x !== null))]
      : [];
    const input = (p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {}) as Payload;
    const title =
      kind === 'subagent_start' || kind === 'subagent_stop'
        ? str(p.agent_type) ?? undefined
        : tool
          ? (paths[0] ? `${tool} ${paths[0]}` : `${tool}${(str(input.description) ?? str(input.command) ?? str(input.pattern)) ? `: ${(str(input.description) ?? str(input.command) ?? str(input.pattern))!.slice(0, 120)}` : ''}`)
          : str(p.session_title) ?? undefined;
    const graph = this.opts.getGraph();
    const ev: AgentEvent = {
      id: `${at.toString(36)}-${(++this.seq).toString(36)}`,
      at,
      source: 'claude-hook',
      sessionId: str(p.session_id) ?? 'unknown',
      ...(str(p.agent_id) ? { agentId: str(p.agent_id)! } : {}),
      ...(str(p.parent_agent_id) ? { parentAgentId: str(p.parent_agent_id)! } : {}),
      kind,
      ...(tool ? { tool, toolKind: toolKindOf(tool) } : {}),
      paths,
      status: kind === 'tool_end' ? (failedOf(p) ? 'failed' : 'done') : kind === 'tool_start' ? 'running' : kind === 'session_start' || kind === 'subagent_start' ? 'running' : 'done',
      ...(str(p.tool_use_id) ? { toolUseId: str(p.tool_use_id)! } : {}),
      ...(title ? { title } : {}),
      ...(paths.length ? { board: paths.map((r) => resolvePath(graph, r)) } : {}),
      ...(kind === 'tool_end' && failedOf(p) ? (() => { const e = errorOf(p); return e ? { error: e } : {}; })() : {}),
    };
    return ev;
  }

  /**
   * S3: a prompt starts a turn (the tree's snapshot is STARTED, not awaited,
   * so the prompt is answered at once); an edit tool's PreToolUse waits for
   * that snapshot, then records its paths, before the write lands. Both hooks
   * are synchronous (agentHookSettings), so only an edit ever waits here. A
   * failure never fails the hook: the agent goes on without a snapshot.
   */
  async snapshot(p: Payload): Promise<void> {
    const snaps = this.opts.snapshots;
    const root = this.opts.getRoot();
    const sid = str(p.session_id);
    if (!snaps || !root || !sid) return;
    try {
      if (p.hook_event_name === 'UserPromptSubmit') await snaps.startTurn(root, sid);
      else if (p.hook_event_name === 'PreToolUse' && EDIT_TOOLS.has(str(p.tool_name) ?? '')) {
        const cwd = str(p.cwd);
        const paths = toolPaths(p.tool_input).map((x) => repoRelative(root, x, cwd)).filter((x): x is string => x !== null);
        if (paths.length) await snaps.beforeWrite(root, sid, paths);
      }
    } catch {
      /* best effort, see above */
    }
  }

  /**
   * An event that did not come through a hook (a run-node turn, see
   * runNodeAgentEvents.ts): stamped, its paths made relative to `root` (the
   * turn's checkout, a chat's worktree included; the repo by default) and
   * placed on the board, then logged and sent like any other.
   */
  publish(e: Omit<AgentEvent, 'id' | 'at' | 'board'>, where: { root?: string | null; cwd?: string | null } = {}): AgentEvent {
    const at = (this.opts.now ?? Date.now)();
    const root = where.root ?? this.opts.getRoot();
    const cwd = where.cwd;
    const paths = root ? [...new Set(e.paths.map((x) => repoRelative(root, x, cwd)).filter((x): x is string => x !== null))] : [];
    const graph = this.opts.getGraph();
    const ev: AgentEvent = {
      ...e,
      id: `${at.toString(36)}-${(++this.seq).toString(36)}`,
      at,
      paths,
      ...(paths.length ? { board: paths.map((r) => resolvePath(graph, r)) } : {}),
    };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.broadcast(ev);
    return ev;
  }

  /** Per session: the latest prompt, and whether this turn's first search was already answered. */
  private readonly turns = new Map<string, { prompt: string; answered: boolean }>();

  /**
   * F3 hook: the PreToolUse reply for the first Grep or Glob of a turn, with find_files results as
   * `additionalContext` (no permission decision: the search itself runs as usual). Null for every
   * other event, for later searches in the same turn, when the setting is off, and on any failure.
   */
  async findFilesContext(p: Payload): Promise<Record<string, unknown> | null> {
    const cfg = this.opts.findFilesFirst;
    const sid = str(p.session_id) ?? 'unknown';
    const hook = str(p.hook_event_name);
    if (hook === 'UserPromptSubmit') {
      this.turns.set(sid, { prompt: str(p.prompt) ?? '', answered: false });
      while (this.turns.size > 64) this.turns.delete(this.turns.keys().next().value as string);
      return null;
    }
    if (!cfg || hook !== 'PreToolUse' || !/^(Grep|Glob)$/.test(str(p.tool_name) ?? '') || !cfg.enabled()) return null;
    const root = this.opts.getRoot();
    if (!root) return null;
    const turn = this.turns.get(sid) ?? { prompt: '', answered: false };
    if (turn.answered) return null;
    turn.answered = true;
    this.turns.set(sid, turn);
    const input = (p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {}) as Payload;
    const query = (turn.prompt.trim() || str(input.pattern) || '').slice(0, 2000);
    if (!query) return null;
    try {
      const text = await Promise.race([cfg.run(root, query), new Promise<string>((_, rej) => setTimeout(() => rej(new Error('find_files timed out')), 4000).unref?.())]);
      if (!text || !text.trim()) return null;
      /* "No file matched" is noise, not an answer: leave the turn unanswered so a later, better-aimed search can try. */
      if (/^No file matched/m.test(text)) {
        turn.answered = false;
        return null;
      }
      return { hookEventName: 'PreToolUse', additionalContext: `[Added by Sequence. Files a trained ranker picks for this task, before your search:]\n${text}`.slice(0, 6000) };
    } catch {
      return null;
    }
  }

  ingest(p: Payload): IngestResult {
    const ev = this.normalize(p);
    if (!ev) return { event: null, reply: {} };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.broadcast(ev);
    const graph = this.opts.getGraph();
    if (p.hook_event_name === 'PostToolUse' && ev.tool && EDIT_TOOLS.has(ev.tool) && ev.board?.length) {
      const ctx = ev.board.map((h) => contextFor(graph, h)).filter((x): x is string => !!x).join(' ');
      if (ctx) return { event: ev, reply: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ctx.slice(0, CONTEXT_CAP) } } };
    }
    if (p.hook_event_name === 'SessionStart') {
      const map = sessionMapContext(graph);
      if (map) return { event: ev, reply: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: map } } };
    }
    return { event: ev, reply: {} };
  }

  private broadcast(ev: AgentEvent): void {
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const res of this.subscribers) {
      if (res.writableEnded) this.subscribers.delete(res);
      else res.write(line);
    }
  }

  subscribe(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders();
    for (const ev of this.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    this.subscribers.add(res);
    const ping = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15000);
    ping.unref?.();
    const drop = (): void => {
      clearInterval(ping);
      this.subscribers.delete(res);
    };
    req.on('close', drop);
    res.on('close', drop);
  }
}

/* ─────────────────────────── the route ─────────────────────────── */

export interface AgentEventContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  authOn: boolean;
  hub: AgentEventHub;
  maxBodyBytes: number;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Is the TCP peer on this machine? (Host/Origin say where the caller claims to be.) */
export function peerIsLoopback(req: http.IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/** Handle POST /api/agent-event and GET /api/agent-events. False when the path is not ours. */
export async function handleAgentEventRoute(ctx: AgentEventContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const ingress = url.pathname === '/api/agent-event' && method === 'POST';
  const stream = url.pathname === '/api/agent-events' && method === 'GET';
  if (!ingress && !stream) return false;
  if (ctx.authOn) {
    send(res, 403, { error: 'agent events are local-only and are disabled in hosted (multi-user) mode.' });
    return true;
  }
  if (!isOriginAllowed(req) || !peerIsLoopback(req)) {
    send(res, 403, { error: 'agent events are local-only — this request did not come from localhost.' });
    return true;
  }
  if (stream) {
    ctx.hub.subscribe(req, res);
    return true;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readBody(req, ctx.maxBodyBytes));
  } catch (e) {
    send(res, 400, { error: `invalid JSON body: ${(e as Error).message}` });
    return true;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    send(res, 400, { error: 'body must be a Claude Code hook payload (a JSON object)' });
    return true;
  }
  await ctx.hub.snapshot(payload as Payload);
  const answer = ctx.hub.ingest(payload as Payload).reply;
  const ff = await ctx.hub.findFilesContext(payload as Payload);
  send(res, 200, ff ? { ...answer, hookSpecificOutput: ff } : answer);
  return true;
}
