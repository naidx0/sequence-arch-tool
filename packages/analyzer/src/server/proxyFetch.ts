/**
 * A fetch that goes through the proxy named by HTTPS_PROXY / HTTP_PROXY / ALL_PROXY (NO_PROXY respected), for the update
 * check and download. Node 20's global fetch ignores those variables, so on a proxy-only network the check would fail
 * while the Claude bridge download (claudeBridgeInstall.ts coreGet) worked. With no proxy for a url the real fetch is used.
 *
 * Returns the FetchLike shape appUpdate.ts uses: status, headers, a streaming body, json and text. A redirect is returned
 * as is when `redirect: 'manual'` (the update code checks every hop itself) and followed (up to 5) otherwise.
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { proxyChoice, trustedRoots, tunnelPort } from './claudeBridgeInstall.js';
import type { FetchLike } from './appUpdate.js';

type Resp = Awaited<ReturnType<FetchLike>>;

const err = (msg: string, code: string): Error => Object.assign(new Error(msg), { code });

function open(url: string, proxy: URL, headers: Record<string, string>, signal?: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const tlsProxy = proxy.protocol === 'https:';
    const lib = tlsProxy ? https : http;
    const auth = proxy.username || proxy.password ? 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64') : undefined;
    const proxyOpts = { host: proxy.hostname, port: Number(proxy.port) || (tlsProxy ? 443 : 80), ...(signal ? { signal } : {}), ...(tlsProxy ? { ca: trustedRoots() } : {}) };
    const viaProxy = (e: unknown): Error => ((e as { code?: string }).code === 'ECONNRESET' || (e as Error).name === 'AbortError' ? (e as Error) : err(`could not reach the proxy: ${(e as Error).message}`, 'EPROXYCONN'));
    if (u.protocol === 'http:') {
      const req = lib.request({ ...proxyOpts, method: 'GET', path: url, headers: { ...headers, host: u.host, ...(auth ? { 'proxy-authorization': auth } : {}) } }, resolve);
      req.on('error', (e) => reject(viaProxy(e)));
      req.end();
      return;
    }
    const target = `${u.hostname}:${u.port || 443}`;
    const connect = lib.request({ ...proxyOpts, method: 'CONNECT', path: target, headers: { host: target, ...(auth ? { 'proxy-authorization': auth } : {}) } });
    connect.on('error', (e) => reject(viaProxy(e)));
    connect.on('connect', (res, socket) => {
      socket.on('error', reject);
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(err(`the proxy answered ${res.statusCode}`, 'EPROXY'));
      }
      const req = https.get(u, { ...tunnelPort(u), ...(signal ? { signal } : {}), headers, ca: trustedRoots(), createConnection: () => tls.connect({ socket, servername: net.isIP(u.hostname) ? undefined : u.hostname, ca: trustedRoots() }) }, resolve);
      req.on('error', reject);
    });
    connect.end();
  });
}

function toResponse(res: http.IncomingMessage): Resp {
  const status = res.statusCode ?? 0;
  const all = async (): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const c of res) chunks.push(Buffer.from(c as Buffer));
    return Buffer.concat(chunks).toString('utf8');
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => (res.headers[n.toLowerCase()] === undefined ? null : String(res.headers[n.toLowerCase()])) },
    json: async () => JSON.parse(await all()) as unknown,
    text: all,
    body: {
      getReader() {
        const it = res[Symbol.asyncIterator]();
        return {
          read: async () => {
            const r = await it.next();
            return r.done ? { done: true } : { done: false, value: new Uint8Array(r.value as Buffer) };
          },
          cancel: async () => {
            res.destroy();
          },
        };
      },
    },
  };
}

export function proxyAwareFetch(env: NodeJS.ProcessEnv = process.env, direct: FetchLike = fetch as unknown as FetchLike): FetchLike {
  return async (url, init) => {
    let at = url;
    for (let hop = 0; hop < 6; hop += 1) {
      let choice;
      try {
        choice = proxyChoice(at, env);
      } catch {
        choice = null;
      }
      if (!choice) return direct(at, init);
      if ('unsupported' in choice) throw err(`SOCKS proxy (${choice.unsupported}://) is set`, 'ESOCKS');
      const res = toResponse(await open(at, choice.proxy, { 'user-agent': 'sequence-app-update-check', ...(init?.headers ?? {}) }, init?.signal));
      const loc = res.headers.get('location');
      if (init?.redirect === 'manual' || !loc || res.status < 300 || res.status >= 400) return res;
      void res.body?.getReader().cancel?.();
      at = new URL(loc, at).toString();
    }
    throw err('too many redirects', 'EREDIRECT');
  };
}
