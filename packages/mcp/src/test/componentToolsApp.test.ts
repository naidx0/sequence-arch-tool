/**
 * `components load` as the agent's request: paging (offset, file) and the app's say (approve / auto / refused).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { componentsTool } from '../componentTools.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-components-app-')));
function put(id: string, status: string, body: string): string {
  const dir = path.join(root, ...id.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify({ id, label: id.split('/')[1], summary: 's', triggers: [], status }));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: n\ndescription: d\n---\n${body}\n`);
  return dir;
}
const bigDir = put('g/big', 'ready', `${'a'.repeat(6000)}${'b'.repeat(6000)}${'c'.repeat(1500)}`);
fs.mkdirSync(path.join(bigDir, 'references'));
fs.writeFileSync(path.join(bigDir, 'references', 'p.md'), 'REFERENCE PAGE');
fs.writeFileSync(path.join(root, 'g', 'outside.txt'), 'NOT YOURS');
put('g/small', 'ready', 'SMALL BODY');
put('g/rev', 'review', 'REV BODY');
process.env.SEQUENCE_COMPONENTS_ROOT = root;

const textOf = (r: { content: { text: string }[] }): string => r.content[0]!.text;
const load = (a: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) => componentsTool({ op: 'load', ...a } as never, undefined, env);

test('a big skill pages: the first block names where the rest is; offset reads on to the end', async () => {
  const first = textOf(await load({ id: 'g/big' }));
  assert.match(first, /\[Cut at 6000 characters\..*components load.*offset/s);
  assert.ok(first.includes(bigDir.split(path.sep).join('/')), 'names the absolute folder');
  const p2 = textOf(await load({ id: 'g/big', offset: 6000 }));
  assert.ok(p2.startsWith('b'.repeat(6000)) && p2.includes('call load again with offset 12000'));
  const p3 = textOf(await load({ id: 'g/big', offset: 12000 }));
  assert.equal(p3, 'c'.repeat(1500));
  assert.match(textOf(await load({ id: 'g/big', offset: 99999 })), /nothing at offset 99999/);
});

test('file reads a references/ page inside the pack, and refuses anything outside it', async () => {
  assert.equal(textOf(await load({ id: 'g/big', file: 'references/p.md' })), 'REFERENCE PAGE');
  for (const f of ['../outside.txt', '../../g/outside.txt', path.join(root, 'g', 'outside.txt'), 'references']) {
    const r = await load({ id: 'g/big', file: f });
    assert.equal(r.isError, true, f);
    assert.ok(!textOf(r).includes('NOT YOURS'));
  }
});

async function app(decision: Record<string, unknown>): Promise<{ env: NodeJS.ProcessEnv; seen: unknown[]; close: () => Promise<void> }> {
  const seen: unknown[] = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      seen.push({ url: req.url, body: JSON.parse(b) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(decision));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { env: { SEQUENCE_COMPONENTS_URL: `http://127.0.0.1:${port}`, SEQUENCE_COMPONENTS_KEY: 'chat::c::claude' }, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('approve: the app raises a card and the body is withheld; auto: the body; refused: the reason', async () => {
  const a = await app({ decision: 'offer', raised: true });
  try {
    const r = textOf(await load({ id: 'g/small' }, a.env));
    assert.match(r, /needs the person's approval/);
    assert.ok(!r.includes('SMALL BODY'));
    assert.deepEqual(a.seen, [{ url: '/api/components/request', body: { key: 'chat::c::claude', componentId: 'g/small' } }]);
  } finally {
    await a.close();
  }
  const b = await app({ decision: 'load' });
  try {
    assert.equal(textOf(await load({ id: 'g/small' }, b.env)), 'COMPONENT: small\nSMALL BODY');
  } finally {
    await b.close();
  }
  const c = await app({ decision: 'refused', message: 'The person set components to manual.' });
  try {
    assert.equal(textOf(await load({ id: 'g/small' }, c.env)), 'The person set components to manual.');
  } finally {
    await c.close();
  }
});

test('a Sequence session with no app address loads only in auto (the mode it was started with)', async () => {
  for (const mode of ['approve', 'manual']) {
    const r = textOf(await load({ id: 'g/small' }, { SEQUENCE_COMPONENTS_MODE: mode }));
    assert.match(r, /needs the person's approval/, mode);
    assert.ok(!r.includes('SMALL BODY'));
  }
  assert.equal(textOf(await load({ id: 'g/small' }, { SEQUENCE_COMPONENTS_MODE: 'auto' })), 'COMPONENT: small\nSMALL BODY');
  assert.match(textOf(await load({ id: 'g/rev' }, { SEQUENCE_COMPONENTS_MODE: 'auto' })), /needs the person's approval/, 'review still asks in auto');
});

test('an app that cannot be reached means ask the person, never load; a standalone install loads, except review packs', async () => {
  const dead = { SEQUENCE_COMPONENTS_URL: 'http://127.0.0.1:1' };
  assert.match(textOf(await load({ id: 'g/small' }, dead)), /needs the person's approval/);
  assert.equal(textOf(await load({ id: 'g/small' })), 'COMPONENT: small\nSMALL BODY');
  assert.match(textOf(await load({ id: 'g/rev' })), /needs the person's approval/);
});
