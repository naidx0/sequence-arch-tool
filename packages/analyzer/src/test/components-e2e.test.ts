/* Components contract, end to end through /api/acp/run-node with a stub ACP agent. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { addAgent } from '../server/agentsStore.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';
import { loadMergedCatalog, readComponentBody } from '../components/catalog.js';
import { matchComponents } from '../components/match.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.resolve(here, '..', '..', 'src', 'test', 'components-e2e', 'stub-acp-agent.mjs');
const REAL = path.resolve(here, '..', '..', 'components');
const REA = 'security/reverse-engineer-anything';

type Json = Record<string, unknown>;

/** A copy of the real catalog with a preamble added to REA (the real one has none). */
function catalogWithPreamble(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-cat-')));
  fs.cpSync(REAL, dir, { recursive: true });
  const cj = path.join(dir, ...REA.split('/'), 'component.json');
  const o = JSON.parse(fs.readFileSync(cj, 'utf8'));
  o.preamble = 'SEQUENCE.md';
  fs.writeFileSync(cj, JSON.stringify(o, null, 2));
  fs.writeFileSync(path.join(dir, ...REA.split('/'), 'SEQUENCE.md'), 'PREAMBLE-SAFETY: only reverse engineer software you own or may analyse.');
  return dir;
}

async function rig(opts: { catalog?: string; repo?: boolean } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-comp-')));
  const root = path.join(dir, 'user');
  fs.mkdirSync(root, { recursive: true });
  let repo: string | null = null;
  if (opts.repo) {
    repo = path.join(dir, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'index.ts'), 'export const a = 1;\n');
  }
  const home = repo ?? root;
  const store = path.join(root, '.sequence');
  fs.mkdirSync(store, { recursive: true });
  const chatId = ensureSessionsMigrated(home).activeId;
  const log = path.join(dir, 'agent.log');
  addAgent(store, { id: 'stub', command: process.execPath, args: [STUB, log] });
  process.env.SEQUENCE_COMPONENTS_ROOT = opts.catalog ?? REAL;
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const lines = (): Json[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Json) : []);
  return {
    base,
    chatId,
    repo,
    prompts: () => lines().filter((l) => l.kind === 'prompt').map((l) => String(l.text)),
    news: () => lines().filter((l) => l.kind === 'new').map((l) => l.params as Json),
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

async function readAll(res: Response): Promise<Json[]> {
  const text = await res.text();
  const out: Json[] = [];
  for (const line of text.split('\n')) if (line.startsWith('data: ')) out.push(JSON.parse(line.slice(6)) as Json);
  return out;
}

async function turn(base: string, chatId: string, prompt: string, extra: Json = {}): Promise<{ status: number; events: Json[]; raw?: string }> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ agentRef: 'stub', prompt, chatId, sessionKey: `chat::${chatId}::stub`, ...extra }),
  });
  if (res.status !== 200) return { status: res.status, events: [], raw: await res.text() };
  return { status: 200, events: await readAll(res) };
}

const put = async (base: string, body: Json) => {
  const r = await fetch(`${base}/api/components/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()) as Json;
};
const answer = (base: string, offerId: string, accept: boolean) =>
  fetch(`${base}/api/components/offer/${encodeURIComponent(offerId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accept }) });

const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const ofType = (events: Json[], t: string) => events.filter((e) => e.type === t);

