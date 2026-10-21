/**
 * LOCK - Stop must close the provider connection on every Node we support.
 *
 * Node 20 and 22 reject an aborted fetch but leave its socket open, so a provider keeps generating after Stop.
 * `fetchStoppable` closes the call's own socket; it must never touch a socket whose response has ended.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import http from 'node:http';
import { fetchStoppable } from '../server/stoppableFetch.js';

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));

const connections = (server: http.Server): Promise<number> =>
  new Promise((resolve) => server.getConnections((_e, n) => resolve(n)));

async function closesWithin(server: http.Server, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await connections(server)) === 0) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

test('abort while waiting for the reply closes the connection', async () => {
  let seen: () => void = () => undefined;
  const got = new Promise<void>((r) => (seen = r));
  const hold = http.createServer((req) => {
    req.resume();
    req.on('end', () => seen());
  });
  const port = await listen(hold);
  try {
    const ac = new AbortController();
    const sent = fetchStoppable(`http://127.0.0.1:${port}/x`, { method: 'POST', body: '{}', signal: ac.signal }).catch((e: Error) => e.name);
    await got;
    ac.abort();
    assert.equal(await sent, 'AbortError');
    assert.ok(await closesWithin(hold, 2000), 'the provider connection is released after Stop');
  } finally {
    hold.close();
  }
});

test('abort while the reply is streaming closes the connection', async () => {
  let seen: () => void = () => undefined;
  const got = new Promise<void>((r) => (seen = r));
  const stream = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: first\n\n');
      seen();
    });
  });
  const port = await listen(stream);
  try {
    const ac = new AbortController();
    const res = await fetchStoppable(`http://127.0.0.1:${port}/x`, { method: 'POST', body: '{}', signal: ac.signal });
    await got;
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await reader.read().catch(() => undefined);
    assert.ok(await closesWithin(stream, 2000), 'a streamed answer stops at the provider too');
  } finally {
    stream.close();
  }
});

test('a finished call is never torn down by a late abort: its pooled socket belongs to the next call', async () => {
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      n += 1;
      res.end(`reply ${n}`);
    });
  });
  const port = await listen(server);
  try {
    const first = new AbortController();
    const a = await fetchStoppable(`http://127.0.0.1:${port}/a`, { method: 'POST', body: '{}', signal: first.signal });
    assert.equal(await a.text(), 'reply 1');
    const second = await fetchStoppable(`http://127.0.0.1:${port}/b`, { method: 'POST', body: '{}', signal: new AbortController().signal });
    first.abort(); /* the first call's owner aborts after it already finished, while the second is in flight */
    assert.equal(await second.text(), 'reply 2');
  } finally {
    server.close();
  }
});

test('without a signal it is plain fetch', async () => {
  const server = http.createServer((_req, res) => res.end('plain'));
  const port = await listen(server);
  try {
    assert.equal(await (await fetchStoppable(`http://127.0.0.1:${port}/`)).text(), 'plain');
  } finally {
    server.close();
  }
});
