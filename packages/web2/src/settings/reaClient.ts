/**
 * The REA component's door (`/api/rea*`, analyzer components/reaRoutes.ts). Every call is total: a refusal, an older
 * server without the route, or a dead network is one sentence, never a throw, so the Settings row can always draw.
 */

export type StepId = 'fetch' | 'install' | 'build' | 'prune' | 'addon' | 'verify' | 'doctor';
export type StepState = 'pending' | 'running' | 'done' | 'failed';

export interface ReaPin {
  name: string;
  repo: string;
  commit: string;
  version: string;
  licence: string;
  node: string;
  downloadMb: number;
  diskMb: number;
}

export interface ReaDoctorView {
  checkedAt: string;
  ran: boolean;
  /** Plain sentences, one per line: what works and what is not installed. */
  lines: string[];
  staticAnalysis: boolean;
  windowsNative: 'present' | 'missing' | 'not-needed';
  engines: { id: string; name: string; installed: boolean; hint: string }[];
  error?: string;
}

export interface ReaStatusView {
  installed: boolean;
  version: string | null;
  commit: string | null;
  installDir: string;
  registration: 'absent' | 'ours' | 'other';
  sizeMb: number | null;
  /** The npm package's Windows native files: in the install, or missing from an install made before they were offered. Null off Windows. */
  addon?: 'present' | 'missing' | null;
  doctor?: ReaDoctorView | null;
}

export interface ReaJobView {
  state: 'idle' | 'running' | 'done' | 'failed';
  steps: Partial<Record<StepId, StepState>>;
  error?: string;
  failedStep?: string;
  /** The line the running step is on. */
  detail?: string;
}

export interface ReaPlanView {
  installDir: string;
  /** The npm package whose native files Start adds (Windows only). */
  addon?: { package: string; version: string; source: string; files: string[]; downloadMb: number } | null;
  totalDownloadMb?: number;
  totalDiskMb?: number;
  steps: { id: StepId; label: string; command: string }[];
  requirements: { name: 'git' | 'node' | 'npm'; ok: boolean; detail: string }[];
  limitations: string[];
  ready: boolean;
}

export interface ReaView {
  pin: ReaPin;
  status: ReaStatusView;
  job: ReaJobView;
  readOnlyTools: number;
  plan?: ReaPlanView;
}

export type ReaAnswer<T> = { ok: true; body: T } | { ok: false; message: string; status: number };

type Fetch = typeof fetch;

export interface ReaClient {
  view(withPlan: boolean, signal?: AbortSignal): Promise<ReaAnswer<ReaView>>;
  install(commit: string): Promise<ReaAnswer<ReaView>>;
  register(): Promise<ReaAnswer<unknown>>;
  remove(): Promise<ReaAnswer<unknown>>;
  /** Run `rea doctor --json` again. */
  recheck?(): Promise<ReaAnswer<ReaView>>;
}

function isView(x: unknown): x is ReaView {
  const v = x as Partial<ReaView> | null;
  return !!v && typeof v === 'object' && !!v.pin && typeof v.pin.commit === 'string' && !!v.status && typeof v.status.installed === 'boolean' && !!v.job && typeof v.job.state === 'string';
}

export function createReaClient(f: Fetch = (i, init) => fetch(i, init)): ReaClient {
  async function call<T>(path: string, init: RequestInit, check: (b: unknown) => b is T): Promise<ReaAnswer<T>> {
    try {
      const res = await f(path, { ...init, headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) } });
      const body = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        const msg = (body as { error?: unknown } | null)?.error;
        return { ok: false, status: res.status, message: typeof msg === 'string' && msg !== '' ? msg : `The server answered ${res.status}.` };
      }
      return check(body) ? { ok: true, body } : { ok: false, status: res.status, message: 'This server does not know about REA yet. Update Sequence.' };
    } catch (e) {
      return { ok: false, status: 0, message: (e as { name?: string }).name === 'AbortError' ? 'cancelled' : `Could not reach the server: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const any = (_: unknown): _ is unknown => true;
  return {
    view: (withPlan, signal) => call(withPlan ? '/api/rea?plan=1' : '/api/rea', { method: 'GET', ...(signal ? { signal } : {}) }, isView),
    install: (commit) => call('/api/rea/install', { method: 'POST', body: JSON.stringify({ confirm: true, commit }) }, isView),
    register: () => call('/api/rea/register', { method: 'POST', body: '{}' }, any),
    remove: () => call('/api/rea', { method: 'DELETE', body: '{}' }, any),
    recheck: () => call('/api/rea/doctor', { method: 'POST', body: '{}' }, isView),
  };
}