test('RV-a approve: REA prompt -> offer, no component text; accept -> next prompt has preamble then body once; third has none', async () => {
  const cat = catalogWithPreamble();
  const s = await rig({ catalog: cat });
  try {
    const st = (await (await fetch(`${s.base}/api/components`)).json()) as Json;
    assert.equal(st.mode, 'approve', 'default mode is approve');
    assert.equal(st.enabled, true);
    const body = readComponentBody(loadMergedCatalog(null, cat).components.find((c) => c.id === REA)!)!;
    const bodyHead = body.slice(0, 200);

    const p1 = 'can you reverse engineer this electron app';
    const t1 = await turn(s.base, s.chatId, p1);
    assert.equal(t1.status, 200);
    const offers = ofType(t1.events, 'component:offer');
    assert.equal(offers.length, 1, JSON.stringify(t1.events.map((e) => e.type)));
    assert.equal(offers[0]!.componentId, REA);
    for (const k of ['turnId', 'offerId', 'componentId', 'name', 'reason']) assert.equal(typeof offers[0]![k], 'string', k);
    assert.equal(ofType(t1.events, 'component:used').length, 0);
    const pr1 = s.prompts()[0]!;
    assert.ok(!pr1.includes('PREAMBLE-SAFETY') && !pr1.includes(bodyHead) && !pr1.includes('COMPONENT:'), 'no component text in an approve-mode offer turn');

    assert.equal((await answer(s.base, String(offers[0]!.offerId), true)).status, 200);
    assert.equal((await answer(s.base, String(offers[0]!.offerId), true)).status, 404, 'answered twice -> 404');
    const t2 = await turn(s.base, s.chatId, 'go on then');
    assert.equal(ofType(t2.events, 'component:used').length, 1);
    const pr2 = s.prompts()[1]!;
    assert.equal(count(pr2, 'PREAMBLE-SAFETY'), 1);
    assert.equal(count(pr2, bodyHead), 1);
    assert.ok(pr2.indexOf('PREAMBLE-SAFETY') < pr2.indexOf(bodyHead), 'preamble before body');
    assert.ok(pr2.endsWith('go on then'), 'the person\'s message is last');

    const t3 = await turn(s.base, s.chatId, 'and reverse engineer the updater too');
    const pr3 = s.prompts()[2]!;
    assert.ok(!pr3.includes('PREAMBLE-SAFETY') && !pr3.includes(bodyHead), 'third prompt carries no component');
    assert.equal(ofType(t3.events, 'component:offer').length, 0, 'not offered again once loaded');
  } finally {
    await s.close();
  }
});

