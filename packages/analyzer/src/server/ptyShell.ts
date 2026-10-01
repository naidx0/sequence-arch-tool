/* ══════════════════════════════════════════════════════════════════════════
   C1.1 — optional real PTY backend for `/api/terminal`
   packages/analyzer/src/server/ptyShell.ts

   `node-pty` needs a native build (pnpm 10 ignores scripts unless listed in
   `onlyBuiltDependencies`). When the binding is missing or spawn fails, the
   terminal stays on the honest pipe shell — never pretend a TTY exists.

   THE TERMINAL SHIPPED (2026-09-02 correction). This said "Terminal remains
   UNSHIPPED in web2 until C1.3–C1.6 (pane + e2e)" long after all of it landed:
   `packages/web2/src/terminal/TerminalPane.tsx` renders it, `terminal` is one of
   the six ids in `chromeTabModel.ts`'s `CHROME_TAB_DEFS`, and `terminal-pane.mjs`
   is in web2's `test:e2e` chain. A comment that says a shipped surface is
   unshipped tells the next reader not to bother looking for it.

   This module remains what it always was: the backend that makes resize/exit
   real when the PTY binding is available, and steps aside honestly when it is not.
   ══════════════════════════════════════════════════════════════════════════ */

export type ShellBackend = 'pty' | 'pipe';

export interface PtySpawnResult {
  backend: 'pty';
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (info: { exitCode: number; signal?: number }) => void): void;
  readonly pid: number | undefined;
}

type PtyModule = {
  spawn: (
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ) => {
    pid: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    onData(cb: (data: string) => void): void;
    onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  };
};

let cachedPty: PtyModule | null | undefined;

/**
 * Probe whether `node-pty` loads. Result is cached for the process lifetime.
 * Returns null when the native binding is missing (common until postinstall).
 */
export async function loadPtyModule(): Promise<PtyModule | null> {
  if (cachedPty !== undefined) return cachedPty;
  try {
    const mod = (await import('node-pty')) as PtyModule;
    if (typeof mod.spawn !== 'function') {
      cachedPty = null;
      return null;
    }
    cachedPty = mod;
    return mod;
  } catch {
    cachedPty = null;
    return null;
  }
}

/** Sync probe after {@link loadPtyModule} (or a prior successful import). */
export function ptyModuleCached(): PtyModule | null {
  return cachedPty ?? null;
}

/** Test hook — reset the load cache. */
export function resetPtyModuleCache(): void {
  cachedPty = undefined;
}

/**
 * Spawn a real PTY shell, or return null so the caller can fall back to pipes.
 */
export function trySpawnPty(
  shell: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  cols = 80,
  rows = 24,
): PtySpawnResult | null {
  const mod = ptyModuleCached();
  if (!mod) return null;
  try {
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') cleanEnv[k] = v;
    }
    cleanEnv.TERM = cleanEnv.TERM || 'xterm-256color';
    const pty = mod.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: cleanEnv,
    });
    return {
      backend: 'pty',
      pid: pty.pid,
      write(data) {
        pty.write(typeof data === 'string' ? data : data.toString('utf8'));
      },
      resize(c, r) {
        if (c > 0 && r > 0) pty.resize(c, r);
      },
      kill() {
        try {
          pty.kill();
        } catch {
          /* already dead */
        }
      },
      onData(cb) {
        pty.onData(cb);
      },
      onExit(cb) {
        pty.onExit(cb);
      },
    };
  } catch {
    return null;
  }
}
