// Locks the test guard in tools/test-guard/no-real-binaries.mjs.
//
// SAFETY RULE FOR THIS FILE: nothing here may ever run a real claude, codex or
// installer. Classification uses hitFor() on literal strings. Spawn checks use env
// PATH that points ONLY at a probe directory of NON-EXECUTABLE files (a guard that
// fails open would hit EACCES, not run anything) or at an empty temp dir. The
// default-env containment check runs in a CHILD process whose PATH starts with the
// guard's own tripwire stub, which exits 97 and records a hit.
//
// Runs in the hygiene job (node --test tools/ci/*.test.mjs).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { fileURLToPath } from 'node:url';

import { guardedEnv, hitFor, tripwireDir, wrapPtyModule } from '../test-guard/no-real-binaries.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const WIN = process.platform === 'win32';
const REAL = /test tried to run a real .+; use a fake/;
const MARK = Symbol.for('sequence.test-guard.no-real-binaries');
const PROBE = path.join(HERE, `.nrb-probe-${process.pid}`);
const EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), 'nrb-empty-'));
const FAKE_SPACED = fs.mkdtempSync(path.join(os.tmpdir(), 'nrb fake dir '));
const PROBE_FILES = ['claude', 'codex', 'npm', 'pnpm', 'npx'];
const P = { env: { PATH: PROBE } };
const E = { env: { PATH: EMPTY } };
const created = [];

/*
 * The guard records every refusal in the hits file, so a refusal that product code swallows still fails
 * the process. This file EXPECTS refusals (every `assert.throws(..., REAL)` below), so for its own run the
 * hits file is a scratch one, checked at the end: it must hold refusals and nothing else (a stub that ran
 * is a real hit and fails here). The children below pass their own hits files explicitly.
 */
