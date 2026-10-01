/**
 * `./start.sh` is the owner launch path. A positional that is not a directory
 * (or `--help`) used to exec the CLI, which dumped the full usage page and
 * exited 1 — it looked like start failed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const START_SH = path.join(ROOT, 'start.sh');

/**
 * WHICH `bash`, AND WHAT SHAPE OF PATH - AND THE FIRST ANSWER WAS WRONG.
 *
 * These tests used to spawn a bare `bash` with the Windows path `path.join`
 * produces. Run from Git Bash they passed; run from PowerShell they failed:
 *
 *     /bin/bash: C:Users...start.sh: No such file or directory
 *
 * A gate whose verdict depends on which terminal the developer had open is not
 * measuring the repository, and neither answer it gives can be trusted.
 *
 * The missing backslashes make that read like an escaping bug, and the first
 * fix here was to hand bash forward slashes. It changed nothing, because the
 * backslashes were a symptom of something else entirely:
 *
 *     Git Bash   `bash` -> /usr/bin/bash                  (MSYS)
 *     PowerShell `bash` -> C:\Windows\System32\bash.exe   (WSL)
 *
 * They are different programs with different filesystems. WSL's bash has no
 * `C:/Users/...` - the repo lives at `/mnt/c/...` there - so no spelling of a
 * Windows path can work, and from PowerShell Git's bash is not on PATH to be
 * found at all. Whichever one PATH happened to hand over decided the result.
 *
 * So the bash is DERIVED, not looked up: `git --exec-path` reports Git's own
 * libexec, three levels up is the Git installation, and its `bin/bash.exe` is
 * the MSYS bash that shares the filesystem this repo is checked out on. Only
 * when that cannot be found do we fall back to PATH, which is right on Linux
 * and macOS where a bare `bash` is the correct answer.
 *
 * Forward slashes are kept because MSYS bash accepts them and Windows does
 * too, so one string is right for both with nothing left to escape.
 */
const START_SH_FOR_BASH = START_SH.replace(/\\/g, '/');

function resolveBash() {
  if (process.platform !== 'win32') return 'bash';
  const found = spawnSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 10_000 });
  const execPath = (found.stdout ?? '').trim();
  if (execPath !== '') {
    /* .../Git/mingw64/libexec/git-core -> .../Git */
    const gitRoot = path.resolve(execPath, '..', '..', '..');
    const candidate = path.join(gitRoot, 'bin', 'bash.exe');
    if (fs.existsSync(candidate)) return candidate.replace(/\\/g, '/');
  }
  /* Say so rather than failing later as a path that does not exist: a reader
     who sees the WSL error again should not have to rediscover any of this. */
  console.error(
    'start-sh.test: could not derive Git bash from `git --exec-path`; falling back to PATH, ' +
      'which on Windows may resolve to WSL bash and cannot see this checkout.',
  );
  return 'bash';
}

const BASH = resolveBash();

function runStart(args) {
  return spawnSync(BASH, [START_SH_FOR_BASH, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 10_000,
  });
}

/*
 * THE LOCKING CASE. It is deliberately not "the other tests pass": those fail
 * only from PowerShell, so from Git Bash they are a check that cannot fail in
 * the state it exists to check, and this defect's whole nature is that it is
 * invisible from one of the two shells.
 *
 * This asserts the thing that is true in both: the bash we chose can actually
 * see the script we are about to hand it. Before the fix that is false from
 * PowerShell (WSL bash, which has no C: drive) and true from Git Bash; the
 * point of deriving the bash is that it becomes true from either.
 */
