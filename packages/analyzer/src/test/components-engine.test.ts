/**
 * The components engine (src/components/*): catalog, matcher, settings, the run-node seam and the routes.
 * Fixtures are written to a temp dir; nothing here reads the real bundled catalog.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ThreadNoteLedger } from '../harness/refineNotes.js';
import { bundledCatalogRoot, loadCatalog, loadMergedCatalog, readComponentBody, userCatalogRoot } from '../components/catalog.js';
import { matchComponents } from '../components/match.js';
import { MAX_COMPONENT_BODY_CHARS, OfferBook, componentEvents, markComponents, planComponents, truncationNote } from '../components/inject.js';
import { readComponentSettings, writeComponentSettings, componentsToolOn } from '../components/settings.js';
import { handleComponentsRoute } from '../components/routes.js';
import { sequenceMcpServer } from '../server/sequenceMcp.js';

const tmp = (p: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

interface Spec {
  id: string;
  label?: string;
  triggers?: string[];
  status?: string;
  parent?: string;
  body?: string;
  extra?: Record<string, unknown>;
}

function put(root: string, s: Spec): void {
  const dir = path.join(root, ...s.id.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  const meta = { id: s.id, group: s.id.split('/')[0], label: s.label ?? s.id, summary: `about ${s.id}`, triggers: s.triggers ?? [], status: s.status ?? 'ready', license: 'MIT', ...(s.parent ? { parent: s.parent } : {}), ...(s.status === 'link-only' ? { url: 'https://example.com/x' } : {}), ...s.extra };
  fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify(meta));
  if (s.status !== 'link-only') fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${s.id}\ndescription: d\n---\n${s.body ?? `BODY of ${s.id}`}\n`);
}

function fixture(): string {
  const root = tmp('components-cat-');
  fs.writeFileSync(path.join(root, 'groups.json'), JSON.stringify({ groups: [{ id: 'security', label: 'Security', summary: 's' }, { id: 'design', label: 'Design elements', summary: 'd' }] }));
  put(root, { id: 'security/reverse-engineer-anything', label: 'Reverse engineer anything', triggers: ['reverse engineer', 'decompile', 'disassemble'], status: 'review' });
  put(root, { id: 'design/interface', label: 'Interface', triggers: ['design an interface'] });
  put(root, { id: 'design/interface/forms', label: 'Forms', triggers: ['signup form'], parent: 'design/interface' });
  put(root, { id: 'design/charts', label: 'Charts', triggers: ['bar chart', 'chart'] });
  put(root, { id: 'design/linked', status: 'link-only', triggers: ['linked thing'] });
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

test('catalog: reads groups, components and sub-components; link-only has no body', () => {
  const c = loadCatalog(fixture());
  assert.deepEqual(c.warnings, []);
  assert.deepEqual(c.components.map((x) => x.id).sort(), ['design/charts', 'design/interface', 'design/interface/forms', 'design/linked', 'security/reverse-engineer-anything']);
  assert.equal(c.groups.length, 2);
  const forms = c.components.find((x) => x.id === 'design/interface/forms')!;
  assert.equal(forms.parent, 'design/interface');
  assert.equal(readComponentBody(forms), 'BODY of design/interface/forms');
  assert.equal(readComponentBody(c.components.find((x) => x.id === 'design/linked')!), null);
});

test('catalog: a malformed component.json is skipped by id with a warning, the rest load, nothing throws', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'design/broken'), { recursive: true });
  fs.writeFileSync(path.join(root, 'design/broken/component.json'), '{ not json');
  put(root, { id: 'design/badstatus', status: 'weird' });
  put(root, { id: 'design/nobody' });
  fs.rmSync(path.join(root, 'design/nobody/SKILL.md'));
  fs.mkdirSync(path.join(root, 'design/mismatch'), { recursive: true });
  fs.writeFileSync(path.join(root, 'design/mismatch/component.json'), JSON.stringify({ id: 'design/other', label: 'x', summary: 'x', triggers: [], status: 'ready' }));
  const c = loadCatalog(root);
  assert.equal(c.components.length, 5);
  for (const id of ['design/broken', 'design/badstatus', 'design/nobody', 'design/mismatch']) assert.ok(c.warnings.some((w) => w.startsWith(`${id}:`)), `${id}: ${c.warnings.join(' | ')}`);
  assert.deepEqual(loadCatalog(path.join(root, 'missing')), { groups: [], components: [], warnings: [] });
});

test('catalog: the user layer lives in <repo>/.sequence/components and wins on the same id', () => {
  const root = fixture();
  const repo = tmp('components-repo-');
  put(userCatalogRoot(repo), { id: 'design/charts', label: 'My charts', triggers: ['plot'], body: 'MINE' });
  put(userCatalogRoot(repo), { id: 'team/runbook', triggers: ['runbook'] });
  const m = loadMergedCatalog(repo, root);
  assert.equal(m.components.find((x) => x.id === 'design/charts')!.label, 'My charts');
  assert.equal(m.components.find((x) => x.id === 'design/charts')!.layer, 'user');
  assert.ok(m.groups.some((g) => g.id === 'team'));
  assert.equal(loadMergedCatalog(null, root).components.find((x) => x.id === 'design/charts')!.label, 'Charts');
});

test('bundledCatalogRoot: the env names it, else the nearest components/groups.json above dist', () => {
  assert.equal(bundledCatalogRoot({ SEQUENCE_COMPONENTS_ROOT: 'C:/x/y' }), path.resolve('C:/x/y'));
  const pkg = tmp('components-pkg-');
  fs.mkdirSync(path.join(pkg, 'components'));
  fs.writeFileSync(path.join(pkg, 'components', 'groups.json'), '[]');
  fs.mkdirSync(path.join(pkg, 'dist', 'components'), { recursive: true });
  assert.equal(bundledCatalogRoot({}, path.join(pkg, 'dist', 'components')), path.join(pkg, 'components'));
});

test('match: phrases hit on word boundaries, case-insensitively; REA fires for a binary, not for "how this app works"', () => {
  const c = loadCatalog(fixture());
  assert.equal(matchComponents('can you reverse engineer this binary', c)[0]!.id, 'security/reverse-engineer-anything');
  assert.equal(matchComponents('Can you REVERSE   Engineer this', c)[0]!.id, 'security/reverse-engineer-anything');
  assert.deepEqual(matchComponents('the barchart and chartreuse', c), [], 'no hit inside a longer word');
  assert.deepEqual(matchComponents('use the linked thing', c), [], 'link-only is never matched');
});

test('match: ranked, deterministic and capped at 3', () => {
  const root = tmp('components-many-');
  for (const n of ['a', 'b', 'c', 'd', 'e']) put(root, { id: `g/${n}`, triggers: ['shared'] });
  put(root, { id: 'g/best', triggers: ['shared', 'other phrase'] });
  const c = loadCatalog(root);
  const r = matchComponents('shared and other phrase', c);
  assert.equal(r.length, 3);
  assert.equal(r[0]!.id, 'g/best');
  assert.deepEqual(r.map((x) => x.id), matchComponents('shared and other phrase', c).map((x) => x.id));
  assert.match(r[0]!.why, /shared/);
});

test('settings: default approve + enabled, persisted in the store file, garbage falls back, manual drops the tool', () => {
  const dir = tmp('components-set-');
  assert.deepEqual(readComponentSettings(dir), { enabled: true, mode: 'approve' });
  writeComponentSettings(dir, { mode: 'auto' });
  assert.equal(readComponentSettings(dir).mode, 'auto');
  assert.ok(fs.existsSync(path.join(dir, 'components-settings.json')));
  fs.writeFileSync(path.join(dir, 'components-settings.json'), '{"mode":"loud","enabled":"no"}');
  assert.deepEqual(readComponentSettings(dir), { enabled: true, mode: 'approve' });
  assert.equal(componentsToolOn({ enabled: true, mode: 'manual' }), false);
  assert.equal(componentsToolOn({ enabled: false, mode: 'auto' }), false);
  assert.equal(componentsToolOn({ enabled: true, mode: 'approve' }), true);
});

test('win 1: with no match, no mode puts component text in the prompt (default approve)', () => {
  const c = loadCatalog(fixture());
  for (const mode of ['auto', 'approve', 'manual'] as const) {
    const p = planComponents(ctx(c, { mode, prompt: 'explain how this app works' }));
    assert.equal(p.text, '', mode);
    assert.deepEqual(p.offers, []);
    assert.deepEqual(componentEvents(p, 'turn1'), []);
  }
});

test('win 3 approve: a match is offered, never injected; accepting injects it once on the next prompt of that thread', () => {
  const c = loadCatalog(fixture());
  const base = ctx(c, { prompt: 'make a bar chart of sales' });
  const first = planComponents(base);
  assert.equal(first.text, '');
  assert.equal(first.offers.length, 1);
  const ev = componentEvents(first, 'turn1');
  assert.deepEqual(ev, [{ type: 'component:offer', turnId: 'turn1', offerId: first.offers[0]!.offerId, componentId: 'design/charts', name: 'Charts', reason: 'matched "bar chart", "chart"' }]);
  /* The same offer is not asked twice while it is open. */
  assert.equal(planComponents(base).offers.length, 0);
  assert.equal(base.offers.answer(first.offers[0]!.offerId, true), true);
  assert.equal(base.offers.answer(first.offers[0]!.offerId, true), false, 'answered once');
  const next = planComponents({ ...base, prompt: 'thanks' });
  assert.match(next.text, /^COMPONENT: Charts\nBODY of design\/charts/);
  assert.deepEqual(componentEvents(next, 'turn2'), [{ type: 'component:used', turnId: 'turn2', componentId: 'design/charts', name: 'Charts' }]);
  markComponents(next, base.noteKey, base.thread, base.ledger, base.offers, c);
  assert.equal(planComponents({ ...base, prompt: 'thanks again' }).text, '', 'resolved once');
});