const HITS_KEY = 'SEQUENCE_TEST_GUARD_HITS';
const OWN_HITS = path.join(EMPTY, 'expected-refusals.jsonl');
let outerHits;
let freshCount = 0;
/** An env for a child that must hit nothing: its own empty hits file, not this file's expected refusals. */
const cleanChildEnv = () => {
  const f = path.join(EMPTY, `child-hits-${freshCount++}.jsonl`);
  fs.writeFileSync(f, '');
  return { ...process.env, [HITS_KEY]: f };
};
before(() => {
  outerHits = process.env[HITS_KEY];
  process.env[HITS_KEY] = OWN_HITS;
  fs.mkdirSync(PROBE, { recursive: true });
  for (const f of PROBE_FILES) fs.writeFileSync(path.join(PROBE, f), 'not a program\n', { mode: 0o644 });
});
after(() => {
  if (outerHits === undefined) delete process.env[HITS_KEY];
  else process.env[HITS_KEY] = outerHits;
  const lines = fs.existsSync(OWN_HITS) ? fs.readFileSync(OWN_HITS, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  assert.ok(lines.length > 0, 'the expected refusals were recorded');
  for (const l of lines) assert.ok(typeof JSON.parse(l).refused === 'string', `only refusals, no stub run: ${l}`);
});
after(() => {
  fs.rmSync(PROBE, { recursive: true, force: true });
  fs.rmSync(EMPTY, { recursive: true, force: true });
  fs.rmSync(FAKE_SPACED, { recursive: true, force: true });
  for (const d of created) fs.rmSync(d, { recursive: true, force: true });
});

// ---- the tripwire -------------------------------------------------------------------

test('the tripwire stubs are first on PATH and the vendor dirs point at an empty dir', () => {
  const trip = tripwireDir();
  assert.ok(trip, 'the guard installed a tripwire');
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH');
  assert.ok(process.env[pathKey].startsWith(trip + path.delimiter), 'tripwire is first on PATH');
  assert.ok(fs.existsSync(path.join(trip, 'claude')) || fs.existsSync(path.join(trip, 'claude.cmd')));
  assert.equal(process.env.npm_config_prefix, process.env.APPDATA, 'vendor dirs share the empty dir');
});

test('corepack keeps its real cache while the vendor dirs are blanked (an empty one made every real pnpm hang on a download prompt)', { skip: !WIN && 'win32 layout' }, () => {
  /* Positive: the pin is set and is not under the blank dir. Negative control: the blanked LOCALAPPDATA alone
     would have put corepack's home inside the empty dir, which is the defect. */
  const home = process.env.COREPACK_HOME;
  assert.ok(home, 'COREPACK_HOME is pinned');
  assert.ok(!path.resolve(home).toLowerCase().startsWith(path.resolve(process.env.LOCALAPPDATA).toLowerCase()), 'not inside the blank LOCALAPPDATA');
  assert.ok(fs.existsSync(home), 'it is the real corepack cache, which exists on a machine that has run pnpm');
  const inBlank = path.join(process.env.LOCALAPPDATA, 'node', 'corepack');
  assert.notEqual(path.resolve(home), path.resolve(inBlank), 'control: the unpinned default is the blank one');
});

test('a product-style try/catch that swallows a stub hit still fails the process, and the hit is printed', () => {
  // The child runs with its OWN hits file, so this test cannot fail the test process.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrb-child-'));
  created.push(dir);
  const hits = path.join(dir, 'hits.jsonl');
  fs.writeFileSync(hits, '');
  const script = [
    'const cp = require("node:child_process");',
    // Windows runs a bare .cmd only through a shell (libuv tries .com/.exe), so the shape that reaches the stub there is shell: true.
    `try { cp.spawnSync("claude", ["auth", "login"], { shell: ${WIN} }); } catch (e) { /* swallowed, as product code does */ }`,
    'process.exit(0);',
  ].join('\n');
  const env = { ...process.env, SEQUENCE_TEST_GUARD_HITS: hits };
  const r = cp.spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.equal(r.status, 1, 'a swallowed hit makes the child exit 1');
  assert.match(r.stderr, /test-guard: 1 real-binary hit/);
  assert.match(r.stderr, /"name":"claude"/);
  assert.match(fs.readFileSync(hits, 'utf8'), /"name":"claude"/);
});

test('a grandchild node process inherits the guard: its stub hit is reported by the child', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrb-grand-'));
  created.push(dir);
  const hits = path.join(dir, 'hits.jsonl');
  fs.writeFileSync(hits, '');
  const outer = [
    'const cp = require("node:child_process");',
    `cp.spawnSync(process.execPath, ["-e", 'require("node:child_process").spawnSync("codex", ["--help"], { shell: ${WIN} })'], { env: process.env });`,
    'process.exit(0);',
  ].join('\n');
  const r = cp.spawnSync(process.execPath, ['-e', outer], { env: { ...process.env, SEQUENCE_TEST_GUARD_HITS: hits }, encoding: 'utf8' });
  assert.equal(r.status, 1, 'the grandchild hit fails the whole tree');
  assert.match(fs.readFileSync(hits, 'utf8'), /"name":"codex"/);
});

test('guardedEnv puts the tripwire first and loads the guard in children', () => {
  const env = guardedEnv({ PATH: EMPTY });
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  assert.ok(env[pathKey].startsWith(tripwireDir() + path.delimiter));
  assert.match(env.NODE_OPTIONS, /no-real-binaries\.mjs/);
  assert.equal(env.SEQUENCE_TEST_GUARD_HITS, process.env.SEQUENCE_TEST_GUARD_HITS);
});

// ---- the call-site backstop: classification on literal shapes, nothing runs -------------

test('a real claude or codex is refused by bare name (first PATH match) or by absolute path', () => {
  assert.equal(hitFor('claude', ['--version'], P), path.join(PROBE, 'claude'));
  assert.equal(hitFor(path.join(PROBE, 'codex'), [], undefined), path.join(PROBE, 'codex'));
  assert.equal(hitFor('C:\\x\\claude.exe', ['auth', 'login'], undefined), 'C:\\x\\claude.exe');
  assert.equal(hitFor('claude', [], E), null, 'not on PATH: not a real binary, the spawn reports ENOENT');
});