test('the bash these tests use can resolve start.sh from any launching shell', () => {
  const seen = spawnSync(BASH, ['-c', 'test -f "$1" && echo found', '_', START_SH_FOR_BASH], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.match(
    seen.stdout ?? '',
    /found/,
    `bash (${BASH}) could not resolve ${START_SH_FOR_BASH}: stderr=${seen.stderr}`,
  );

  /* Nothing left for bash to eat as an escape. */
  assert.doesNotMatch(START_SH_FOR_BASH, /\\/);
});

test('start.sh --help exits 0 with launcher usage (before install/build)', () => {
  const src = fs.readFileSync(START_SH, 'utf8');
  const helpAt = src.indexOf('launcher_usage');
  const buildAt = src.indexOf('pnpm build');
  assert.ok(helpAt >= 0, 'start.sh must define launcher_usage');
  assert.ok(buildAt > helpAt, 'help must be handled before pnpm build');

  const r = runStart(['--help']);
  assert.strictEqual(r.status, 0, `stderr=${r.stderr}`);
  assert.match(r.stdout, /one-command launch/);
  assert.match(r.stdout, /\.\/start\.sh \/path\/to\/repo/);
  assert.doesNotMatch(r.stdout, /static architecture scanner/);
  assert.doesNotMatch(r.stdout, /▸ starting Sequence/);
});

test('start.sh rejects a non-directory positional instead of forwarding it as a CLI command', () => {
  const src = fs.readFileSync(START_SH, 'utf8');
  assert.match(src, /USER_CWD/, 'relative repo paths must resolve from the caller cwd');
  assert.match(src, /not a directory/);

  const r = runStart(['codeforge']);
  assert.strictEqual(r.status, 1, `stdout=${r.stdout}`);
  assert.match(r.stderr, /not a directory: codeforge/);
  assert.match(r.stderr, /one-command launch/);
  assert.doesNotMatch(r.stdout + r.stderr, /static architecture scanner/);
  assert.doesNotMatch(r.stdout + r.stderr, /▸ starting Sequence/);
});

/**
 * v1 (`packages/web`) was deleted 2026-08-20 and replaced by `packages/web2`.
 * The source cutover happened; the launcher's did not — so `./start.sh` kept
 * installing, stamping and building against a directory that no longer exists
 * in the repo. On a machine that had run v1, the leftover gitignored
 * `packages/web/dist` made the analyzer serve the OLD UI, which reads as "the
 * rebuild did not ship". CI stayed green because nothing here named a bundle.
 */
test('start.sh points at packages/web2, not the deleted v1 package', () => {
  const src = fs.readFileSync(START_SH, 'utf8');

  assert.match(src, /packages\/web2\/node_modules/, 'dependency check must look at web2');
  assert.match(src, /packages\/web2\/dist\/index\.html/, 'build stamp must be the web2 bundle');

  assert.doesNotMatch(
    src,
    /-d packages\/web\/node_modules/,
    'start.sh still requires node_modules from the deleted v1 package',
  );
  assert.doesNotMatch(
    src,
    /-f packages\/web\/dist\/index\.html/,
    'start.sh still stamps freshness against the deleted v1 dist',
  );
  assert.doesNotMatch(
    src,
    /-newer packages\/web\/dist\/index\.html/,
    'start.sh still compares source against the deleted v1 dist',
  );
});

/**
 * A leftover v1 dist is invisible and load-bearing: it is gitignored, it is on
 * every machine that ever ran the old app, and its only symptom was "I see the
 * wrong UI". The launcher says so rather than letting the user guess.
 */
test('start.sh names a leftover v1 dist instead of ignoring it silently', () => {
  const src = fs.readFileSync(START_SH, 'utf8');
  assert.match(src, /-d packages\/web\/dist/, 'start.sh must detect a leftover v1 dist');
  assert.match(src, /leftover packages\/web\/dist/, 'the notice must name the directory');
});

/**
 * Windows launcher is advertised in pitch / w5 journeys (`.\start.ps1`). It had
 * the same v1 cutover miss as start.sh once did — install + freshness stamped
 * against deleted `packages/web`. Static lock mirrors the bash tests.
 */
const START_PS1 = path.join(ROOT, 'start.ps1');

test('start.ps1 points at packages/web2, not the deleted v1 package', () => {
  const src = fs.readFileSync(START_PS1, 'utf8');

  assert.match(src, /packages\/web2\/node_modules/, 'dependency check must look at web2');
  assert.match(src, /packages\/web2\/dist\/index\.html/, 'build stamp must be the web2 bundle');

  assert.doesNotMatch(
    src,
    /packages\/web\/node_modules/,
    'start.ps1 still requires node_modules from the deleted v1 package',
  );
  assert.doesNotMatch(
    src,
    /packages\/web\/dist\/index\.html/,
    'start.ps1 still stamps freshness against the deleted v1 dist',
  );
});

/**
 * Missing-only install was the same trap as missing-only build: after a pull
 * that adds a dependency, node_modules/ still exists and the launcher skipped
 * install. start.sh already reinstalls when manifests beat .modules.yaml;
 * start.ps1 must match or Windows cold-start lies about "first run only".
 */
test('start.ps1 reinstalls when manifests are newer than the pnpm install marker', () => {
  const src = fs.readFileSync(START_PS1, 'utf8');
  assert.match(src, /\.modules\.yaml/, 'must compare against the pnpm install marker');
  assert.match(src, /pnpm-lock\.yaml/, 'must notice lockfile drift');
  assert.doesNotMatch(
    src,
    /first run only/,
    'must not claim install is first-run-only when freshness can force a reinstall',
  );
});

test('start.ps1 names a leftover v1 dist instead of ignoring it silently', () => {
  const src = fs.readFileSync(START_PS1, 'utf8');
  assert.match(src, /packages\/web\/dist/, 'start.ps1 must detect a leftover v1 dist');
  assert.match(src, /leftover packages\/web\/dist/, 'the notice must name the directory');
  assert.match(src, /packages\/web2\/dist/, 'the notice must name the live serve path');
});