test('win 3 approve: a declined offer is not asked again on that thread', () => {
  const c = loadCatalog(fixture());
  const base = ctx(c, { prompt: 'bar chart please' });
  const o = planComponents(base).offers[0]!;
  base.offers.answer(o.offerId, false);
  assert.equal(planComponents(base).offers.length, 0);
  assert.equal(planComponents({ ...base, noteKey: 'chat::c2::claude' }).offers.length, 1, 'another thread asks again');
});

test('win 3 auto: the body goes in once per thread (ledger), again on a new thread, with component:used', () => {
  const c = loadCatalog(fixture());
  const ledger = new ThreadNoteLedger();
  const turn = (thread: string | null, prompt = 'make a bar chart'): ReturnType<typeof planComponents> => {
    const plan = planComponents(ctx(c, { mode: 'auto', prompt, ledger, thread }));
    markComponents(plan, 'chat::c1::claude', thread, ledger, new OfferBook(), c);
    return plan;
  };
  const a = turn('t1');
  assert.equal(a.text, 'COMPONENT: Charts\nBODY of design/charts\n\n---\n\n');
  assert.equal(componentEvents(a, 'x')[0]!.type, 'component:used');
  assert.equal(turn('t1').text, '', 'same thread: not again');
  assert.equal(turn('t2').text, a.text, 'new thread: again');
  ledger.forget('chat::c1::');
  assert.equal(turn('t2').text, a.text, 'a rewind forgets components with the notes');
});