test('an install tree of a blocked package is refused: node + cli.js, node --require, fork, Windows paths', () => {
  assert.ok(hitFor('node.exe', ['C:\\u\\node_modules\\@anthropic-ai\\claude-code\\cli.js'], undefined));
  assert.ok(hitFor('node', ['--require', 'x.js', '/u/node_modules/@openai/codex/bin/codex.js'], undefined));
  assert.ok(hitFor(process.execPath, ['/u/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js'], undefined));
});

test('the node-pty string-args shape (ptyShell.ts:289, win32 cmd.exe) is refused', () => {
  assert.ok(hitFor('C:\\Windows\\System32\\cmd.exe', ['/d /s /c ""C:\\x\\claude.cmd" auth login"'], undefined));
  assert.ok(hitFor('C:\\Windows\\System32\\cmd.exe', ['/d /s /c "C:\\Program Files\\Claude\\claude.exe" auth login'], undefined));
  assert.ok(hitFor('cmd.exe', ['/d', '/s', '/c', '""C:\\x\\npm.cmd" install -g @agentclientprotocol/claude-agent-acp"'], undefined));
});

test('the bundled bridge passes only as a plain entry, with a guarded env whose every claude is a test fake', () => {
  const bridge = '/u/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js';
  const winBridge = String.raw`C:\u\node_modules\@agentclientprotocol\claude-agent-acp\dist\index.js`;
  const cli = String.raw`C:\u\node_modules\@anthropic-ai\claude-code\cli.js`;
  const realExe = String.raw`C:\Users\dev\.local\bin\claude.exe`;
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'nrb-bridge-fake-'));
  created.push(fake);
  fs.writeFileSync(path.join(fake, WIN ? 'claude.cmd' : 'claude'), 'fake\n');
  const NO = guardedEnv({}).NODE_OPTIONS;
  const env = (PATH, more = {}) => ({ env: { PATH, NODE_OPTIONS: NO, ...more } });
  assert.equal(hitFor(process.execPath, [bridge], env(fake + path.delimiter + PROBE)), null, 'fake claude first: allowed');
  assert.equal(hitFor(process.execPath, [winBridge], env(fake)), null, 'Windows separators: allowed');
  assert.equal(hitFor(process.execPath, [winBridge], env(fake, { CLAUDE_CODE_EXECUTABLE: path.join(fake, 'claude.cmd') })), null, 'a fake CLAUDE_CODE_EXECUTABLE: allowed');
  assert.ok(hitFor(process.execPath, [bridge], env(PROBE + path.delimiter + fake)), 'real-looking claude first: refused');
  assert.ok(hitFor(process.execPath, [bridge], env(tripwireDir())), 'only the tripwire: refused');
  assert.ok(hitFor(process.execPath, [bridge], env(EMPTY)), 'no claude at all: refused');
  assert.ok(hitFor(process.execPath, [bridge], { env: { PATH: fake } }), 'env that does not load the guard: refused (the child would be unguarded)');
  assert.ok(hitFor(process.execPath, [winBridge], env(fake, { CLAUDE_CODE_EXECUTABLE: realExe })), 'a real CLAUDE_CODE_EXECUTABLE: refused');
  assert.ok(hitFor(process.execPath, [cli], env(fake)), 'the CLI tree itself is never allowed');
  // Shapes the first version of this exemption let through (Opus review, wave 1):
  assert.ok(hitFor('cmd.exe', ['/d', '/s', '/c', `"node ${winBridge} & node ${cli} auth login"`], env(fake)), 'a command string naming the bridge and the CLI: refused');
  assert.ok(hitFor('cmd.exe', ['/d', '/s', '/c', `"node ${winBridge} & ${realExe} auth login"`], env(fake)), 'a command string naming the bridge and a real claude.exe: refused');
  assert.ok(hitFor(process.execPath, [String.raw`C:\u\node_modules\@agentclientprotocol\claude-agent-acp\node_modules\@anthropic-ai\claude-code\cli.js`], env(fake)), 'a CLI nested under the bridge: refused');
  assert.ok(hitFor(String.raw`C:\u\node_modules\@agentclientprotocol\claude-agent-acp\node_modules\.bin\claude.cmd`, [], env(fake)), 'a .bin shim under the bridge: refused');
  assert.ok(hitFor(process.execPath, [winBridge, realExe], env(fake)), 'a real claude as a later argument: refused');
});

