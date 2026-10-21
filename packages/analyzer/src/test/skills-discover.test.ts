/**
 * First-run skills import: discovery from typed paths and words, and the confirmed import.
 * Every test uses a temp fake home. The real home is never read.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';
import { cursorRuleToSkill, defaultPlaces, discover, expandTyped, importSelected, removeImported, resolveText, MAX_CANDIDATES, MAX_DEFAULT_CANDIDATES } from '../server/skillsDiscover.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TICKETING = path.resolve(here, '..', '..', '..', '..', 'examples', 'ticketing-scaffold');

function put(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function world() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-g6-home-')));
  const root = path.join(home, 'work', 'proj');
  fs.mkdirSync(root, { recursive: true });
  put(path.join(home, '.claude', 'skills', 'demo', 'SKILL.md'), '# Demo\n\nDo the demo.\n');
  put(path.join(home, '.claude', 'skills', 'demo', 'refs', 'notes.md'), 'notes');
  put(path.join(home, '.claude', 'skills', 'node_modules', 'bad', 'SKILL.md'), 'never');
  put(path.join(home, '.claude', 'CLAUDE.md'), '# Claude rules\n');
  put(path.join(home, '.codex', 'skills', 'other', 'SKILL.md'), '# Other\n');
  put(path.join(home, '.cursor', 'rules', 'style.mdc'), 'Use tabs.\n');
  put(path.join(root, 'AGENTS.md'), '# Agents here\n');
  put(path.join(root, '.cursor', 'rules', 'proj.mdc'), '---\ndescription: Project naming\nglobs: src/**/*.ts\n---\nName things well.\n');
  return { home, root };
}

test('default: no text looks in the known folders and the project, and finds skills and instructions, not node_modules', () => {
  const { home, root } = world();
  const a = discover('', { home, root, env: {} });
  assert.equal(a.mode, 'default');
  const shown = a.candidates.map((c) => c.shown).sort();
  assert.deepEqual(shown, ['~/.claude/skills/demo', '~/.codex/skills/other', '~/.cursor/rules/style.mdc', '~/work/proj/AGENTS.md', '~/work/proj/.cursor/rules/proj.mdc'].sort());
  assert.ok(a.candidates.every((c) => !c.path.includes('node_modules')));
  assert.equal(a.candidates.find((c) => c.slug === 'demo')!.folder, true);
});

test('words: claude, codex, cursor, agents map to known places, and unknown words are named', () => {
  assert.deepEqual(resolveText('my claude skills').places, ['~/.claude/skills', '~/.claude/CLAUDE.md']);
  assert.deepEqual(resolveText('codex').places, ['~/.codex/skills', '~/.codex/AGENTS.md']);
  assert.deepEqual(resolveText('cursor rules').places, ['~/.cursor/rules']);
  assert.deepEqual(resolveText('agents').places, ['AGENTS.md']);
  const u = resolveText('my recipes');
  assert.equal(u.mode, 'words');
  assert.deepEqual(u.unknown, ['my recipes']);
  assert.equal(resolveText('~/a, C:/b/c.md').mode, 'paths');
  const { home, root } = world();
  const a = discover('my claude skills, cursor', { home, root, env: {} });
  assert.equal(a.mode, 'words');
  assert.deepEqual(a.looked, ['~/.claude/skills', '~/.claude/CLAUDE.md', '~/.cursor/rules']);
  assert.deepEqual(a.candidates.map((c) => c.shown).sort(), ['~/.claude/CLAUDE.md', '~/.claude/skills/demo', '~/.cursor/rules/style.mdc']);
});

test('paths: ~, $HOME, %USERPROFILE% and relative resolve; an unknown variable is reported, not guessed', () => {
  const { home, root } = world();
  const d = { home, root, env: {} };
  assert.equal(expandTyped('~/.claude/skills', d), path.join(home, '.claude', 'skills'));
  assert.equal(expandTyped('$HOME/x', d), path.join(home, 'x'));
  assert.equal(expandTyped('%USERPROFILE%/x', d), path.join(home, 'x'));
  assert.equal(expandTyped('AGENTS.md', d), path.join(root, 'AGENTS.md'));
  assert.equal(expandTyped('$NOPE_G6/x', d), null);
  assert.deepEqual(discover('$NOPE_G6/x', d).unknown, ['$NOPE_G6/x']);
});

