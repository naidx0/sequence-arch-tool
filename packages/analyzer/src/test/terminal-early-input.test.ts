import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { attachTerminal } from '../server/terminal.js';
import { resetPtyModuleCache, setPtyModuleForTest } from '../server/ptyShell.js';

/**
 * "Terminal sometimes loads blank." The page sends its size and the first
 * keystrokes the instant the socket opens; the server used to attach its
 * 'message' listener only after awaiting the pty module, so those frames hit no
 * listener. The pty module here loads SLOWLY on purpose.
 */
function fakePty() {
  const calls: string[] = [];
  const spawns: Array<{ cols?: number; rows?: number; cwd?: string }> = [];
  const mod = {
    spawn(_file: string, _args: unknown, o: { cols?: number; rows?: number; cwd?: string }) {
      spawns.push(o);
      return {
        pid: 1,
        write: (d: string) => calls.push(`write:${d}`),
        resize: (c: number, r: number) => calls.push(`resize:${c}x${r}`),
        kill: () => {},
        /* Speaks once, so trySpawnPty treats the pty as ready and applies resizes for real. */
        onData: (cb: (d: string) => void) => void setTimeout(() => cb('$ '), 20),
        onExit: () => {},
      };
    },
  };
  return { mod, calls, spawns };
}

async function withServer(
  getRoot: () => string | null,
  loadPty: () => Promise<unknown>,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer();
  attachTerminal(server, { getRoot, enabled: true, loadPty });
  /* closeAllConnections() does not reach upgraded sockets; a failing assertion must not hang the run. */
  const socks = new Set<{ destroy(): void }>();
  server.on('upgrade', (_q, s) => socks.add(s));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(`ws://127.0.0.1:${port}/api/terminal`);
  } finally {
    for (const s of socks) s.destroy();
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function waitFor(pred: () => boolean, ms = 5000): Promise<boolean> {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

test('resize + first command sent at socket open reach the pty, in order, despite a slow pty load', async () => {
  const f = fakePty();
  resetPtyModuleCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-early-'));
  try {
    await withServer(
      () => root,
      async () => {
        await new Promise((r) => setTimeout(r, 300));
        setPtyModuleForTest(f.mod);
        return f.mod;
      },
      async (url) => {
        const ws = new WebSocket(url);
        await new Promise<void>((r, j) => {
          ws.on('open', () => r());
          ws.on('error', j);
        });
        ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
        ws.send(Buffer.from('echo hi\r'));
        assert.ok(await waitFor(() => f.calls.includes('write:echo hi\r')), `input never reached the pty: ${JSON.stringify(f.calls)}`);
        /* The reported size is applied at spawn (trySpawnPty defers later resizes until the pty has spoken). */
        assert.strictEqual(f.spawns[0]?.cols, 120, 'spawned at the client size, not 80x24');
        assert.strictEqual(f.spawns[0]?.rows, 40);
        assert.strictEqual(f.spawns[0]?.cwd, root, 'cwd is the resolved root');
        ws.close();
      },
    );
  } finally {
    resetPtyModuleCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('zero, negative and absurd resizes are never forwarded to the pty', async () => {
  const f = fakePty();
  resetPtyModuleCache();
  setPtyModuleForTest(f.mod);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-early-'));
  try {
    await withServer(() => root, async () => f.mod, async (url) => {
      const ws = new WebSocket(url);
      await new Promise<void>((r) => ws.on('open', () => r()));
      ws.send(JSON.stringify({ type: 'resize', cols: 0, rows: 0 }));
      ws.send(JSON.stringify({ type: 'resize', cols: -5, rows: 10 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 1e9, rows: 1e9 }));
      ws.send(Buffer.from('x'));
      assert.ok(await waitFor(() => f.calls.includes('write:x')));
      /* Let the fake pty speak, then send live bad sizes and one good one as a control. */
      await new Promise((r) => setTimeout(r, 100));
      ws.send(JSON.stringify({ type: 'resize', cols: 0, rows: 0 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 1001, rows: 30 }));
      ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
      assert.ok(await waitFor(() => f.calls.includes('resize:100x30')), 'the control resize must arrive');
      assert.deepStrictEqual(f.calls.filter((c) => c.startsWith('resize')), ['resize:100x30']);
      assert.strictEqual(f.spawns[0]?.cols, 80, 'spawned at the default, not a bad held size');
      assert.strictEqual(f.spawns[0]?.rows, 24);
      ws.close();
    });
  } finally {
    resetPtyModuleCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a held resize above 1000 is ignored for the spawn size; the last valid held size wins', async () => {
  const f = fakePty();
  resetPtyModuleCache();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-early-'));
  try {
    await withServer(
      () => root,
      async () => {
        await new Promise((r) => setTimeout(r, 200));
        setPtyModuleForTest(f.mod);
        return f.mod;
      },
      async (url) => {
        const ws = new WebSocket(url);
        await new Promise<void>((r) => ws.on('open', () => r()));
        ws.send(JSON.stringify({ type: 'resize', cols: 1e9, rows: 1e9 }));
        ws.send(Buffer.from('y'));
        assert.ok(await waitFor(() => f.calls.includes('write:y')));
        assert.ok((f.spawns[0]?.cols ?? 0) <= 1000 && (f.spawns[0]?.rows ?? 0) <= 1000);
        assert.strictEqual(f.spawns[0]?.cols, 80);
        ws.close();
      },
    );
  } finally {
    resetPtyModuleCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a root that no longer exists closes the socket instead of opening in the process cwd', async () => {
  const f = fakePty();
  resetPtyModuleCache();
  setPtyModuleForTest(f.mod);
  const gone = path.join(os.tmpdir(), `seq-missing-${Date.now()}`);
  await withServer(() => gone, async () => f.mod, async (url) => {
    const ws = new WebSocket(url);
    const closed = new Promise<{ code: number; reason: string }>((r) =>
      ws.on('close', (code, reason) => r({ code, reason: reason.toString() })),
    );
    const c = await closed;
    assert.strictEqual(c.code, 1011);
    assert.match(c.reason, /does not exist/);
    assert.strictEqual(f.spawns.length, 0);
  });
  resetPtyModuleCache();
});
