/**
 * The terminal WebSocket — the ONE non-HTTP surface on the server.
 * Path `/api/terminal`; implementation in `packages/analyzer/src/server/terminal.ts`.
 *
 * **Backend (C1.1):** prefer a real PTY (`node-pty`) when the native binding loads;
 * otherwise fall back to plain stdio pipes. The server announces which path is live
 * once as a TEXT {@link TerminalBackendMessage} — never claim PTY when the binding
 * is missing.
 *
 * Pipe-only consequences a terminal UI must not paper over:
 *
 *  1. **No TTY echo or line editing.** The UI must render local echo itself, or
 *     the user types into a void. Command OUTPUT still flows normally.
 *  2. **Programs that need a TTY misbehave** — `vi`, coloured prompts, anything
 *     that probes `isatty`.
 *  3. **Resize is a no-op on pipe.** A {@link TerminalResizeMessage} seeds
 *     `COLUMNS`/`LINES` at spawn, but a running pipe shell has no winsize.
 *     On PTY, the same message calls `pty.resize`.
 */

/** The upgrade path. A different path is not upgraded at all. */
export type TerminalWsPath = '/api/terminal';

/** Which shell transport the server actually opened. */
export type TerminalBackend = 'pty' | 'pipe';

/**
 * Server → client announce, sent once as a TEXT frame after the handshake.
 * Clients must not assume PTY until this arrives with `backend: 'pty'`.
 */
export interface TerminalBackendMessage {
  type: 'backend';
  backend: TerminalBackend;
}

/**
 * Client → server control message. On PTY this updates winsize; on pipe it is
 * accepted but does not reflow a running shell (see file header).
 */
export interface TerminalResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

/**
 * TEXT frames are JSON control messages.
 * - client → server: {@link TerminalResizeMessage}
 * - server → client: {@link TerminalBackendMessage}
 */
export type TerminalControlMessage = TerminalResizeMessage | TerminalBackendMessage;

/**
 * Frame discipline, stated as a type because it is the part clients get wrong:
 *
 *  - client → server, **binary** frame = raw stdin bytes;
 *  - client → server, **text** frame = a JSON {@link TerminalResizeMessage};
 *  - server → client, **binary** frame = interleaved stdout + stderr (PTY data
 *    or pipe stdout/stderr);
 *  - server → client, **text** frame = {@link TerminalBackendMessage} (once).
 *
 * Nothing is logged in either direction. Exit is signalled by closing the socket
 * with a reason string (e.g. `shell exited (code 0)`).
 */
export type TerminalBinaryFrame = Uint8Array;

/**
 * The five ordered guards on the upgrade, each of which simply closes the socket:
 * path → origin (DNS-rebinding / cross-origin check) → enabled
 * (`SEQUENCE_DISABLE_TERMINAL` and the server option) → `requireRepo` → the cap of
 * 8 concurrent terminals (`MAX_TERMINALS`).
 *
 * Under auth there is a sixth: a valid session that is also the repo OWNER, which
 * answers `401` on the raw socket before any 101 handshake completes.
 */
export type TerminalUpgradeRefusal =
  | 'path'
  | 'origin'
  | 'disabled'
  | 'no-repo'
  | 'at-capacity'
  | 'unauthorized';
