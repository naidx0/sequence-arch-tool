/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT CATALOG, AS THE PAGE ASKS FOR IT
   packages/web2/src/settings/agentCatalogClient.ts

     GET  /api/acp/catalog                 every ACP agent Sequence knows, and how it would start here
     POST /api/acp/catalog/refresh         the same, after reading the live ACP registry
     POST /api/acp/catalog/connect { id }  register it (the server picks the command line)
     POST /api/acp/catalog/sign-in/methods { id }  the agent's own sign-in methods (starts it once)
     GET  /api/acp/catalog/sign-in?id=     only the state of a sign-in under way (never starts anything)
     POST /api/acp/catalog/sign-in { id, methodId }  start that sign-in (the agent opens the browser)

   The page only ever names an id: no command line leaves the browser.
   ══════════════════════════════════════════════════════════════════════════ */

export const CATALOG_ROUTE = '/api/acp/catalog';

export type CatalogState = 'connected' | 'ready' | 'npx' | 'uvx' | 'install' | 'mismatch';

export interface CatalogRow {
  id: string;
  name: string;
  description?: string;
  version?: string;
  website?: string;
  source: 'builtin' | 'registry' | 'user';
  state: CatalogState;
  shown?: string;
  /** A different program with this name is on PATH and did not answer as an agent (said in words). */
  mismatch?: string;
  installHint: string;
  /** Not here yet, but Install can fetch a checksummed build for this machine. */
  installable?: boolean;
  installedBySequence?: boolean;
  install?: InstallJob;
  /** Docker is here and the agent ships on npm: it can also run in a sandbox. */
  sandbox?: boolean;
  sandboxConnected?: boolean;
}

export interface InstallJob {
  id: string;
  version: string;
  state: 'downloading' | 'unpacking' | 'done' | 'failed';
  receivedBytes: number;
  totalBytes: number | null;
  error?: string;
}

export interface AuthMethod {
  id: string;
  name: string;
  description?: string;
  type: string;
  args?: string[];
}

export interface SignInJob {
  id: string;
  methodId: string;
  state: 'running' | 'done' | 'failed';
  error?: string;
}

export type Answer<T> = { ok: true; body: T } | { ok: false; message: string; body?: T };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CatalogClient {
  list(): Promise<Answer<{ agents: CatalogRow[]; registryFetchedAt: number | null }>>;
  refresh(): Promise<Answer<{ agents: CatalogRow[]; registryFetchedAt: number | null }>>;
  /** `runtime: 'docker'` connects the same agent in a container that sees only the project folder. */
  connect(id: string, runtime?: 'docker'): Promise<Answer<{ via?: string; agent?: { id: string } }>>;
  methods(id: string): Promise<Answer<{ methods: AuthMethod[] }>>;
  signIn(id: string, methodId: string): Promise<Answer<{ job: SignInJob }>>;
  /** A sign-in's state, without starting the agent. */
  job(id: string): Promise<Answer<{ job?: SignInJob }>>;
  /** Download, verify and unpack the agent's build for this machine (the server checks its sha256). */
  install(id: string): Promise<Answer<{ job: InstallJob }>>;
  installJob(id: string): Promise<Answer<{ job?: InstallJob }>>;
}

async function read<T>(r: Promise<Response>): Promise<Answer<T>> {
  try {
    const res = await r;
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (res.ok) return { ok: true, body };
    return { ok: false, message: body.error ?? `the server answered ${res.status}`, body };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'the server could not be reached' };
  }
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export function createCatalogClient(f: Fetch = (i, init) => fetch(i, init)): CatalogClient {
  return {
    list: () => read(f(CATALOG_ROUTE)),
    refresh: () => read(f('/api/acp/catalog/refresh', json({}))),
    connect: (id, runtime) => read(f('/api/acp/catalog/connect', json(runtime ? { id, runtime } : { id }))),
    methods: (id) => read(f('/api/acp/catalog/sign-in/methods', json({ id }))),
    signIn: (id, methodId) => read(f('/api/acp/catalog/sign-in', json({ id, methodId }))),
    job: (id) => read(f(`/api/acp/catalog/sign-in?id=${encodeURIComponent(id)}`)),
    install: (id) => read(f('/api/acp/catalog/install', json({ id }))),
    installJob: (id) => read(f(`/api/acp/catalog/install?id=${encodeURIComponent(id)}`)),
  };
}

/** The state in words, never a colour alone. */
export const CATALOG_WORD: Record<CatalogState, string> = {
  connected: 'Connected',
  ready: 'Installed',
  npx: 'No install needed',
  uvx: 'No install needed',
  install: 'Not installed',
  mismatch: 'Not an agent',
};
