import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { connectTerminal, estimateTerminalSize, stripTerminalControlSequences } from './terminalClient';

describe('terminalClient helpers (C1.3)', () => {
  it('estimates a usable cols/rows floor', () => {
    expect(estimateTerminalSize(720, 280)).toEqual({ cols: 100, rows: 20 });
    expect(estimateTerminalSize(10, 10)).toEqual({ cols: 20, rows: 8 });
  });

  it('strips CSI colour / mode sequences from PTY output', () => {
    expect(stripTerminalControlSequences('\x1b[36mworkspace\x1b[0m $')).toBe('workspace $');
    expect(stripTerminalControlSequences('\x1b[?2004lhi\x1b[?2004h')).toBe('hi');
  });
});

type Listener = (ev?: unknown) => void;

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  binaryType = 'blob';
  sent: Array<string | ArrayBuffer | Uint8Array> = [];
  private listeners = new Map<string, Listener[]>();

  constructor(public url: string) {
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    });
  }

  addEventListener(type: string, fn: Listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string | ArrayBuffer | Uint8Array) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code: 1000, reason: 'test close' });
  }

  emit(type: string, ev: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  deliverBackend(backend: 'pty' | 'pipe') {
    this.emit('message', { data: JSON.stringify({ type: 'backend', backend }) });
  }

  deliverOutput(text: string) {
    /* Browser WS binaryType=arraybuffer delivers ArrayBuffer; some fakes use views. */
    this.emit('message', { data: new TextEncoder().encode(text) });
  }
}

describe('terminalClient connect framing (C1.3)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: { protocol: 'http:', host: '127.0.0.1:4173' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wires binary output, backend text, resize JSON, and stdin bytes', async () => {
    let constructed: FakeWebSocket | null = null;
    class TrackingWs extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        constructed = this;
      }
    }
    vi.stubGlobal('WebSocket', TrackingWs);

    const backends: string[] = [];
    const outputs: string[] = [];
    const client = await connectTerminal({
      onBackend: (b) => backends.push(b),
      onOutput: (bytes) => outputs.push(new TextDecoder().decode(bytes)),
    });

    expect(constructed).toBeTruthy();
    expect(constructed!.url).toBe('ws://127.0.0.1:4173/api/terminal');

    constructed!.deliverBackend('pipe');
    expect(backends).toEqual(['pipe']);

    constructed!.deliverOutput('hello');
    expect(outputs).toEqual(['hello']);

    client.resize(80, 24);
    expect(constructed!.sent).toContainEqual(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));

    client.sendInput('x');
    const last = constructed!.sent.at(-1);
    expect(ArrayBuffer.isView(last)).toBe(true);
    const view = last as unknown as ArrayBufferView;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    expect(new TextDecoder().decode(bytes)).toBe('x');
  });
});
