/* ══════════════════════════════════════════════════════════════════════════
   THE VERSION WIRE — /api/app/*
   packages/web2/src/settings/versionClient.ts

   The page never talks to GitHub: the local server does (analyzer
   server/appUpdate.ts), reads the day's cache, and downloads, checks and runs
   the installer. This is a narrow client over its four routes with `fetch`
   injected, like settingsClient. Every call answers null on any failure: an
   unreachable server is "no news", never an error on the page.
   ══════════════════════════════════════════════════════════════════════════ */

export interface VersionInfo {
  version: string;
  commit: string | null;
  platform: string;
  arch: string;
  desktop: boolean;
}

export interface UpdateCheck {
  /** Automatic checks are off: this is the cached answer, and only Check now asks GitHub. */
  checkDisabled?: boolean;
  current: string;
  latest: { version: string; tag: string; name: string; htmlUrl: string; publishedAt: string | null; /** The release's own notes (markdown). Absent from an older server. */ notes?: string } | null;
  newer: boolean;
  asset: { name: string; size: number } | null;
  installable: boolean;
  /** A deb install is updated by the package manager: the words saying how. Absent from an older server. */
  manual?: string | null;
  /** The installed desktop app; only it updates by installer. Absent from an older server. */
  desktop?: boolean;
  checkedAt: number | null;
  offline: boolean;
}

export type InstallState = 'idle' | 'downloading' | 'verifying' | 'launching' | 'launched' | 'failed';

export interface InstallJob {
  state: InstallState;
  version: string | null;
  received: number;
  total: number;
  error: string | null;
  howto: string | null;
  file: string | null;
  /** 'in-place' finishes when the app quits; 'dmg' opens an installer. Absent on a server that predates it. */
  installMode?: 'in-place' | 'dmg';
  /** Whether the download reuses the installed files (differential) or is the whole installer (full). */
  mode?: 'differential' | 'full';
  /** Bytes fetched so far (differential), of `fullSize`, the whole installer. */
  downloaded?: number;
  fullSize?: number;
  /** Bytes reused from the installed copy. */
  reused?: number;
  /** Why a differential update fell back to a full one. */
  fallbackReason?: string | null;
}

export interface UpdateSnapshot {
  check: UpdateCheck;
  install: InstallJob;
}

export interface ReleaseNote {
  version: string;
  title: string;
  body: string;
}

export interface VersionClient {
  version(): Promise<VersionInfo | null>;
  update(force?: boolean): Promise<UpdateSnapshot | null>;
  /** Start the install of `version`, the one the button showed; the server refuses any other. */
  install(version: string): Promise<InstallJob | null>;
  releases(): Promise<ReleaseNote[]>;
  /** The automatic update check switch (agent-settings updates.check); absent in older fakes. */
  updateCheck?(): Promise<boolean | null>;
  setUpdateCheck?(on: boolean): Promise<boolean | null>;
}

export function createVersionClient(fetchImpl: typeof fetch = (...a) => fetch(...a)): VersionClient {
  async function json<T>(url: string, init?: RequestInit): Promise<T | null> {
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json', ...(init?.headers ?? {}) }, ...init });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
  return {
    version: () => json<VersionInfo>('/api/app/version'),
    update: (force = false) => json<UpdateSnapshot>(`/api/app/update${force ? '?force=1' : ''}`),
    install: async (version: string) =>
      (await json<{ install: InstallJob }>('/api/app/update/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }) }))?.install ?? null,
    updateCheck: async () => {
      const v = await json<{ updates?: { check?: boolean } }>('/api/agent-settings');
      return typeof v?.updates?.check === 'boolean' ? v.updates.check : v ? true : null;
    },
    setUpdateCheck: async (on: boolean) => {
      const v = await json<{ updates?: { check?: boolean } }>('/api/agent-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updates: { check: on } }) });
      return typeof v?.updates?.check === 'boolean' ? v.updates.check : null;
    },
    releases: async () => (await json<{ notes: ReleaseNote[] }>('/api/app/releases'))?.notes ?? [],
  };
}
