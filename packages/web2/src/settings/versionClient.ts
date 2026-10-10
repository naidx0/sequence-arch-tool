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
  current: string;
  latest: { version: string; tag: string; name: string; htmlUrl: string; publishedAt: string | null } | null;
  newer: boolean;
  asset: { name: string; size: number } | null;
  installable: boolean;
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
    releases: async () => (await json<{ notes: ReleaseNote[] }>('/api/app/releases'))?.notes ?? [],
  };
}
