/* ══════════════════════════════════════════════════════════════════════════
   TERMINAL WS CLIENT — C1.3
   packages/web2/src/terminal/terminalClient.ts

   Same-origin `/api/terminal`. Binary = stdin/stdout; text = control
   (`backend` announce, `resize`). Does not claim PTY when the server says pipe.
   PURE protocol helper — the pane owns DOM focus and local echo for pipe.
   ══════════════════════════════════════════════════════════════════════════ */

import { resizeMessage } from './terminalFit';

export type TerminalBackend = 'pty' | 'pipe';

export type TerminalClientHandlers = {
  onOutput: (bytes: Uint8Array) => void;
  onBackend?: (backend: TerminalBackend) => void;
  onClose?: (info: { code: number; reason: string }) => void;
  onError?: (message: string) => void;
};

export type TerminalClient = {
  sendInput: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  readonly readyState: number;
};

function terminalUrl(signIn?: string, launch?: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const q = signIn ? `?signin=${encodeURIComponent(signIn)}` : launch ? `?launch=${encodeURIComponent(launch)}` : '';
  return `${proto}//${window.location.host}/api/terminal${q}`;
}

/**
 * Open a terminal WebSocket. Resolves once the socket is open (backend announce
 * may arrive immediately after as a text frame).
 */
export function connectTerminal(
  handlers: TerminalClientHandlers,
  /** A provider id: run that vendor's sign-in command instead of a shell. */
  signIn?: string,
  /** Round 7: a launch the server recorded (Start Claude Code with hooks): run it instead of a shell. */
  launch?: string,
): Promise<TerminalClient> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(terminalUrl(signIn, launch));
    ws.binaryType = 'arraybuffer';

    const client: TerminalClient = {
      sendInput(data) {
        if (ws.readyState !== WebSocket.OPEN) return;
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        ws.send(bytes);
      },
      resize(cols, rows) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (!(cols > 0 && rows > 0)) return;
        ws.send(resizeMessage(cols, rows));
      },
      close() {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      },
      get readyState() {
        return ws.readyState;
      },
    };

    ws.addEventListener('open', () => {
      if (settled) return;
      settled = true;
      resolve(client);
    });

    ws.addEventListener('message', (ev) => {
      if (typeof ev.data === 'string') {
        try {
          const msg = JSON.parse(ev.data) as { type?: string; backend?: string };
          if (msg.type === 'backend' && (msg.backend === 'pty' || msg.backend === 'pipe')) {
            handlers.onBackend?.(msg.backend);
          }
        } catch {
          /* ignore unknown text */
        }
        return;
      }
      let buf: Uint8Array;
      if (ev.data instanceof ArrayBuffer) {
        buf = new Uint8Array(ev.data);
      } else if (ArrayBuffer.isView(ev.data)) {
        const view = ev.data as ArrayBufferView;
        buf = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      } else {
        buf = new Uint8Array(0);
      }
      if (buf.length) handlers.onOutput(buf);
    });

    ws.addEventListener('close', (ev) => {
      handlers.onClose?.({ code: ev.code, reason: ev.reason || '' });
    });

    ws.addEventListener('error', () => {
      if (!settled) {
        settled = true;
        /* A browser hides the handshake's HTTP status, so none is attached here; a transport that does know it
           (tests, a native client) can set `status` and the pane will not retry a 403 / 429. */
        reject(Object.assign(new Error('terminal WebSocket failed to open'), { status: undefined as number | undefined }));
        return;
      }
      handlers.onError?.('terminal WebSocket error');
    });
  });
}

/** Strip CSI / OSC so a mono pre does not paint raw PTY control soup. */
export function stripTerminalControlSequences(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '');
}

/**
 * Append output to what is on screen, keeping the first line at the TOP of the pane.
 *
 * A ConPTY / PTY opens by painting its whole screen as blank lines and then the prompt at the cursor's
 * row. We strip the cursor-positioning escapes (a mono <pre> cannot honour them), so what is left is a
 * screenful of blank lines ahead of the prompt, which is what pushed the prompt to the bottom of the pane
 * (owner: "terminal should start at the top and go top down, instead of bottom up"). Whitespace that
 * arrives before any visible character carries no information, so it is dropped.
 */
export function appendTerminalOutput(prev: string, chunk: string): string {
  /* Drop blank LINES (up to the last newline before the first visible character), keep that line's indentation. */
  if (prev.trim() === '') return chunk.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/^[ \t]+$/, '');
  return prev + chunk;
}

/** Rough cols/rows from a pane's client box (mono ~7.2×14). */
export function estimateTerminalSize(widthPx: number, heightPx: number): { cols: number; rows: number } {
  const cols = Math.max(20, Math.floor(widthPx / 7.2));
  const rows = Math.max(8, Math.floor(heightPx / 14));
  return { cols, rows };
}
