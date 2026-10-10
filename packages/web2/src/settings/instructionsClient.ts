/* ══════════════════════════════════════════════════════════════════════════
   AGENTS.md: WHERE IT LIVES, AND ITS TEXT
   packages/web2/src/settings/instructionsClient.ts

   Uses the file routes the server already has, adds none:

     GET /api/status      the attached project's root (absent: nothing attached)
     GET /api/workspace   the home workspace's root, when no project is attached
     GET /api/file?path=AGENTS.md&optional=1   the text (204: not created yet; a 404 would be a console error)
     PUT /api/file { path, content } the same jailed save the Files view uses

   The server jails every path to that root, so this can only ever touch
   AGENTS.md at the top of the open project (or the home workspace).
   ══════════════════════════════════════════════════════════════════════════ */

export const INSTRUCTIONS_FILE = 'AGENTS.md';

export interface InstructionsView {
  /** The folder the file lives in (absolute), or null when the server did not say. */
  root: string | null;
  /** Whether the folder is an opened project (true) or the home workspace (false). */
  project: boolean;
  exists: boolean;
  text: string;
}

export type InstructionsAnswer<T> = { outcome: 'ok'; body: T } | { outcome: 'failed'; message: string };

export interface InstructionsClient {
  read(): Promise<InstructionsAnswer<InstructionsView>>;
  write(text: string): Promise<InstructionsAnswer<{ bytes: number }>>;
}

/** "/home/dev/shop" and "AGENTS.md" to "/home/dev/shop/AGENTS.md". */
export function instructionsPath(root: string | null): string {
  if (!root) return INSTRUCTIONS_FILE;
  return `${root.replace(/[\\/]+$/, '')}/${INSTRUCTIONS_FILE}`;
}

async function jsonOf(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function createInstructionsClient(fetchImpl: typeof fetch = (...a) => fetch(...a)): InstructionsClient {
  return {
    async read() {
      try {
        let root: string | null = null;
        let project = false;
        const status = await fetchImpl('/api/status');
        if (status.ok) {
          const b = await jsonOf(status);
          if (b?.attached === true && typeof b.root === 'string') {
            root = b.root;
            project = true;
          }
        }
        if (root === null) {
          const ws = await fetchImpl('/api/workspace');
          if (ws.ok) {
            const b = await jsonOf(ws);
            if (typeof b?.root === 'string') root = b.root;
          }
        }
        const res = await fetchImpl(`/api/file?path=${encodeURIComponent(INSTRUCTIONS_FILE)}&optional=1`);
        if (res.status === 204 || res.status === 404) return { outcome: 'ok', body: { root, project, exists: false, text: '' } };
        if (!res.ok) {
          const b = await jsonOf(res);
          return { outcome: 'failed', message: typeof b?.error === 'string' ? b.error : `The server answered ${res.status}.` };
        }
        return { outcome: 'ok', body: { root, project, exists: true, text: await res.text() } };
      } catch {
        return { outcome: 'failed', message: 'The server could not be reached.' };
      }
    },
    async write(text) {
      try {
        const res = await fetchImpl('/api/file', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: INSTRUCTIONS_FILE, content: text }),
        });
        if (!res.ok) {
          const b = await jsonOf(res);
          return { outcome: 'failed', message: typeof b?.error === 'string' ? b.error : `The server answered ${res.status}.` };
        }
        return { outcome: 'ok', body: { bytes: new TextEncoder().encode(text).length } };
      } catch {
        return { outcome: 'failed', message: 'The server could not be reached.' };
      }
    },
  };
}
