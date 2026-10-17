/**
 * The agent catalog routes (agentCatalog.ts), reached through acpRoutes' gate:
 *
 *   GET  /api/acp/catalog                -> { agents: CatalogRow[], registryFetchedAt }
 *        every ACP agent Sequence knows, with how it would start here
 *   POST /api/acp/catalog/refresh        -> the same, after fetching the live ACP registry
 *        (the only network call, and only on a person's click)
 *   POST /api/acp/catalog/connect { id } -> { agent, agents }
 *        register catalog agent `id` (what `sequence agent add` writes). The
 *        caller names an id; the command line comes from the catalog.
 *   GET  /api/acp/catalog/sign-in?id=    -> { job? } the state of a sign-in under way. Never starts anything.
 *   POST /api/acp/catalog/sign-in/methods { id } -> { methods }
 *        the sign-in methods the agent declares (ACP auth methods), read by starting it once;
 *        concurrent reads for one agent share one process
 *   POST /api/acp/catalog/sign-in { id, methodId } -> 202 { job }
 *        start the agent's OWN sign-in (ACP `authenticate`: an "agent" method opens the
 *        person's browser). Only on a click; the agent keeps the credential, nothing comes here.
 *
 *   POST /api/acp/catalog/install { id } -> 202 { job }; GET ?id= -> { job? }
 *        download the registry's archive for this machine, check its sha256, unpack it into
 *        <user store>/agents-bin (agentBinaryInstall.ts). Only on a click.
 *   POST /api/acp/catalog/connect { id, runtime: 'docker' } -> the same agent in a Docker sandbox
 *        (agentCatalog.ts sandboxLaunch), refused while the Docker engine is not running
 *   GET  /api/acp/profiles               -> { profiles } agent profiles (agentProfiles.ts)
 *
 * Same gate as every /api/acp/* route: local callers only, off in hosted mode.
 */

import type http from 'node:http';
import os from 'node:os';
import { createAgentClient, type AcpAuthMethod } from '@sequence/acp';
import { addAgent, listAgents, type AgentEntry } from './agentsStore.js';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ACP_REGISTRY_URL, cacheRegistry, installableBinary, installHint, readCatalog, resolveCatalogLaunch, sandboxLaunch, type CatalogSource, type ResolveOptions } from './agentCatalog.js';
import { installAgentBinary, type InstallJob } from './agentBinaryInstall.js';
import { MAX_BODY_BYTES, isJsonRequest, readBody, sendError, sendJson } from './routeHttp.js';
import { loadAgentProfiles } from './agentProfiles.js';
import { isRepoTrusted } from './repoTrust.js';

/** One catalog agent as the UI shows it. */
export interface CatalogRow {
  id: string;
  name: string;
  description?: string;
  version?: string;
  website?: string;
  source: CatalogSource;
  /**
   * connected: registered already. ready: its CLI is on this machine. npx/uvx: runs with nothing to
   * install, fetched on first start. install: not runnable here (`installHint` says how).
   */
  state: 'connected' | 'ready' | 'npx' | 'uvx' | 'install' | 'mismatch';
  /**
   * A different program with this agent's name is on PATH (pressly goose, antirez kilo): it did not answer ACP
   * `initialize` when Connect tried it. The row says so in words instead of reading Installed.
   */
  mismatch?: string;
  /** The launch as a person would type it (`gemini --acp`, `npx -y @google/gemini-cli@0.64.0 --acp`). */
  shown?: string;
  installHint: string;
  /** Not here yet, but the registry gives a checksummed archive for this machine: Install does it in one click. */
  installable?: boolean;
  /** Sequence installed it (agents-bin), as opposed to the person's own install. */
  installedBySequence?: boolean;
  /** An install under way or just finished. */
  install?: InstallJob;
  /** Docker is installed and the agent ships on npm: it can also run in a container that sees only the project. */
  sandbox?: boolean;
  /** Its sandboxed copy is connected (`<id>-sandbox`). */
  sandboxConnected?: boolean;
}