test('a relative PATH entry holding a real-looking claude does not stay ahead of the tripwire in a child', () => {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH');
  const rel = path.relative(process.cwd(), PROBE);
  const env = { ...process.env, [key]: rel + path.delimiter + process.env[key] };
  const r = cp.spawnSync(process.execPath, ['-e', `const k=Object.keys(process.env).find((k)=>k.toUpperCase()==='PATH');process.stdout.write(process.env[k].split(${JSON.stringify(path.delimiter)})[0])`], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, tripwireDir());
});

test('a child keeps a test fake ahead of the tripwire, but moves the tripwire ahead of a real install', () => {
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'nrb-child-fake-'));
  created.push(fake);
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH');
  const first = (dir) => {
    const env = { ...process.env, [key]: dir + path.delimiter + process.env[key] };
    const r = cp.spawnSync(process.execPath, ['-e', `const k=Object.keys(process.env).find((k)=>k.toUpperCase()==='PATH');process.stdout.write(process.env[k].split(${JSON.stringify(path.delimiter)})[0])`], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  assert.equal(first(fake), fake, 'a fake dir before the inherited tripwire stays first');
  assert.equal(first(PROBE), tripwireDir(), 'a dir with a real-looking claude before the tripwire is put behind it');
});

test('a Windows start-claude.cmd launcher (hooksLaunch.ts:57) is refused', () => {
  assert.ok(hitFor('cmd.exe', ['/d', '/s', '/c', '"C:\\x\\start-claude.cmd"'], undefined));
  assert.ok(hitFor('C:\\x\\start-claude.cmd', [], undefined));
});

test('an installer is refused whatever its separators: Sequence Setup, Sequence.Setup, Sequence-0.1.9-x64', () => {
  assert.ok(hitFor('C:\\x\\Sequence Setup 0.1.9.exe', [], undefined));
  assert.ok(hitFor('/x/Sequence.Setup.0.1.9.exe', [], undefined));
  assert.ok(hitFor('/x/Sequence-0.1.9-x64.exe', [], undefined));
  assert.ok(hitFor('/x/Sequence.dmg', [], undefined));
  assert.ok(hitFor('/x/Sequence.AppImage', [], undefined));
  assert.equal(hitFor('/x/setup-helper.js', [], undefined), null);
  assert.equal(hitFor('./scripts/setup.sh', [], undefined), null);
  assert.equal(hitFor('./install.sh', [], undefined), null);
});

test('npm, pnpm and npx installing a blocked package are refused; option values are skipped', () => {
  assert.equal(hitFor(path.join(PROBE, 'npm'), ['i', '-g', '@anthropic-ai/claude-code'], undefined), '@anthropic-ai/claude-code');
  assert.equal(hitFor(path.join(PROBE, 'npm'), ['--prefix', '/x', 'install', '@agentclientprotocol/claude-agent-acp'], undefined), '@agentclientprotocol/claude-agent-acp');
  assert.equal(hitFor('pnpm', ['add', '-g', '@openai/codex'], P), '@openai/codex');
  assert.equal(hitFor('npm', ['view', '@anthropic-ai/claude-code', 'version'], P), null, 'a read-only query is fine');
});