test('a folder outside home and the project is read only when typed explicitly', () => {
  const { home, root } = world();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-g6-out-')));
  put(path.join(outside, 'skills', 'far', 'SKILL.md'), '# Far\n');
  put(path.join(outside, 'AGENTS.md'), '# far agents\n');
  const d = { home, root, env: {} };
  assert.deepEqual(discover('', d).candidates.filter((c) => c.path.startsWith(outside)), []);
  const o = outside.replace(/\\/g, '/');
  assert.equal(discover(`${o}/skills, ${o}/AGENTS.md`, d).candidates.length, 2);
});

test('limits: the count is capped and a file over the size cap is skipped and named', () => {
  const { home, root } = world();
  const many = path.join(home, 'many').replace(/\\/g, '/');
  for (let i = 0; i < MAX_CANDIDATES + 10; i++) put(path.join(many, 'skills', `s${i}`, 'SKILL.md'), '# s\n');
  put(path.join(many, 'skills', 'huge', 'SKILL.md'), 'x'.repeat(300 * 1024));
  const a = discover(`${many}/skills`, { home, root, env: {} });
  assert.equal(a.candidates.length, MAX_CANDIDATES);
  assert.equal(a.truncated, true);
  const b = discover(`${many}/skills/huge`, { home, root, env: {} });
  assert.equal(b.candidates.length, 0);
  assert.match(b.skipped[0]!, /larger than/);
});

test('discovery is read-only: nothing is written into the project', () => {
  const { home, root } = world();
  discover('', { home, root, env: {} });
  assert.equal(fs.existsSync(path.join(root, '.sequence')), false);
});