export interface AgentCatalogContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  acpGate: () => { available: boolean; originOk: boolean; reason?: string };
  userConfigDir: string;
  /** Where binaries are looked for (the tests' seam: providerSearch). */
  search?: ResolveOptions;
  /** Test seam for the registry fetch. */
  fetchImpl?: typeof fetch;
  forgetAgentCapabilities?: (id: string) => void;
  /** Test seam: what starts the agent for its sign-in methods and sign-in. */
  clientFactory?: SignInClientFactory;
  /** The open project (agent profiles in .claude/agents, .opencode/agent, .sequence/agents), or null. */
  getRoot?: () => string | null;
  /** Test seam: the home whose ~/.claude/agents and ~/.config/opencode are read. */
  home?: string;
  /** Test seam: the unpacker an install runs. */
  tarCommand?: string;
  /** Test seam: how long Connect waits for a local program to answer ACP `initialize` (default {@link PROBE_MS}). */
  probeMs?: number;
  /** Test seam: null when the Docker engine answers, else why not. */
  dockerCheck?: (docker: string) => Promise<string | null>;
}

/** The slice of an ACP client a sign-in needs. */
export interface SignInClient {
  start(signal?: AbortSignal): Promise<void>;
  authMethods(): AcpAuthMethod[];
  authenticate(methodId: string, signal?: AbortSignal): Promise<void>;
  dispose(): Promise<void>;
}
export type SignInClientFactory = (launch: { command: string; args: string[] }) => SignInClient;

const defaultFactory: SignInClientFactory = (l) => {
  const c = createAgentClient({ command: l.command, args: l.args });
  if (!('authMethods' in c)) throw new Error('this agent is not driven over ACP');
  return c as unknown as SignInClient;
};

/** One sign-in per agent at a time; the newest result is kept so the page can read it after a reload. */
export interface SignInJob {
  id: string;
  methodId: string;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  error?: string;
}
const signInJobs = new Map<string, SignInJob>();
/** One install per agent at a time; the last result stays readable. */
const installJobs = new Map<string, InstallJob>();
/** A method read under way, per agent id. */
const methodReads = new Map<string, Promise<AcpAuthMethod[]>>();
/** Agents are slow to start (Hermes measured ~45 s, Gemini over npx ~26 s): the method read waits this long. */
const START_MS = 120_000;
/**
 * How long a program that is already on PATH gets to answer ACP `initialize` after Connect. A different program
 * that shares an agent's name exits, prints junk or waits for input, and none of those answers.
 */
export const PROBE_MS = 8_000;
/** Agents whose PATH program did not answer as an agent, with the sentence the row shows. Memory only: Connect again re-checks. */
const notAnAgent = new Map<string, string>();
/** The most registry JSON a Refresh will read: the real one is a few hundred KB. */
export const MAX_REGISTRY_BYTES = 2 * 1024 * 1024;

/** The response text, refusing past `max` bytes (by its declared length, then as it streams) before anything is parsed. */
async function readCapped(r: Response, max: number): Promise<string> {
  const tooLarge = (): Error => new Error(`the registry response is too large (over ${max / (1024 * 1024)} MB)`);
  const declared = Number(r.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  if (!r.body) {
    const t = await r.text();
    if (Buffer.byteLength(t) > max) throw tooLarge();
    return t;
  }
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A browser sign-in waits on a person. */
const SIGN_IN_MS = 10 * 60_000;

/** Test seam: forget every sign-in job (each test owns its own). */
export function resetSignInJobs(): void {
  signInJobs.clear();
  methodReads.clear();
  installJobs.clear();
  notAnAgent.clear();
}

/** What asking a program ACP `initialize` found: an agent, a program still silent at the bound, or one that is not an agent. */
export type ProbeResult = { kind: 'ok' } | { kind: 'slow' } | { kind: 'not-agent'; why: string };

/**
 * Asks the program ACP `initialize`. Only a program that exits, errors or answers with something that is not ACP
 * is "not-agent". Silence at the bound is "slow" and proves nothing: Hermes takes about 45 s to start.
 */
export async function probeAgent(factory: SignInClientFactory, launch: { command: string; args: string[] }, ms: number): Promise<ProbeResult> {
  let c: SignInClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const signal = AbortSignal.timeout(ms);
  try {
    c = factory(launch);
    const started = c.start(signal);
    started.catch(() => {});
    /* A client that ignores the abort signal must not hold Connect: the bound is enforced here too. */
    await Promise.race([
      started,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          timedOut = true;
          rej(new Error('no answer yet'));
        }, ms);
      }),
    ]);
    return { kind: 'ok' };
  } catch (e) {
    if (timedOut || (signal.aborted && (e as Error).name === 'TimeoutError')) return { kind: 'slow' };
    return { kind: 'not-agent', why: (e as Error).message };
  } finally {
    if (timer) clearTimeout(timer);
    void c?.dispose().catch(() => {});
  }
}