test('fakes pass: under os.tmpdir() (also a directory with a space), and in fixtures/ or fakes/ directories', () => {
  const tmpFake = path.join(FAKE_SPACED, 'claude');
  assert.equal(hitFor(tmpFake, [], undefined), null);
  assert.equal(hitFor('cmd.exe', ['/d', '/s', '/c', `""${FAKE_SPACED}/claude.cmd" --version"`], undefined), null, 'a quoted temp path with spaces is a fake');
  assert.equal(hitFor('/repo/packages/x/fixtures/claude', [], undefined), null);
  assert.equal(hitFor('/repo/packages/x/fakes/codex.cmd', [], undefined), null);
});

test('a bare claude is a fake when the first PATH match is a fake', () => {
  assert.equal(hitFor('claude', [], { env: { PATH: FAKE_SPACED } }), null);
});

// ---- the wrappers: spawn-based, PATH pointing only at probe or empty dirs ------------

test('spawning a real claude, codex, installer or global npm install throws (PATH = probe dir)', () => {
  assert.throws(() => cp.spawnSync('claude', ['--version'], P), REAL);
  assert.throws(() => cp.spawnSync(path.join(PROBE, 'codex'), [], undefined), REAL);
  assert.throws(() => cp.spawnSync('C:\\x\\Sequence Setup 0.1.9.exe', [], undefined), REAL);
  assert.throws(() => cp.spawnSync('npm', ['i', '-g', '@anthropic-ai/claude-code'], P), REAL);
  assert.throws(() => cp.execFileSync('pnpm', ['add', '-g', '@openai/codex'], P), REAL);
});

