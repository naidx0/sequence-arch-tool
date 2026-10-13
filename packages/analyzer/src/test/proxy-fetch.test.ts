import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import type { FetchLike } from '../server/appUpdate.js';
import { proxyAwareFetch } from '../server/proxyFetch.js';

/* The update check goes through HTTPS_PROXY. A local server plays the proxy; nothing leaves the machine. */

const direct = ((url: string) => Promise.reject(new Error(`direct fetch used for ${url}`))) as unknown as FetchLike;

function listen(server: http.Server): Promise<number> {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)));
}

test('an http URL goes to the proxy as an absolute-URI GET, with the caller headers, and the body reads as JSON', async () => {
  const seen: { url?: string; host?: string; ua?: string } = {};
  const proxy = http.createServer((req, res) => {
    seen.url = req.url;
    seen.host = req.headers.host;
    seen.ua = String(req.headers['user-agent']);
    res.setHeader('content-type', 'application/json');
    res.end('{"tag_name":"v0.1.8"}');
  });
  const port = await listen(proxy);
  try {
    const f = proxyAwareFetch({ HTTP_PROXY: `http://127.0.0.1:${port}` }, direct);
    const res = await f('http://updates.example.test/latest', { headers: { 'user-agent': 'x-test' } });
    assert.equal(res.ok, true);
    assert.deepEqual(await res.json(), { tag_name: 'v0.1.8' });
    assert.deepEqual(seen, { url: 'http://updates.example.test/latest', host: 'updates.example.test', ua: 'x-test' });
  } finally {
    proxy.close();
  }
});

test('an https URL asks the proxy for a CONNECT tunnel to the right host; a refusal is an error that names it', async () => {
  const targets: string[] = [];
  const proxy = http.createServer();
  proxy.on('connect', (req, socket) => {
    targets.push(req.url ?? '');
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  const port = await listen(proxy);
  try {
    const f = proxyAwareFetch({ HTTPS_PROXY: `http://127.0.0.1:${port}` }, direct);
    await assert.rejects(f('https://api.github.com/repos/x/y/releases/latest'), /the proxy answered 403/);
    assert.deepEqual(targets, ['api.github.com:443']);
  } finally {
    proxy.close();
  }
});

test('with no proxy, or a NO_PROXY match, the real fetch is used; SOCKS is refused in words', async () => {
  const used: string[] = [];
  const stub = (async (u: string) => (used.push(u), { ok: true })) as unknown as FetchLike;
  await proxyAwareFetch({}, stub)('https://api.github.com/a');
  await proxyAwareFetch({ HTTPS_PROXY: 'http://p:1', NO_PROXY: 'github.com' }, stub)('https://api.github.com/b');
  assert.deepEqual(used, ['https://api.github.com/a', 'https://api.github.com/b']);
  await assert.rejects(proxyAwareFetch({ HTTPS_PROXY: 'socks5://p:1' }, stub)('https://api.github.com/c'), /SOCKS/);
});

test('F3: a GET over a CONNECT tunnel names its host without a bogus :80 (the port is passed, 443 by default)', async () => {
  const { default: https } = await import('node:https');
  const { PassThrough } = await import('node:stream');
  const { tunnelPort } = await import('../server/claudeBridgeInstall.js');
  const hostFor = (url: string): string => {
    const u = new URL(url);
    const req = https.request(u, { ...tunnelPort(u), createConnection: () => new PassThrough() as never });
    const h = String(req.getHeader('host'));
    req.on('error', () => undefined);
    req.destroy();
    return h;
  };
  assert.equal(hostFor('https://api.github.com/repos/x/y'), 'api.github.com');
  assert.equal(hostFor('https://registry.npmjs.org/pkg'), 'registry.npmjs.org');
  assert.equal(hostFor('https://mirror.example:8443/pkg'), 'mirror.example:8443');
  /* the control: without the port Node says :80, which is what the tunnel sent before */
  const u = new URL('https://api.github.com/x');
  const bare = https.request(u, { createConnection: () => new PassThrough() as never });
  assert.equal(String(bare.getHeader('host')), 'api.github.com:80');
  bare.on('error', () => undefined);
  bare.destroy();
});

test('NO_PROXY understands IPv6 loopback in every spelling, and ports on names', async () => {
  const { noProxyMatches, proxyChoice } = await import('../server/claudeBridgeInstall.js');
  assert.equal(noProxyMatches('[::1]', '8080', 'localhost,127.0.0.1,::1'), true, 'bare ::1 entry, bracketed URL host');
  assert.equal(noProxyMatches('[::1]', '8080', '[::1]'), true);
  assert.equal(noProxyMatches('[::1]', '8080', '[::1]:8080'), true);
  assert.equal(noProxyMatches('[::1]', '9090', '[::1]:8080'), false, 'a bracketed entry with another port');
  assert.equal(noProxyMatches('example.com', '8080', 'example.com:9090'), false);
  assert.equal(noProxyMatches('example.com', '9090', 'example.com:9090'), true);
  assert.equal(proxyChoice('http://[::1]:4173/api', { HTTP_PROXY: 'http://p:1', NO_PROXY: 'localhost,127.0.0.1,::1' }), null, 'the local server is never proxied');
});