test('win 3 / 5: a review component (REA) is never auto-loaded, even in auto: it is offered', () => {
  const c = loadCatalog(fixture());
  const base = ctx(c, { mode: 'auto', prompt: 'please reverse engineer this binary' });
  const p = planComponents(base);
  assert.equal(p.text, '');
  assert.deepEqual(p.offers.map((o) => o.componentId), ['security/reverse-engineer-anything']);
  /* Accepting it is the person's explicit yes, so then it loads. */
  base.offers.answer(p.offers[0]!.offerId, true);
  assert.match(planComponents({ ...base, prompt: 'ok' }).text, /^COMPONENT: Reverse engineer anything/);
});

test('win 3 manual: no offers, no auto-load; only an explicit id loads (even a review one)', () => {
  const c = loadCatalog(fixture());
  const p = planComponents(ctx(c, { mode: 'manual', prompt: 'reverse engineer this bar chart' }));
  assert.deepEqual([p.text, p.offers], ['', []]);
  const f = planComponents(ctx(c, { mode: 'manual', prompt: 'x', forced: ['security/reverse-engineer-anything', 'design/linked', 'nope/x'] }));
  assert.match(f.text, /^COMPONENT: Reverse engineer anything\n/);
  assert.deepEqual(f.skipped.map((k) => k.id).sort(), ['design/linked', 'nope/x']);
});