test('import: only confirmed paths are written, instruction files get a slug, existing names are kept', () => {
  const { home, root } = world();
  const d = { home, root, env: {} };
  const found = discover('my claude skills', d).candidates;
  const demo = found.find((c) => c.slug === 'demo')!;
  assert.equal(importSelected('my claude skills', [], d).status, 400);
  assert.equal(fs.existsSync(path.join(root, '.sequence')), false);
  const instr = found.find((c) => c.kind === 'instructions')!;
  const a = importSelected('my claude skills', [demo.path, instr.path], d);
  assert.equal(a.status, 200);
  const base = path.join(root, '.sequence', 'skills');
  assert.ok(fs.existsSync(path.join(base, 'demo', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(base, 'demo', 'refs', 'notes.md')));
  assert.ok(fs.existsSync(path.join(base, instr.slug, 'SKILL.md')));
  assert.equal(fs.existsSync(path.join(base, 'bad')), false);
  const again = importSelected('my claude skills', [demo.path], d);
  assert.equal(again.status, 200);
  assert.deepEqual((again.body as { kept: string[] }).kept, ['demo']);
  assert.deepEqual((again.body as { imported: string[] }).imported, []);
});

test('import: a path the typed text does not find is refused, and no project is a plain 409', () => {
  const { home, root } = world();
  const secret = path.join(home, 'secret.md');
  put(secret, 'private');
  assert.equal(importSelected('my claude skills', [secret], { home, root, env: {} }).status, 400);
  assert.equal(fs.existsSync(path.join(root, '.sequence')), false);
  assert.equal(importSelected('', [secret], { home, root: null, env: {} }).status, 409);
});

test('route: find then import over HTTP with a fake home; a bad content type and an unfound path are refused', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-g6-route-')));
  const repo = path.join(home, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  put(path.join(home, '.claude', 'skills', 'demo', 'SKILL.md'), '# Demo\n');
  setRepoTrust(userStoreDir(), repo, true);
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-g6-user-')));
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir, browseRoot: home });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const post = (p: string, body: unknown, type = 'application/json') => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });
  try {
    const f = (await (await post('/api/onboarding/skills/find', { text: 'my claude skills' })).json()) as { mode: string; candidates: { path: string; slug: string }[] };
    assert.equal(f.mode, 'words');
    assert.deepEqual(f.candidates.map((c) => c.slug), ['demo']);
    assert.equal(fs.existsSync(path.join(repo, '.sequence', 'skills', 'demo')), false);
    assert.equal((await post('/api/onboarding/skills/find', {}, 'text/plain')).status, 415);
    const imp = await post('/api/onboarding/skills/import', { text: 'my claude skills', selected: [f.candidates[0]!.path] });
    assert.equal(imp.status, 200);
    assert.ok(fs.existsSync(path.join(repo, '.sequence', 'skills', 'demo', 'SKILL.md')));
    assert.equal((await post('/api/onboarding/skills/import', { text: 'x', selected: [path.join(home, 'nope.md')] })).status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('import with no project open answers 409 with needsProject so the client can wait', () => {
  const { home } = world();
  const a = importSelected('', ['/x'], { home, root: null, env: {} });
  assert.equal(a.status, 409);
  assert.equal((a.body as { needsProject?: boolean }).needsProject, true);
});

test('slugs: ~/.claude/CLAUDE.md is "claude", a project AGENTS.md carries the folder, repeats get a number', () => {
  const { home, root } = world();
  put(path.join(home, '.codex', 'AGENTS.md'), '# c\n');
  const a = discover('claude, codex, agents', { home, root, env: {} });
  const by = Object.fromEntries(a.candidates.map((c) => [c.shown, c.slug]));
  assert.equal(by['~/.claude/CLAUDE.md'], 'claude');
  assert.equal(by['~/.codex/AGENTS.md'], 'agents-codex');
  assert.equal(by['~/work/proj/AGENTS.md'], 'agents-proj');
  assert.equal(new Set(a.candidates.map((c) => c.slug)).size, a.candidates.length);
});

test('batches: 12 skills of 4 files (48 files) all import, and one oversize skill is named while the rest go in', () => {
  const { home, root } = world();
  const dir = path.join(home, 'big', 'skills');
  for (let i = 0; i < 12; i++) {
    put(path.join(dir, `s${i}`, 'SKILL.md'), `# s${i}\n`);
    for (const f of ['a.md', 'b.md', 'c.md']) put(path.join(dir, `s${i}`, f), 'x');
  }
  const huge = path.join(dir, 'huge');
  put(path.join(huge, 'SKILL.md'), '# huge\n');
  for (const f of ['a.md', 'b.md', 'c.md', 'd.md']) put(path.join(huge, f), 'x'.repeat(250 * 1024));
  const d = { home, root, env: {} };
  const text = dir.split(path.sep).join('/');
  const sel = discover(text, d).candidates.map((c) => c.path);
  assert.equal(sel.length, 13);
  const a = importSelected(text, sel, d);
  assert.equal(a.status, 200);
  const body = a.body as { imported: string[]; problems: string[] };
  assert.equal(body.imported.length, 12);
  assert.ok(body.problems.some((p) => p.includes('huge')));
  assert.ok(fs.existsSync(path.join(root, '.sequence', 'skills', 's11', 'c.md')));
  assert.equal(fs.existsSync(path.join(root, '.sequence', 'skills', 'huge')), false);
});

test('device paths and shares are refused; only a few environment variables expand', () => {
  const { home, root } = world();
  const d = { home, root, env: { SECRET_G6: 'C:/x', APPDATA: path.join(home, 'AppData') } as NodeJS.ProcessEnv };
  const BS = String.fromCharCode(92);
  const dev = (s: string) => s.split('|').join(BS);
  for (const bad of [dev('||.|pipe|x.md'), dev('||?|C:|x.md'), dev('||server|share|x.md'), '//server/share/x.md']) assert.equal(expandTyped(bad, d), null, bad);
  assert.equal(expandTyped('$SECRET_G6/y', d), null);
  assert.equal(expandTyped('%APPDATA%/y', d), path.join(home, 'AppData', 'y'));
  const a = discover(`$SECRET_G6/y, ${dev('||server|share|x.md')}`, d);
  assert.equal(a.notes.length, 2);
  assert.match(a.notes[1]!, /network/);
});

test('a hanging named pipe typed as a path does not block the server', { skip: process.platform !== 'win32' }, async () => {
  const net = await import('node:net');
  const { execFile } = await import('node:child_process');
  const pipe = `${String.fromCharCode(92).repeat(2)}.${String.fromCharCode(92)}pipe${String.fromCharCode(92)}seq-g6-${process.pid}.md`;
  const srv = net.createServer(() => {});
  await new Promise<void>((r) => srv.listen(pipe, r));
  const mod = path.resolve(here, '..', 'server', 'skillsDiscover.js').split(path.sep).join('/');
  const code = `import('file:///${mod}').then(m=>{const r=m.discover(${JSON.stringify(pipe)},{home:process.cwd(),root:null,env:{}});console.log(JSON.stringify(r.candidates.length));process.exit(0)})`;
  const out = await new Promise<{ killed: boolean; stdout: string }>((resolve) => {
    const c = execFile(process.execPath, ['-e', code], { timeout: 8000 }, (_e, stdout) => resolve({ killed: c.killed, stdout: String(stdout) }));
  });
  srv.close();
  assert.equal(out.killed, false);
  assert.equal(out.stdout.trim(), '0');
});

test('words: "skills" and "my skills" mean the defaults; a typed place that gives nothing says why', () => {
  const { home, root } = world();
  const d = { home, root, env: {} };
  assert.deepEqual(resolveText('my skills').places, resolveText('').places);
  assert.deepEqual(resolveText('skills').places, resolveText('').places);
  put(path.join(home, 'notes.txt'), 'x');
  fs.mkdirSync(path.join(home, 'emptydir'));
  const a = discover('~/notes.txt, ~/missing, ~/emptydir', d);
  assert.deepEqual(a.candidates, []);
  assert.match(a.notes[0]!, /not a markdown/);
  assert.match(a.notes[1]!, /not found/);
  assert.match(a.notes[2]!, /no skills or instruction files/);
});

test('one import request is capped in total: 60 skills of 3 x 250 KB write at most 4 MB and name the rest for the next Import', () => {
  const { home, root } = world();
  const big = 'x'.repeat(250 * 1024);
  for (let i = 0; i < 60; i++) {
    const dir = path.join(home, '.claude', 'skills', `heavy${String(i).padStart(2, '0')}`);
    put(path.join(dir, 'SKILL.md'), big);
    put(path.join(dir, 'a.md'), big);
    put(path.join(dir, 'b.md'), big);
  }
  const d = { home, root, env: {} };
  const found = discover('my claude skills', d).candidates.filter((c) => c.path.includes('heavy'));
  assert.ok(found.length > 10);
  const a = importSelected('my claude skills', found.map((c) => c.path), d);
  assert.equal(a.status, 200);
  const dir = path.join(root, '.sequence', 'skills');
  let bytes = 0;
  let files = 0;
  const walk = (p: string) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else {
        files++;
        bytes += fs.statSync(f).size;
      }
    }
  };
  walk(dir);
  assert.ok(bytes <= 4 * 1024 * 1024, `wrote ${bytes} bytes`);
  assert.ok(files <= 400, `wrote ${files} files`);
  if (a.status === 200) assert.ok(a.body.problems.some((p) => /press Import again/.test(p)));
});

