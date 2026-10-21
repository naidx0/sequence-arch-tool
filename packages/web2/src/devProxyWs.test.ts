// @vitest-environment node
/* The sign-in terminal is a WebSocket (/api/terminal?signin=...). In the Vite dev server a proxy entry without
   `ws: true` forwards plain requests but drops the Upgrade, so Sign in, Connect an agent and every terminal
   hang with no answer while the same build served by the app works. This opens a real upgrade through the
   dev server's own proxy table to a stand-in engine. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createServer } from 'vite';

function upgradeThrough(port: number, path: string): Promise<'upgraded' | 'refused'> {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
    const timer = setTimeout(() => { req.destroy(); resolve('refused'); }, 3000);
    req.on('upgrade', (_res, socket) => { clearTimeout(timer); socket.destroy(); resolve('upgraded'); });
    req.on('response', () => { clearTimeout(timer); resolve('refused'); });
    req.on('error', () => { clearTimeout(timer); resolve('refused'); });
    req.end();
  });
}

describe('dev server proxy', () => {
  it('forwards a WebSocket upgrade on /api (the sign-in terminal)', async () => {
    const engine = http.createServer((_req, res) => res.end('engine'));
    engine.on('upgrade', (_req, socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n');
    });
    await new Promise<void>((r) => engine.listen(0, '127.0.0.1', r));
    process.env.SEQUENCE_ENGINE_ORIGIN = `http://127.0.0.1:${(engine.address() as AddressInfo).port}`;
    const { default: config } = await import('../vite.config?engine-origin');
    const vite = await createServer({ configFile: false, logLevel: 'silent', root: process.cwd(), server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: config.server?.proxy } });
    await vite.listen();
    try {
      const port = (vite.httpServer!.address() as AddressInfo).port;
      expect(await upgradeThrough(port, '/api/terminal?signin=codex')).toBe('upgraded');
    } finally {
      await vite.close();
      engine.close();
    }
  }, 30000);
});
