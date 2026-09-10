/* ══════════════════════════════════════════════════════════════════════════
   TERMINAL WS CLIENT — C1.3
   packages/web2/src/terminal/terminalClient.ts

   Same-origin `/api/terminal`. Binary = stdin/stdout; text = control
   (`backend` announce, `resize`). Does not claim PTY when the server says pipe.
   PURE protocol helper — the pane owns DOM focus and local echo for pipe.
   ══════════════════════════════════════════════════════════════════════════ */

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

function terminalUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/terminal`;
}

/**
 * Open a terminal WebSocket. Resolves once the socket is open (backend announce
 * may arrive immediately after as a text frame).
 */
export function connectTerminal(handlers: TerminalClientHandlers): Promise<TerminalClient> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(terminalUrl());
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
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
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
        reject(new Error('terminal WebSocket failed to open'));
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

/** Rough cols/rows from a pane's client box (mono ~7.2×14). */
export function estimateTerminalSize(widthPx: number, heightPx: number): { cols: number; rows: number } {
  const cols = Math.max(20, Math.floor(widthPx / 7.2));
  const rows = Math.max(8, Math.floor(heightPx / 14));
  return { cols, rows };
}