test('remove: takes back only the named skill folders under .sequence/skills, nothing else', () => {
  const { home, root } = world();
  const d = { home, root, env: {} };
  const sel = discover('my claude skills', d).candidates.map((c) => c.path);
  assert.equal(importSelected('my claude skills', sel, d).status, 200);
  const base = path.join(root, '.sequence', 'skills');
  put(path.join(base, 'mine', 'SKILL.md'), '# Mine\n');
  put(path.join(root, 'src', 'keep.ts'), 'export {};\n');
  put(path.join(root, '.sequence', 'other.json'), '{}');
  put(path.join(base, 'plain.md'), 'a file, not a skill folder');
  put(path.join(base, 'noskill', 'notes.md'), 'no SKILL.md');
  const a = removeImported(['demo', '../src', '..', 'src/keep.ts', 'plain.md', 'noskill', 'nope', 7 as unknown as string].filter((x) => typeof x === 'string'), d);
  assert.equal(a.status, 200);
  assert.deepEqual((a.body as { removed: string[] }).removed, ['demo']);
  assert.equal(fs.existsSync(path.join(base, 'demo')), false);
  for (const keep of [path.join(base, 'mine', 'SKILL.md'), path.join(root, 'src', 'keep.ts'), path.join(root, '.sequence', 'other.json'), path.join(base, 'plain.md'), path.join(base, 'noskill', 'notes.md'), path.join(home, '.claude', 'skills', 'demo', 'SKILL.md')]) {
    assert.ok(fs.existsSync(keep), keep);
  }
  assert.equal(removeImported([], d).status, 400);
  assert.equal(removeImported('demo', d).status, 400);
  assert.equal(removeImported(['demo'], { home, root: null, env: {} }).status, 409);
  assert.deepEqual((removeImported(['demo'], { home, root: path.join(home, 'empty'), env: {} }).body as { removed: string[] }).removed, []);
});