test('the error names the resolved path and the allow rule', () => {
  try {
    cp.spawnSync('claude', ['--version'], P);
    assert.fail('expected a throw');
  } catch (e) {
    assert.match(e.message, new RegExp(`test tried to run a real ${path.join(PROBE, 'claude').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
    assert.match(e.message, /allowed: a file under os\.tmpdir\(\) or a fixtures\/ or fakes\/ directory/);
  }
});

test('a node-pty string-args spawn in the Windows shape throws (stub module, never a pty)', () => {
  const stub = {
    spawn: (file, args) => 'pty',
    fork: (file, args) => 'pty',
  };
  wrapPtyModule(stub);
  assert.throws(() => stub.spawn('C:\\Windows\\System32\\cmd.exe', '/d /s /c ""C:\\x\\claude.cmd" auth login"', {}), REAL);
  assert.throws(() => stub.fork('claude', ['auth', 'login'], P), REAL);
  assert.equal(stub.spawn(path.join(FAKE_SPACED, 'claude'), [], {}), 'pty', 'a fake passes through');
});

test('Windows, no shell: a real claude.exe behind the tripwire claude.cmd is refused (libuv skips .cmd)', { skip: !WIN && 'win32 resolution' }, () => {
  const exeDir = path.join(HERE, `.nrb-exe-${process.pid}`);
  fs.mkdirSync(exeDir, { recursive: true });
  created.push(exeDir);
  fs.writeFileSync(path.join(exeDir, 'claude.exe'), 'not a program\n');
  const env = { env: { PATH: tripwireDir() + path.delimiter + exeDir } };
  assert.equal(hitFor('claude', ['auth', 'login'], env), path.join(exeDir, 'claude.exe'));
  for (const k of ['path', 'pAth']) assert.equal(hitFor('claude', [], { env: { [k]: exeDir } })?.toLowerCase(), path.join(exeDir, 'claude.exe').toLowerCase(), `env key ${k}`);
  assert.throws(() => cp.spawnSync('claude', ['auth', 'login'], env), REAL);
});

test('node-pty loaded by dynamic import (the ptyShell.ts shape) is wrapped, on the namespace and on default', (t) => {
  const analyzer = path.join(REPO, 'packages', 'analyzer');
  try { createRequire(path.join(analyzer, 'package.json')).resolve('node-pty'); } catch { return t.skip('node-pty not installed'); }
  const guardUrl = new URL('../test-guard/no-real-binaries.mjs', import.meta.url).href;
  const script = `const m = await import('node-pty'); const k = Symbol.for('sequence.test-guard.no-real-binaries'); process.stdout.write(JSON.stringify([Boolean(m.spawn?.[k]), Boolean(m.default?.spawn?.[k])]));`;
  const r = cp.spawnSync(process.execPath, ['--import', guardUrl, '--input-type=module', '-e', script], { cwd: analyzer, encoding: 'utf8', env: cleanChildEnv() });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [true, true]);
});

test('node-pty is wrapped when a module requires it, not when the guard loads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrb-pty-'));
  created.push(dir);
  fs.mkdirSync(path.join(dir, 'node_modules', 'node-pty'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'node-pty', 'index.js'), 'module.exports = { spawn() { return "pty"; }, fork() { return "pty"; } };\n');
  const req = createRequire(path.join(dir, 'probe.js'));
  const mod = req('node-pty');
  assert.equal(typeof mod.spawn[MARK], 'boolean', 'the required module was wrapped');
  assert.throws(() => mod.spawn('claude', [], P), REAL);
});

test('promisify(execFile) still resolves {stdout, stderr}, and a blocked promisified call throws', async () => {
  const r = await util.promisify(cp.execFile)(process.execPath, ['-e', 'process.stdout.write("x")'], { env: cleanChildEnv() });
  assert.equal(r.stdout, 'x');
  assert.equal(typeof r.stderr, 'string');
  assert.throws(() => util.promisify(cp.execFile)('claude', [], P), REAL);
});

test('a fake claude whose path has spaces runs, by absolute path', (t) => {
  if (process.platform === 'win32') { t.skip('posix shell fake'); return; }
  const fake = path.join(FAKE_SPACED, 'claude');
  fs.writeFileSync(fake, '#!/bin/sh\necho FAKE-CLAUDE "$@"\n', { mode: 0o755 });
  const r = cp.spawnSync(fake, ['--version']);
  assert.equal(r.status, 0);
  assert.match(String(r.stdout), /FAKE-CLAUDE --version/);
});

test('a blocked bare name that is not on PATH runs nothing: ENOENT, no throw', () => {
  const r = cp.spawnSync('claude', ['auth', 'login'], E);
  assert.equal(r.error?.code, 'ENOENT');
});

// ---- wiring: read files only -------------------------------------------------------

test('every test script that runs node loads the guard (web2 e2e included); web2 vitest loads it; desktop has a test timeout', () => {
  const guard = 'tools/test-guard/no-real-binaries.mjs';
  const scan = (label, scripts) => {
    for (const [key, value] of Object.entries(scripts ?? {})) {
      if (!/^test/.test(key) || typeof value !== 'string') continue;
      if (!/(^|\s|&&)node\s/.test(value)) continue;
      assert.ok(value.includes(guard), `${label} ${key} must load the guard: ${value}`);
    }
  };
  scan('root', JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).scripts);
  const pkgs = path.join(REPO, 'packages');
  for (const dir of fs.readdirSync(pkgs)) {
    const pj = path.join(pkgs, dir, 'package.json');
    if (fs.existsSync(pj)) scan(`packages/${dir}`, JSON.parse(fs.readFileSync(pj, 'utf8')).scripts);
  }
  const desktop = JSON.parse(fs.readFileSync(path.join(pkgs, 'desktop', 'package.json'), 'utf8')).scripts.test;
  assert.ok(desktop.includes('--test-timeout=120000'), 'desktop: --test-timeout=120000');
  const vitest = fs.readFileSync(path.join(pkgs, 'web2', 'vitest.config.ts'), 'utf8');
  assert.match(vitest, /setupFiles:\s*\[[^\]]*no-real-binaries\.mjs/, 'web2 vitest setupFiles must load the guard');
});