test('win 3 disabled: no offers, and an explicit load is refused', () => {
  const c = loadCatalog(fixture());
  const p = planComponents(ctx(c, { enabled: false, prompt: 'bar chart', forced: ['design/charts'] }));
  assert.deepEqual([p.text, p.offers, p.loaded, p.refused], ['', [], [], true]);
  assert.equal(planComponents(ctx(c, { enabled: false, prompt: 'bar chart' })).refused, false);
});

test('a body is capped at 6000 characters', () => {
  const root = tmp('components-big-');
  put(root, { id: 'g/big', triggers: ['big'], body: 'x'.repeat(20000) });
  const p = planComponents(ctx(loadCatalog(root), { mode: 'auto', prompt: 'big' }));
  const note = truncationNote(loadCatalog(root).components[0]!);
  assert.ok(p.text.includes(note), 'the cut names where the rest is');
  assert.ok(note.includes(path.join(root, 'g', 'big').split(path.sep).join('/')), note);
  assert.ok(p.text.length <= MAX_COMPONENT_BODY_CHARS + note.length + 100, `${p.text.length}`);
  assert.equal(MAX_COMPONENT_BODY_CHARS, 6000);
});

async function api(root: string, repo: string | null, store: string, offers = new OfferBook()) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    void handleComponentsRoute({
      req, res, method: req.method ?? 'GET', pathname: url.pathname, storeDir: store, repoRoot: repo, offers, bundledRoot: root,
      readBody: () => new Promise((resolve) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => resolve(b)); }),
    }).then((handled) => { if (!handled) { res.statusCode = 404; res.end('{}'); } });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const r = await fetch(base + p, { method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return { status: r.status, json: await r.json() };
  };
  return { call, close: () => new Promise<void>((r) => server.close(() => r())), offers };
}

test('win 4 routes: GET shape, PUT settings (persisted), workspace add/remove, offer answer, preview body', async () => {
  const root = fixture();
  const repo = tmp('components-ws-');
  const store = tmp('components-store-');
  const a = await api(root, repo, store);
  try {
    const g = await a.call('GET', '/api/components');
    assert.equal(g.status, 200);
    assert.equal(g.json.enabled, true);
    assert.equal(g.json.mode, 'approve');
    const design = g.json.groups.find((x: any) => x.id === 'design');
    assert.equal(design.name, 'Design elements');
    const forms = design.components.find((x: any) => x.id === 'design/interface/forms');
    assert.deepEqual(Object.keys(forms).sort(), ['blurb', 'id', 'inWorkspace', 'installed', 'license', 'name', 'parent', 'source', 'status'].sort());
    assert.equal(forms.parent, 'design/interface');
    const linked = design.components.find((x: any) => x.id === 'design/linked');
    assert.deepEqual([linked.installed, linked.url], [false, 'https://example.com/x']);

    assert.equal((await a.call('PUT', '/api/components/settings', { mode: 'auto' })).json.mode, 'auto');
    assert.equal(readComponentSettings(store).mode, 'auto');
    assert.equal((await a.call('PUT', '/api/components/settings', { enabled: false })).json.enabled, false);
    assert.equal((await a.call('PUT', '/api/components/settings', { mode: 'cards' })).status, 400);
    assert.equal((await a.call('PUT', '/api/components/settings', {})).status, 400);

    const add = await a.call('POST', '/api/components/design/charts/workspace', { inWorkspace: true });
    assert.equal(add.status, 200);
    assert.ok(fs.existsSync(path.join(userCatalogRoot(repo), 'design/charts/SKILL.md')));
    assert.equal(add.json.groups.find((x: any) => x.id === 'design').components.find((x: any) => x.id === 'design/charts').inWorkspace, true);
    assert.equal((await a.call('POST', '/api/components/design/linked/workspace', { inWorkspace: true })).status, 409);
    assert.equal((await a.call('POST', '/api/components/design/charts/workspace', { inWorkspace: false })).status, 200);
    assert.ok(!fs.existsSync(path.join(userCatalogRoot(repo), 'design/charts')));
    assert.equal((await a.call('POST', '/api/components/nope/x/workspace', { inWorkspace: true })).status, 404);

    const prev = await a.call('GET', '/api/components/design/charts');
    assert.equal(prev.json.body, 'BODY of design/charts');
    assert.equal((await a.call('GET', '/api/components/nope/x')).status, 404);

    const offer = a.offers.open('chat::c::claude', { componentId: 'design/charts', name: 'Charts', reason: 'r' })!;
    assert.equal((await a.call('POST', `/api/components/offer/${offer.offerId}`, { accept: 'yes' })).status, 400);
    assert.equal((await a.call('POST', `/api/components/offer/${offer.offerId}`, { accept: true })).status, 200);
    assert.equal((await a.call('POST', `/api/components/offer/${offer.offerId}`, { accept: true })).status, 404);
    assert.deepEqual(a.offers.accepted('chat::c::claude'), ['design/charts']);
  } finally {
    await a.close();
  }
});