test('route: remove over HTTP deletes the imported skill and leaves a skill that was already there', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-b8-route-')));
  const repo = path.join(home, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  put(path.join(home, '.claude', 'skills', 'demo', 'SKILL.md'), '# Demo\n');
  put(path.join(repo, '.sequence', 'skills', 'mine', 'SKILL.md'), '# Mine\n');
  setRepoTrust(userStoreDir(), repo, true);
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-b8-user-')));
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir, browseRoot: home });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const post = (p: string, body: unknown, type = 'application/json') => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) });
  try {
    const f = (await (await post('/api/onboarding/skills/find', { text: '' })).json()) as { candidates: { path: string }[] };
    assert.equal((await post('/api/onboarding/skills/import', { text: '', selected: f.candidates.map((c) => c.path) })).status, 200);
    assert.ok(fs.existsSync(path.join(repo, '.sequence', 'skills', 'demo', 'SKILL.md')));
    assert.equal((await post('/api/onboarding/skills/remove', { names: ['demo'] }, 'text/plain')).status, 415);
    const r = await post('/api/onboarding/skills/remove', { names: ['demo'] });
    assert.equal(r.status, 200);
    assert.deepEqual(((await r.json()) as { removed: string[] }).removed, ['demo']);
    assert.equal(fs.existsSync(path.join(repo, '.sequence', 'skills', 'demo')), false);
    assert.ok(fs.existsSync(path.join(repo, '.sequence', 'skills', 'mine', 'SKILL.md')));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('remove: a skill the project already had is never removed, nor a case variant of one just imported', () => {
  const { home, root } = world();
  const d = { home, root, env: {} };
  const base = path.join(root, '.sequence', 'skills');
  put(path.join(base, 'demo', 'SKILL.md'), '# mine already\n');
  put(path.join(base, 'older', 'SKILL.md'), '# older\n');
  const sel = discover('', d).candidates.map((c) => c.path);
  const a = importSelected('', sel, d);
  assert.equal(a.status, 200);
  assert.deepEqual((a.body as { kept: string[] }).kept, ['demo']);
  assert.deepEqual((a.body as { imported: string[] }).imported, ['other', 'style', 'proj', 'agents-proj']);
  const r = removeImported(['demo', 'older', 'OTHER', 'Other'], d);
  assert.deepEqual((r.body as { removed: string[] }).removed, []);
  for (const keep of ['demo', 'older', 'other']) assert.ok(fs.existsSync(path.join(base, keep, 'SKILL.md')), keep);
  assert.deepEqual((removeImported(['other'], d).body as { removed: string[] }).removed, ['other']);
  /* Each is taken back once: a second request, or a skill put back by hand, is left alone. */
  put(path.join(base, 'other', 'SKILL.md'), '# by hand\n');
  assert.deepEqual((removeImported(['other'], d).body as { removed: string[] }).removed, []);
  assert.ok(fs.existsSync(path.join(base, 'other', 'SKILL.md')));
});

test('default look: more than 60 skills are all found, and a later folder is still scanned', () => {
  const { home, root } = world();
  for (let i = 0; i < 80; i++) put(path.join(home, '.claude', 'skills', `a${String(i).padStart(2, '0')}`, 'SKILL.md'), '# s\n');
  const a = discover('', { home, root, env: {} });
  assert.ok(a.candidates.length > MAX_CANDIDATES);
  assert.equal(a.truncated, false);
  assert.ok(a.candidates.some((c) => c.slug === 'other'), 'the codex folder after the claude one is scanned');
  assert.ok(MAX_DEFAULT_CANDIDATES > MAX_CANDIDATES);
});

test('cursor: defaultPlaces includes ~/.cursor/rules and the project .cursor/rules; a rule is a candidate with source cursor', () => {
  assert.ok(defaultPlaces().includes('~/.cursor/rules'));
  assert.ok(defaultPlaces().includes('.cursor/rules'));
  const { home, root } = world();
  const a = discover('', { home, root, env: {} });
  assert.ok(a.looked.includes('~/.cursor/rules'));
  assert.ok(a.looked.includes('~/work/proj/.cursor/rules'));
  assert.equal(a.candidates.find((c) => c.shown === '~/.cursor/rules/style.mdc')?.source, 'cursor');
  assert.equal(a.candidates.find((c) => c.shown === '~/work/proj/.cursor/rules/proj.mdc')?.source, 'cursor');
  assert.equal(a.candidates.find((c) => c.slug === 'demo')?.source, 'claude');
  assert.equal(a.candidates.find((c) => c.slug === 'other')?.source, 'codex');
});

test('cursor: with no project open, the project place is the home place and is listed once', () => {
  const { home } = world();
  const a = discover('', { home, root: null, env: {} });
  assert.equal(a.looked.filter((l) => l === '~/.cursor/rules').length, 1);
});

test('cursor: "all" and "everything" include Cursor', () => {
  for (const w of ['all', 'everything', 'bring everything']) assert.ok(resolveText(w).places.includes('~/.cursor/rules'), w);
});

test('cursor: cursorRuleToSkill keeps the description, keeps globs as a When to use line, and refuses an empty rule', () => {
  const r = cursorRuleToSkill('---\ndescription: Naming rules\nglobs: src/**/*.ts\nalwaysApply: false\n---\nName things well.\n', 'Project Naming.mdc');
  assert.ok(r);
  assert.equal(r.slug, 'project-naming');
  assert.ok(r.skillMd.startsWith('---\nname: project-naming\ndescription: Naming rules\n---\n'));
  assert.ok(r.skillMd.includes('## When to use\n\nApplies to files matching: src/**/*.ts'));
  assert.ok(r.skillMd.includes('Name things well.'));
  assert.equal(cursorRuleToSkill('---\ndescription: x\n---\n\n', 'e.mdc'), null);
  const plain = cursorRuleToSkill('Use tabs.\n', 'style.mdc');
  assert.ok(plain && plain.skillMd.includes('description: Cursor rule style'));
});

test('cursor: importing an .mdc rule writes a SKILL.md built from it', () => {
  const { home, root } = world();
  const rule = path.join(home, '.cursor', 'rules', 'style.mdc');
  const r = importSelected('', [rule], { home, root, env: {} });
  assert.equal(r.status, 200);
  const md = fs.readFileSync(path.join(root, '.sequence', 'skills', 'style', 'SKILL.md'), 'utf8');
  assert.ok(md.startsWith('---\nname: style\n'));
  assert.ok(md.includes('Use tabs.'));
});