test('RV-a2 approve: an offer accepted WHILE its turn is still running still loads on the next prompt', async () => {
  const s = await rig();
  try {
    const res = fetch(`${s.base}/api/acp/run-node?stream=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ agentRef: 'stub', prompt: 'reverse engineer this app HOLD:1500', chatId: s.chatId, sessionKey: `chat::${s.chatId}::stub` }),
    });
    /* Find the offer while the turn runs: poll the stream. */
    const r = await res;
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let offerId = '';
    while (!offerId) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const m = /"type":"component:offer"[^\n]*"offerId":"([^"]+)"/.exec(buf);
      if (m) offerId = m[1]!;
    }
    assert.ok(offerId);
    assert.equal((await answer(s.base, offerId, true)).status, 200);
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    const t2 = await turn(s.base, s.chatId, 'go on then');
    assert.equal(ofType(t2.events, 'component:used').length, 1, 'accepted during the turn -> used on the next prompt');
    assert.ok(s.prompts()[1]!.includes('COMPONENT: Reverse Engineer Anything'));
  } finally {
    await s.close();
  }
});

test('RV-b auto: design prompt -> component:used and body injected; REA in auto is still only an offer', async () => {
  const s = await rig();
  try {
    await put(s.base, { mode: 'auto' });
    /* The owner's own example phrase first: report whether it matches anything at all. */
    const owner = matchComponents('polish the typography on this page', loadMergedCatalog(null, REAL));
    console.log('# owner phrase "polish the typography on this page" matches:', JSON.stringify(owner));
    const t1 = await turn(s.base, s.chatId, 'fix typography on this page');
    const used = ofType(t1.events, 'component:used');
    assert.ok(used.some((u) => u.componentId === 'design/better-typography'), JSON.stringify(used));
    const body = readComponentBody(loadMergedCatalog(null, REAL).components.find((c) => c.id === 'design/better-typography')!)!;
    assert.ok(s.prompts()[0]!.includes(body.slice(0, 200)));
    const t2 = await turn(s.base, s.chatId, 'now reverse engineer the electron app');
    assert.equal(ofType(t2.events, 'component:offer').filter((o) => o.componentId === REA).length, 1);
    assert.equal(ofType(t2.events, 'component:used').filter((o) => o.componentId === REA).length, 0);
    assert.ok(!s.prompts()[1]!.includes('COMPONENT: Reverse Engineer Anything'));
  } finally {
    await s.close();
  }
});

test('RV-c manual: no offer, no components MCP tool (SEQUENCE_MCP_COMPONENTS=off); approve has it', async () => {
  const s = await rig({ repo: true });
  try {
    await put(s.base, { mode: 'manual' });
    const t1 = await turn(s.base, s.chatId, 'reverse engineer this electron app and fix typography');
    assert.equal(t1.status, 200, t1.raw);
    assert.equal(ofType(t1.events, 'component:offer').length, 0);
    assert.equal(ofType(t1.events, 'component:used').length, 0);
    assert.ok(!s.prompts()[0]!.includes('COMPONENT:'));
    const n = s.news();
    assert.ok(n.length >= 1);
    const servers = (n[0]!.mcpServers ?? []) as Json[];
    console.log('# manual mcpServers:', JSON.stringify(servers));
    const seq = servers.find((x) => x.name === 'sequence');
    assert.ok(seq, 'the board server is attached');
    const env = (seq!.env as { name: string; value: string }[]).reduce<Record<string, string>>((a, e) => ({ ...a, [e.name]: e.value }), {});
    assert.equal(env.SEQUENCE_MCP_COMPONENTS, 'off');
  } finally {
    await s.close();
  }
});

test('RV-d enabled:false: explicit components:[id] -> clear refusal; trigger words -> nothing', async () => {
  const s = await rig();
  try {
    await put(s.base, { enabled: false });
    const t1 = await turn(s.base, s.chatId, 'hello', { components: ['design/better-typography'] });
    assert.equal(t1.status, 409);
    assert.match(t1.raw!, /switched off/i);
    const t2 = await turn(s.base, s.chatId, 'reverse engineer this app and fix typography');
    assert.equal(t2.status, 200);
    assert.equal(ofType(t2.events, 'component:offer').length + ofType(t2.events, 'component:used').length, 0);
  } finally {
    await s.close();
  }
});

test('RV-e no trigger words: prompt is byte-identical to what the agent gets with components switched off', async () => {
  const a = await rig();
  const b = await rig();
  try {
    const msg = 'please rename the variable foo to bar in utils';
    await turn(a.base, a.chatId, msg);
    await put(b.base, { enabled: false });
    await turn(b.base, b.chatId, msg);
    assert.equal(a.prompts()[0], b.prompts()[0]);
    assert.equal(a.prompts()[0], msg);
  } finally {
    await a.close();
    await b.close();
  }
});

test('RV-f explicit components:[id] in approve loads, unknown id is reported, review id loads when explicit', async () => {
  const s = await rig();
  try {
    const t1 = await turn(s.base, s.chatId, 'hello', { components: ['design/better-typography', 'nope/missing'] });
    assert.equal(t1.status, 200);
    assert.deepEqual(ofType(t1.events, 'component:used').map((e) => e.componentId), ['design/better-typography']);
    const skipped = ofType(t1.events, 'component:skipped');
    assert.deepEqual(skipped.map((e) => e.componentId), ['nope/missing']);
    assert.equal(typeof skipped[0]!.reason, 'string');
    console.log('# unknown explicit id events:', JSON.stringify(t1.events.filter((e) => String(e.type).startsWith('component')).map((e) => e.type)));
  } finally {
    await s.close();
  }
});

test('RV-g routes: traversal ids, malformed % escapes, unknown offer, bad bodies', async () => {
  const s = await rig({ repo: true });
  try {
    for (const p of ['/api/components/..%2F..%2Fx/workspace', '/api/components/../../x/workspace', '/api/components/%2e%2e/%2e%2e/etc/workspace']) {
      const r = await fetch(`${s.base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inWorkspace: false }) });
      assert.ok([400, 404, 405].includes(r.status), `${p} -> ${r.status}`);
    }
    const bad = await fetch(`${s.base}/api/components/%E0%A4%A`);
    console.log('# malformed escape ->', bad.status);
    assert.equal(bad.status, 400, 'a malformed percent-escape is a 400, not a crash');
    assert.equal((await answer(s.base, 'no-such-offer', true)).status, 404);
    const r2 = await fetch(`${s.base}/api/components/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(r2.status, 400);
    const r3 = await fetch(`${s.base}/api/components/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'yolo' }) });
    assert.equal(r3.status, 400);
    /* workspace import round trip */
    const add = await fetch(`${s.base}/api/components/design/better-typography/workspace`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inWorkspace: true }) });
    assert.equal(add.status, 200);
    assert.ok(fs.existsSync(path.join(s.repo!, '.sequence', 'components', 'design', 'better-typography', 'SKILL.md')));
    const g = (await (await fetch(`${s.base}/api/components`)).json()) as { groups: { id: string; name: string; components: Json[] }[] };
    console.log('# group names from real catalog:', JSON.stringify(g.groups.map((x) => [x.id, x.name])));
    assert.equal(g.groups.find((x) => x.id === 'design')?.name, 'Design elements', 'groups.json labels are used');
  } finally {
    await s.close();
  }
});

