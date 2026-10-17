/**
 * Components: review fixes. Groups format, symlink containment, stem matching, mid-turn accepts,
 * skipped events, adhoc offers and the agent-facing /request route.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ThreadNoteLedger } from '../harness/refineNotes.js';
import { loadCatalog, loadMergedCatalog, readComponentFile, userCatalogRoot } from '../components/catalog.js';
import { matchComponents } from '../components/match.js';
import { OfferBook, componentEvents, markComponents, planComponents } from '../components/inject.js';
import { handleComponentsRoute } from '../components/routes.js';
import { componentsLaunchOpts, writeComponentSettings } from '../components/settings.js';

const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

function put(root: string, id: string, o: { status?: string; triggers?: string[]; body?: string; extra?: Record<string, unknown> } = {}): void {
  const dir = path.join(root, ...id.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  const status = o.status ?? 'ready';
  const meta = { id, label: id.split('/')[1], summary: `about ${id}`, triggers: o.triggers ?? [], status, ...(status === 'link-only' ? { url: 'https://example.com/x' } : {}), ...o.extra };
  fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify(meta));
  if (status !== 'link-only') fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: n\ndescription: d\n---\n${o.body ?? `BODY of ${id}`}\n`);
}

function fixture(): string {
  const root = tmp('components-h-');
  fs.writeFileSync(path.join(root, 'groups.json'), JSON.stringify({ groups: [{ id: 'design', label: 'Design elements' }, { id: 'security', label: 'Security' }] }));
  put(root, 'design/charts', { triggers: ['bar chart'] });
  put(root, 'design/linked', { status: 'link-only' });
  put(root, 'security/reverse-engineer-anything', { status: 'review', triggers: ['reverse engineer'] });
  return root;
}

const ctx = (catalog: ReturnType<typeof loadCatalog>, over: Partial<Parameters<typeof planComponents>[0]> = {}): Parameters<typeof planComponents>[0] => ({
  catalog,
  prompt: 'hello',
  enabled: true,
  mode: 'approve',
  noteKey: 'chat::c1::claude',
  thread: 't1',
  ledger: new ThreadNoteLedger(),
  offers: new OfferBook(),
  ...over,
});

test('groups.json: the shipped {"groups": [...]} form and a bare list both read; garbage warns', () => {
  const a = tmp('components-g1-');
  fs.writeFileSync(path.join(a, 'groups.json'), JSON.stringify({ groups: [{ id: 'design', label: 'Design elements' }] }));
  put(a, 'design/x');
  assert.deepEqual(loadCatalog(a).groups, [{ id: 'design', label: 'Design elements', summary: '' }]);
  const b = tmp('components-g2-');
  fs.writeFileSync(path.join(b, 'groups.json'), JSON.stringify([{ id: 'design', label: 'D' }]));
  assert.equal(loadCatalog(b).groups[0]!.label, 'D');
  const c = tmp('components-g3-');
  fs.writeFileSync(path.join(c, 'groups.json'), '"nope"');
  assert.ok(loadCatalog(c).warnings.some((w) => w.startsWith('groups.json:')));
});

test('symlinks: a SKILL.md or preamble resolving outside its folder is refused, and a symlinked folder in the user layer is not walked', (t) => {
  const outside = path.join(tmp('components-out-'), 'secret.txt');
  fs.writeFileSync(outside, 'TOP-SECRET');
  const root = tmp('components-sym-');
  put(root, 'g/ok', { triggers: ['ok'] });
  put(root, 'g/leak', { triggers: ['leak'] });
  put(root, 'g/pre', { triggers: ['pre'], extra: { preamble: 'P.md' } });
  fs.writeFileSync(path.join(root, 'g/pre/P.md'), 'p');
  try {
    fs.rmSync(path.join(root, 'g/leak/SKILL.md'));
    fs.symlinkSync(outside, path.join(root, 'g/leak/SKILL.md'), 'file');
    fs.rmSync(path.join(root, 'g/pre/P.md'));
    fs.symlinkSync(outside, path.join(root, 'g/pre/P.md'), 'file');
  } catch (e) {
    t.skip(`cannot create symlinks here: ${(e as Error).message}`);
    return;
  }
  const c = loadCatalog(root);
  assert.deepEqual(c.components.map((x) => x.id), ['g/ok']);
  assert.ok(c.warnings.some((w) => w.startsWith('g/leak:')) && c.warnings.some((w) => w.startsWith('g/pre:')), c.warnings.join('|'));
  const repo = tmp('components-symrepo-');
  const real = tmp('components-real-');
  put(real, 'evil/dir', { triggers: ['x'] });
  fs.mkdirSync(path.join(userCatalogRoot(repo), 'evil'), { recursive: true });
  fs.symlinkSync(path.join(real, 'evil', 'dir'), path.join(userCatalogRoot(repo), 'evil', 'dir'), 'junction');
  assert.deepEqual(loadMergedCatalog(repo, root).components.map((x) => x.id), ['g/ok']);
});

test('readComponentFile: only files inside the component folder', () => {
  const root = tmp('components-file-');
  put(root, 'g/a', { triggers: ['a'] });
  fs.mkdirSync(path.join(root, 'g/a/references'));
  fs.writeFileSync(path.join(root, 'g/a/references/p.md'), 'PAGE');
  fs.writeFileSync(path.join(root, 'g/secret.txt'), 'NO');
  const e = loadCatalog(root).components[0]!;
  assert.equal(readComponentFile(e, 'references/p.md'), 'PAGE');
  for (const bad of ['../secret.txt', '../../g/secret.txt', path.join(root, 'g/secret.txt'), 'references', 'missing.md', '']) assert.equal(readComponentFile(e, bad), null, bad);
});

test('match: stems and a 4-word window', () => {
  const root = tmp('components-stem-');
  put(root, 'security/rea', { triggers: ['reverse engineer', 'decompile'] });
  put(root, 'design/polish', { triggers: ['polish'] });
  const c = loadCatalog(root);
  const ids = (p: string): string[] => matchComponents(p, c).map((m) => m.id);
  for (const p of ['I am reverse engineering this', 'reverse engineered it', 'help me reverse-engineer a binary', 'we reverse the thing then engineer it', 'decompiling the jar', 'decompiled output']) assert.deepEqual(ids(p), ['security/rea'], p);
  for (const p of ['polishing the page', 'polished UI', 'polish it']) assert.deepEqual(ids(p), ['design/polish'], p);
  assert.deepEqual(ids('engineer the reverse proxy'), [], 'order matters');
  assert.deepEqual(ids('reverse one two three four five engineer'), [], 'beyond the window');
  assert.deepEqual(ids('reverse one two three engineer'), ['security/rea'], 'inside the window');
  assert.deepEqual(ids('polishedness'), [], 'a stem is not found inside an unrelated word');
});

test('an offer accepted while its turn runs is not consumed by that turn', () => {
  const c = loadCatalog(fixture());
  const base = ctx(c, { prompt: 'bar chart please' });
  const first = planComponents(base);
  base.offers.answer(first.offers[0]!.offerId, true);
  markComponents(first, base.noteKey, base.thread, base.ledger, base.offers, c);
  const next = planComponents({ ...base, prompt: 'ok' });
  assert.match(next.text, /^COMPONENT: charts/);
  markComponents(next, base.noteKey, base.thread, base.ledger, base.offers, c);
  assert.equal(planComponents({ ...base, prompt: 'ok again' }).text, '', 'then it resolves');
});

test('an unknown or link-only explicit id is reported as component:skipped with a reason', () => {
  const c = loadCatalog(fixture());
  const p = planComponents(ctx(c, { prompt: 'x', forced: ['nope/x', 'design/linked'] }));
  const ev = componentEvents(p, 'turn9').filter((e) => e.type === 'component:skipped');
  assert.deepEqual(ev.map((e) => [e.componentId, e.turnId]), [['nope/x', 'turn9'], ['design/linked', 'turn9']]);
  assert.ok(ev.every((e) => typeof e.reason === 'string' && e.reason !== ''));
});

test('offers for a chat-less key can be dropped with the turn, and the chat ones stay', () => {
  const book = new OfferBook();
  const o = { componentId: 'a/b', name: 'B', reason: 'r' };
  book.open('adhoc::stub::t1', o);
  book.open('chat::c::stub', o);
  book.forget('adhoc::stub::t1');
  assert.notEqual(book.open('adhoc::stub::t1', o), null, 'the adhoc one was dropped');
  assert.equal(book.open('chat::c::stub', o), null, 'the chat one is kept');
});

test('routes: a malformed percent-escape is a 400; /request raises a card in approve, loads in auto, refuses in manual or off', async () => {
  const root = fixture();
  const store = tmp('components-req-');
  const events: Record<string, unknown>[] = [];
  const offers = new OfferBook();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    void handleComponentsRoute({
      req,
      res,
      method: req.method ?? 'GET',
      pathname: url.pathname,
      storeDir: store,
      repoRoot: null,
      offers,
      bundledRoot: root,
      emit: (_k, ev) => {
        events.push(ev);
        return true;
      },
      readBody: () =>
        new Promise((resolve) => {
          let b = '';
          req.on('data', (d) => (b += d));
          req.on('end', () => resolve(b));
        }),
    }).then((h) => {
      if (!h) {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const ask = async (body: unknown): Promise<{ status: number; json: any }> => {
    const r = await fetch(`${base}/api/components/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  try {
    assert.equal((await fetch(`${base}/api/components/%E0%A4%A`)).status, 400);
    const a = await ask({ key: 'chat::c::claude', componentId: 'design/charts' });
    assert.deepEqual(a.json, { decision: 'offer', raised: true });
    assert.equal(events[0]!.type, 'component:offer');
    assert.equal(events[0]!.componentId, 'design/charts');
    assert.equal((await ask({ key: 'chat::c::claude', componentId: 'design/charts' })).json.raised, false, 'not raised twice');
    assert.equal((await ask({ key: 'k', componentId: 'nope/x' })).status, 404);
    writeComponentSettings(store, { mode: 'auto' });
    assert.equal((await ask({ key: 'k', componentId: 'design/charts' })).json.decision, 'load');
    assert.equal((await ask({ key: 'k', componentId: 'security/reverse-engineer-anything' })).json.decision, 'offer', 'review always asks');
    writeComponentSettings(store, { mode: 'manual' });
    assert.equal((await ask({ key: 'k', componentId: 'design/charts' })).json.decision, 'refused');
    writeComponentSettings(store, { mode: 'auto', enabled: false });
    assert.equal((await ask({ key: 'k', componentId: 'design/charts' })).json.decision, 'refused');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('match: a long trigger against a long prompt is linear, not exponential', () => {
  const trigger = Array.from({ length: 15 }, () => 'go').join(' ');
  const cat = { components: [{ id: 'a/b', group: 'a', label: 'B', summary: 's', triggers: [trigger], status: 'ready' as const, layer: 'bundled' as const, dir: '.' }] };
  const prompt = Array.from({ length: 2000 }, () => 'go').join(' ');
  const t0 = performance.now();
  assert.equal(matchComponents(prompt, cat).length, 1);
  assert.equal(matchComponents(`${'go '.repeat(14)}stop`, cat).length, 0);
  const ms = performance.now() - t0;
  assert.ok(ms < 50, `${ms.toFixed(1)} ms`);
});

test('catalog: triggers over 8 per component, 8 words or 64 characters skip the component with a warning', () => {
  const root = tmp('components-caps-');
  put(root, 'g/ok', { triggers: ['one two three four five six seven eight', 'x'.repeat(64)] });
  put(root, 'g/many', { triggers: Array.from({ length: 9 }, (_v, i) => `t${i}`) });
  put(root, 'g/words', { triggers: ['one two three four five six seven eight nine'] });
  put(root, 'g/chars', { triggers: ['x'.repeat(65)] });
  const c = loadCatalog(root);
  assert.deepEqual(c.components.map((x) => x.id), ['g/ok']);
  for (const id of ['g/many', 'g/words', 'g/chars']) assert.ok(c.warnings.some((w) => w.startsWith(`${id}:`)), id);
});

test('every launch site passes the same components options: tool presence, mode, and where to ask', () => {
  assert.deepEqual(componentsLaunchOpts({ enabled: true, mode: 'approve' }), { components: true, componentsMode: 'approve' });
  assert.deepEqual(componentsLaunchOpts({ enabled: true, mode: 'manual' }), { components: false, componentsMode: 'manual' });
  assert.deepEqual(componentsLaunchOpts({ enabled: false, mode: 'auto' }), { components: false, componentsMode: 'auto' });
  assert.deepEqual(componentsLaunchOpts({ enabled: true, mode: 'auto' }, { url: 'http://127.0.0.1:1', key: 'chat::c::claude' }), { components: true, componentsMode: 'auto', componentsUrl: 'http://127.0.0.1:1', componentsKey: 'chat::c::claude' });
  assert.deepEqual(componentsLaunchOpts({ enabled: true, mode: 'auto' }, { key: 'orphan' }), { components: true, componentsMode: 'auto' }, 'a key without an address is dropped');
});