const mismatchSentence = (name: string, id: string): string => `A different program named ${id} is on PATH; it did not answer as an agent, so ${name} is not connected`;

/** Null when the Docker engine answers `docker version` within 8 s, else a sentence saying what to do. */
export function dockerEngineDown(docker: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(docker, ['version', '--format', '{{.Server.Version}}'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve(`Docker could not be started: ${(e as Error).message}`);
      return;
    }
    const t = setTimeout(() => {
      child.kill();
      resolve('Docker did not answer. Start Docker Desktop, then try again.');
    }, 8000);
    child.stdout?.setEncoding('utf8').on('data', (c: string) => (out += c));
    child.once('error', (e) => {
      clearTimeout(t);
      resolve(`Docker could not be started: ${e.message}`);
    });
    child.once('close', (code) => {
      clearTimeout(t);
      resolve(code === 0 && out.trim() !== '' ? null : 'Docker is installed but not running. Start Docker Desktop, then try again.');
    });
  });
}

export function isAgentCatalogPath(pathname: string): boolean {
  return pathname === '/api/acp/catalog' || pathname.startsWith('/api/acp/catalog/') || pathname === '/api/acp/profiles';
}

/** Where one-click installs live: `<user store>/agents-bin`. */
export function installRootFor(userConfigDir: string): string {
  return path.join(userConfigDir, 'agents-bin');
}

export function catalogRows(userConfigDir: string, search: ResolveOptions = {}): { agents: CatalogRow[]; registryFetchedAt: number | null; refused?: { id: string; reason: string }[] } {
  search ={ installRoot: installRootFor(userConfigDir), ...search };
  const { agents, registryFetchedAt, refused } = readCatalog(userConfigDir);
  const registered = new Set(listAgents(userConfigDir).map((a) => a.id));
  const rows = agents.map((a): CatalogRow => {
    const l = resolveCatalogLaunch(a, search);
    const wrong = !registered.has(a.id) && l.ok && l.via === 'local' ? notAnAgent.get(a.id) : undefined;
    const state: CatalogRow['state'] = registered.has(a.id) ? 'connected' : wrong ? 'mismatch' : l.ok ? (l.via === 'local' || l.via === 'installed' ? 'ready' : l.via) : 'install';
    const job = installJobs.get(a.id);
    return {
      id: a.id,
      name: a.name,
      ...(a.description ? { description: a.description } : {}),
      ...(a.version ? { version: a.version } : {}),
      ...(a.website ? { website: a.website } : {}),
      source: a.source,
      state,
      ...(wrong ? { mismatch: wrong } : {}),
      ...(l.ok ? { shown: l.shown } : {}),
      installHint: installHint(a),
      ...(state === 'install' && installableBinary(a, search.plat) ? { installable: true } : {}),
      ...(sandboxLaunch(a, search).ok ? { sandbox: true } : {}),
      ...(registered.has(`${a.id}-sandbox`) ? { sandboxConnected: true } : {}),
      ...(l.ok && l.via === 'installed' ? { installedBySequence: true } : {}),
      ...(job ? { install: job } : {}),
    };
  });
  /* What can start now first (installed, then nothing-to-install), then the rest, each by name. */
  const rank = { connected: 0, ready: 1, npx: 2, uvx: 2, install: 3, mismatch: 3 } as const;
  rows.sort((x, y) => rank[x.state] - rank[y.state] || x.name.localeCompare(y.name));
  return { agents: rows, registryFetchedAt, ...(refused.length ? { refused } : {}) };
}