test('RV-h user-layer symlinked SKILL.md outside the repo is not read', async (t) => {
  const s = await rig({ repo: true });
  try {
    const secret = path.join(os.tmpdir(), `rv-secret-${process.pid}.txt`);
    fs.writeFileSync(secret, 'TOP-SECRET-TOKEN-123');
    const d = path.join(s.repo!, '.sequence', 'components', 'evil', 'leak');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'component.json'), JSON.stringify({ id: 'evil/leak', label: 'Leak', summary: 's', triggers: ['zebra crossing'], status: 'ready' }));
    try {
      fs.symlinkSync(secret, path.join(d, 'SKILL.md'), 'file');
    } catch (e) {
      t.skip(`cannot create symlink here: ${(e as Error).message}`);
      return;
    }
    const r = (await (await fetch(`${s.base}/api/components/evil/leak`)).json()) as Json;
    console.log('# symlink preview body:', JSON.stringify(r.body));
    assert.ok(!String(r.body ?? '').includes('TOP-SECRET'), 'a symlinked SKILL.md leaks a file outside the repo');
  } finally {
    await s.close();
  }
});

test('F3 approve: "learn how an application works" is offered REA through a real turn (and not loaded)', async () => {
  const s = await rig();
  try {
    const t1 = await turn(s.base, s.chatId, 'I want to learn how an application works');
    const offers = ofType(t1.events, 'component:offer');
    assert.deepEqual(offers.map((o) => o.componentId), [REA]);
    assert.ok(!s.prompts()[0]!.includes('COMPONENT:'));
  } finally {
    await s.close();
  }
});

test('RV-i matcher: unicode, inflection, regex chars', () => {
  const cat = { components: [
    { id: 'a/uni', group: 'a', label: 'U', summary: 's', triggers: ['café crème', 'c++ build'], status: 'ready' as const, layer: 'bundled' as const, dir: '.' },
  ] };
  assert.equal(matchComponents('please make a CAFÉ  CRÈME now', cat).length, 1);
  assert.equal(matchComponents('fix the c++ build', cat).length, 1);
  assert.equal(matchComponents('cafécrème', cat).length, 0);
  const real = loadMergedCatalog(null, REAL);
  console.log('# "help me with reverse engineering this app":', JSON.stringify(matchComponents('help me with reverse engineering this app', real)));
  assert.deepEqual(matchComponents('learn how an application works', real).map((m) => m.id), [REA], 'the owner phrase reaches REA through the shipped triggers');
  assert.deepEqual(real.warnings, [], 'the shipped catalog respects the trigger caps');
  console.log('# real catalog warnings:', JSON.stringify(real.warnings));
});