test('a session starts without the components tool when asked (manual / off); otherwise its env is unchanged', () => {
  assert.equal(sequenceMcpServer('C:/r', { entry: 'x.js', components: false })!.env!.SEQUENCE_MCP_COMPONENTS, 'off');
  assert.equal('SEQUENCE_MCP_COMPONENTS' in sequenceMcpServer('C:/r', { entry: 'x.js' })!.env!, false);
  assert.equal('SEQUENCE_MCP_COMPONENTS' in sequenceMcpServer('C:/r', { entry: 'x.js', components: true })!.env!, false);
});

test('preamble: its text goes first and is never cut; the cap applies to SKILL.md only (auto, accepted and explicit loads)', () => {
  const root = tmp('components-pre-');
  const pre = `SAFETY ${'s'.repeat(7000)}`;
  put(root, { id: 'security/rea', status: 'review', triggers: ['decompile'], body: 'b'.repeat(20000), extra: { preamble: 'SEQUENCE.md' } });
  fs.writeFileSync(path.join(root, 'security/rea/SEQUENCE.md'), `${pre}\n`);
  const c = loadCatalog(root);
  assert.deepEqual(c.warnings, []);
  const explicit = planComponents(ctx(c, { mode: 'manual', prompt: 'x', forced: ['security/rea'] }));
  assert.ok(explicit.text.startsWith(`COMPONENT: security/rea\n${pre}\n\nbbb`), explicit.text.slice(0, 80));
  assert.ok(explicit.text.includes(pre), 'the preamble is whole');
  const rea = c.components[0]!;
  const expected = ['COMPONENT: security/rea\n', pre, '\n\n', 'b'.repeat(MAX_COMPONENT_BODY_CHARS), '…', '\n\n', truncationNote(rea), '\n\n---\n\n'].join('');
  assert.equal(explicit.text, expected);
  /* An accepted offer injects it the same way. */
  const base = ctx(c, { prompt: 'decompile this' });
  base.offers.answer(planComponents(base).offers[0]!.offerId, true);
  assert.ok(planComponents({ ...base, prompt: 'ok' }).text.includes(pre));
});

test('preamble: a component whose preamble file is missing is skipped with a warning, never injected without it', () => {
  const root = tmp('components-nopre-');
  put(root, { id: 'security/rea', triggers: ['decompile'], extra: { preamble: 'SEQUENCE.md' } });
  put(root, { id: 'security/bad', triggers: ['decompile'], extra: { preamble: '../x.md' } });
  const c = loadCatalog(root);
  assert.equal(c.components.length, 0);
  assert.ok(c.warnings.some((w) => w.startsWith('security/rea:') && /preamble/.test(w)), c.warnings.join('|'));
  assert.ok(c.warnings.some((w) => w.startsWith('security/bad:')));
  assert.equal(planComponents(ctx(c, { mode: 'auto', prompt: 'decompile', forced: ['security/rea'] })).text, '');
});