export async function handleAgentCatalogRoute(ctx: AgentCatalogContext): Promise<boolean> {
  const { req, res, url, method, userConfigDir } = ctx;
  const { pathname } = url;
  if (!isAgentCatalogPath(pathname)) return false;
  const g = ctx.acpGate();
  if (!g.available) {
    sendError(res, 403, g.reason ?? 'ACP is not available');
    return true;
  }

  // ---- GET /api/acp/profiles -> { profiles } (agentProfiles.ts: roles typed as @name in the chat) ----
  if (pathname === '/api/acp/profiles' && method === 'GET') {
    sendJson(res, 200, { profiles: loadAgentProfiles({ home: ctx.home ?? os.homedir(), root: ctx.getRoot?.() ?? null, trusted: isRepoTrusted(ctx.getRoot?.() ?? null) }) });
    return true;
  }

  if (pathname === '/api/acp/catalog' && method === 'GET') {
    sendJson(res, 200, catalogRows(userConfigDir, ctx.search));
    return true;
  }

  if (pathname === '/api/acp/catalog/refresh' && method === 'POST') {
    /* It writes the registry cache: a JSON request, like every other write here (a cross-site form cannot send one). */
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    const f = ctx.fetchImpl ?? fetch;
    try {
      const r = await f(ACP_REGISTRY_URL, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`the registry answered ${r.status}`);
      cacheRegistry(userConfigDir, JSON.parse(await readCapped(r, MAX_REGISTRY_BYTES)));
    } catch (e) {
      /* Offline is a state, not a failure of the catalog: the snapshot still stands. */
      sendJson(res, 502, { error: `could not reach the ACP registry: ${(e as Error).message}`, ...catalogRows(userConfigDir, ctx.search) });
      return true;
    }
    sendJson(res, 200, catalogRows(userConfigDir, ctx.search));
    return true;
  }

  if (pathname === '/api/acp/catalog/connect' && method === 'POST') {
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: { id?: unknown; runtime?: unknown };
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const id = typeof body?.id === 'string' ? body.id : '';
    const entry = readCatalog(userConfigDir).agents.find((a) => a.id === id);
    if (!entry) {
      sendJson(res, 404, { error: `no agent '${id}' in the catalog`, state: 'unknown' });
      return true;
    }
    if (body.runtime !== undefined && body.runtime !== null && body.runtime !== 'docker') {
      sendError(res, 400, `unknown runtime '${String(body.runtime)}': only 'docker' (or none, for this machine) is supported`);
      return true;
    }
    /* { runtime: 'docker' }: the same agent in a throwaway container that sees only the project folder. */
    if (body.runtime === 'docker') {
      const s = sandboxLaunch(entry, ctx.search ?? {});
      if (!s.ok) {
        sendJson(res, 409, { error: s.message, state: s.reason });
        return true;
      }
      const down = await (ctx.dockerCheck ?? dockerEngineDown)(s.command);
      if (down) {
        sendJson(res, 409, { error: down, state: 'docker-off' });
        return true;
      }
      const sid = `${entry.id}-sandbox`;
      const agent: AgentEntry = { id: sid, command: s.command, args: s.args, label: `${entry.name} (sandbox)` };
      const agents = addAgent(userConfigDir, agent);
      ctx.forgetAgentCapabilities?.(sid);
      sendJson(res, 200, { agent, agents, via: 'docker' });
      return true;
    }
    const l = resolveCatalogLaunch(entry, { installRoot: installRootFor(userConfigDir), ...ctx.search });
    if (!l.ok) {
      sendJson(res, 409, { error: `${entry.name} is not on this machine`, state: 'install', installHint: l.message });
      return true;
    }
    /* A program found on PATH may only share the agent's name. Registering it would read "Installed", then fail
       at the first prompt: ask it ACP `initialize` first. Installed and npx launches are Sequence's own choice. */
    let slow: string | undefined;
    if (l.via === 'local') {
      const probe = await probeAgent(ctx.clientFactory ?? defaultFactory, l, ctx.probeMs ?? PROBE_MS);
      if (probe.kind === 'not-agent') {
        const message = mismatchSentence(entry.name, entry.id);
        notAnAgent.set(entry.id, message);
        sendJson(res, 409, { error: message, state: 'mismatch', detail: probe.why });
        return true;
      }
      notAnAgent.delete(entry.id);
      /* Silence is not evidence: a real agent can take a minute to start. Connect it and say so. */
      if (probe.kind === 'slow') slow = `${entry.name} was slow to answer (more than ${Math.round((ctx.probeMs ?? PROBE_MS) / 1000)} s), so it is connected without being checked. If it does not work, make sure the program on PATH really is ${entry.name}.`;
    }
    const agent: AgentEntry = { id: entry.id, command: l.command, ...(l.args.length ? { args: l.args } : {}), label: entry.name };
    const agents = addAgent(userConfigDir, agent);
    ctx.forgetAgentCapabilities?.(entry.id);
    sendJson(res, 200, { agent, agents, via: l.via, ...(slow ? { note: slow } : {}) });
    return true;
  }

  // ---- /api/acp/catalog/install: GET ?id= reads an install's state; POST { id } starts one (agentBinaryInstall.ts) ----
  if (pathname === '/api/acp/catalog/install') {
    if (method === 'GET') {
      const job = installJobs.get(url.searchParams.get('id') ?? '');
      sendJson(res, 200, job ? { job } : {});
      return true;
    }
    if (method !== 'POST') {
      sendError(res, 405, `${method} is not supported on ${pathname}`);
      return true;
    }
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let id = '';
    try {
      const b = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as { id?: unknown };
      id = typeof b.id === 'string' ? b.id : '';
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const entry = readCatalog(userConfigDir).agents.find((a) => a.id === id);
    if (!entry) {
      sendJson(res, 404, { error: `no agent '${id}' in the catalog` });
      return true;
    }
    const prior = installJobs.get(id);
    if (prior && (prior.state === 'downloading' || prior.state === 'unpacking')) {
      sendJson(res, 409, { error: `${entry.name} is already installing`, job: prior });
      return true;
    }
    if (!installableBinary(entry, ctx.search?.plat)) {
      sendJson(res, 409, { error: `${entry.name} has no checksummed download for this machine`, installHint: installHint(entry) });
      return true;
    }
    const job: InstallJob = { id, version: entry.version ?? 'unversioned', state: 'downloading', receivedBytes: 0, totalBytes: null };
    installJobs.set(id, job);
    void installAgentBinary(entry, {
      installRoot: installRootFor(userConfigDir),
      ...(ctx.search?.plat ? { plat: ctx.search.plat } : {}),
      ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      ...(ctx.tarCommand ? { tarCommand: ctx.tarCommand } : {}),
      onProgress: (j) => installJobs.set(id, j),
    }).catch((e: unknown) => {
      installJobs.set(id, { ...(installJobs.get(id) ?? job), state: 'failed', error: (e as Error).message });
    });
    sendJson(res, 202, { job });
    return true;
  }

  if (pathname === '/api/acp/catalog/sign-in' || pathname === '/api/acp/catalog/sign-in/methods') {
    const factory = ctx.clientFactory ?? defaultFactory;
    /* GET only READS the state of a sign-in: it never starts anything. A cross-site <img> or link sends a
       GET with no Origin, which the gate lets through, so a GET that spawned an agent could be fired from
       any page (review finding 1). Everything that starts an agent is a JSON POST, which a page on another
       origin cannot send without a preflight the server never answers. */
    if (pathname === '/api/acp/catalog/sign-in' && method === 'GET') {
      const running = signInJobs.get(url.searchParams.get('id') ?? '');
      sendJson(res, 200, running ? { job: running } : {});
      return true;
    }
    if (method !== 'POST') {
      sendError(res, 405, `${method} is not supported on ${pathname}`);
      return true;
    }
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let id: string;
    let methodId = '';
    try {
      const b = JSON.parse(await readBody(req, MAX_BODY_BYTES)) as { id?: unknown; methodId?: unknown };
      id = typeof b.id === 'string' ? b.id : '';
      methodId = typeof b.methodId === 'string' ? b.methodId : '';
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    const entry = readCatalog(userConfigDir).agents.find((a) => a.id === id);
    if (!entry) {
      sendJson(res, 404, { error: `no agent '${id}' in the catalog` });
      return true;
    }
    const l = resolveCatalogLaunch(entry, { installRoot: installRootFor(userConfigDir), ...ctx.search });
    if (!l.ok) {
      sendJson(res, 409, { error: `${entry.name} is not on this machine`, state: 'install', installHint: l.message });
      return true;
    }
    const running = signInJobs.get(id);
    if (running?.state === 'running') {
      sendJson(res, 409, { error: `${entry.name} is already signing in`, job: running });
      return true;
    }

    // ---- POST /api/acp/catalog/sign-in/methods { id }: start the agent once and ask how it signs in ----
    if (pathname === '/api/acp/catalog/sign-in/methods') {
      /* One read per agent at a time: a second click joins the first instead of starting a second agent. */
      let pending = methodReads.get(id);
      if (!pending) {
        pending = (async () => {
          const c = factory(l);
          try {
            await c.start(AbortSignal.timeout(START_MS));
            return c.authMethods();
          } finally {
            void c.dispose().catch(() => {});
          }
        })();
        methodReads.set(id, pending);
        void pending.catch(() => {}).finally(() => methodReads.delete(id));
      }
      try {
        sendJson(res, 200, { methods: await pending });
      } catch (e) {
        sendJson(res, 502, { error: `${entry.name} did not start: ${(e as Error).message}` });
      }
      return true;
    }

    // ---- POST /api/acp/catalog/sign-in { id, methodId }: run that method in the background ----
    if (methodId === '') {
      sendError(res, 400, 'name the sign-in method (methodId)');
      return true;
    }
    /* One process per agent: a methods read still under way owns it. */
    if (methodReads.has(id)) {
      sendJson(res, 409, { error: `${entry.name} is still starting to list its sign-in methods; try again in a moment` });
      return true;
    }
    const job: SignInJob = { id, methodId, state: 'running', startedAt: Date.now() };
    let c: SignInClient;
    try {
      c = factory(l);
    } catch (e) {
      /* The client could not even be made (codex-cli is not driven over ACP): a failed job, never one stuck at running. */
      const failed: SignInJob = { ...job, state: 'failed', error: (e as Error).message };
      signInJobs.set(id, failed);
      sendJson(res, 202, { job: failed });
      return true;
    }
    signInJobs.set(id, job);
    void (async () => {
      try {
        await c.start(AbortSignal.timeout(START_MS));
        const m = c.authMethods().find((x) => x.id === methodId);
        if (!m) throw new Error(`${entry.name} offers no sign-in method '${methodId}'`);
        /* Only an "agent" method signs in through ACP authenticate. A terminal method needs an interactive run
           and an env_var method needs a variable set: calling authenticate would fail or hang (finding 5). */
        if (m.type !== 'agent') throw new Error(`'${m.name}' is a ${m.type} sign-in, which Sequence cannot run from here yet`);
        await c.authenticate(methodId, AbortSignal.timeout(SIGN_IN_MS));
        job.state = 'done';
        ctx.forgetAgentCapabilities?.(id);
      } catch (e) {
        job.state = 'failed';
        job.error = (e as Error).message;
      } finally {
        void c.dispose().catch(() => {});
      }
    })();
    sendJson(res, 202, { job });
    return true;
  }

  sendError(res, 405, `${method} is not supported on ${pathname}`);
  return true;
}
