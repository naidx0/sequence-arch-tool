// Test guard: no test may run a REAL `claude`, `codex`, an agent bridge or an installer.
//
// Why: on 10-06 and 10-14 a test run executed a real `claude auth login`, which
// opened browser tabs on the owner's PC. Every test must use a fake.
//
// PRIMARY CONTAINMENT: the TRIPWIRE. install() writes stub programs named claude,
// codex and start-claude into a temp dir and PREPENDS that dir to PATH (and sets
// APPDATA, LOCALAPPDATA and npm_config_prefix to an empty temp dir, the places
// binResolve.ts and claudeCli.ts search after PATH). Any bare-name resolution in
// this process or a child, by any mechanism (spawn, node-pty, cmd /c, sh -c, $(which
// claude), start), finds the stub first. The stub appends a JSON line to the hits
// file and exits 97. A child that inherits the tripwire keeps a PATH that already
// carries it with no real install ahead (a test's fake dir stays first); otherwise
// the tripwire is moved to the front.
//
// HIT REPORTING: the hits file is SEQUENCE_TEST_GUARD_HITS (inherited, so a
// grandchild's hit counts). When the process exits with any hit, the guard prints
// them to stderr and sets exitCode 1, even if product code swallowed the stub's
// failure. Under vitest the setup also fails the test file that caused a new hit.
//
// BACKSTOP (thin, call-site): spawn, spawnSync, execFile, execFileSync, exec,
// execSync, fork and node-pty spawn/fork refuse, by name and location only:
//   - an ABSOLUTE path whose basename is claude, codex or start-claude (.cmd/.exe/.bat/.ps1),
//     or that is under node_modules/@anthropic-ai/claude-code, @openai/codex or
//     @agentclientprotocol/claude-agent-acp, or that is a Sequence installer
//     (basename Sequence*.exe|msi|dmg|pkg|AppImage);
//     the bridge entry (claude-agent-acp/dist/index.js, a plain argv entry, never a
//     command string) passes when the call's own env loads this guard, its
//     CLAUDE_CODE_EXECUTABLE is unset or a fake, and its first claude on PATH is a
//     test's fake (not the tripwire);
//   - a bare claude/codex whose FIRST PATH match (the call's env PATH) is such a file;
//   - npm, pnpm or npx installing one of those packages (array args).
// Command STRINGS (exec, pty string args) are scanned with a regex for absolute
// paths of the same kinds. There is no shell or cmd tokenising.
// The allowlist: a path is a FAKE when it is inside os.tmpdir() (or /tmp) or has a
// directory segment named exactly `fixtures` or `fakes`. Fakes always pass.
//
// Gaps, stated: a bare claude in an explicit env PATH without the tripwire inside a
// shell string is not caught; Windows spawn without a shell cannot run .cmd stubs, so
// there the backstop checks the file libuv would run (cwd, then PATH, .com/.exe only)
// as well as the PATHEXT match, and refuses if either is real.
//
// The locking test is tools/ci/no-real-binaries.test.mjs.

import cp from 'node:child_process';
import fs from 'node:fs';
import Module, { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

const MARK = Symbol.for('sequence.test-guard.no-real-binaries');
const WIN = process.platform === 'win32';
const HITS_ENV = 'SEQUENCE_TEST_GUARD_HITS';
const TRIP_ENV = 'SEQUENCE_TEST_GUARD_TRIPWIRE';
const EMPTY_ENV = 'SEQUENCE_TEST_GUARD_EMPTY';
const NAMES = ['claude', 'codex', 'start-claude'];
const PKG_NAMES = '@anthropic-ai/claude-code|@openai/codex|@agentclientprotocol/claude-agent-acp';
const CLI_PKG = new RegExp(`^(${PKG_NAMES})(@[^/]*)?$`);
const INSTALL_VERBS = new Set(['install', 'i', 'add', 'dlx', 'x', 'exec']);
const NPM_VALUE_OPTS = new Set([
  '--prefix', '--registry', '--userconfig', '--globalconfig', '--cache', '--workspace', '-w',
  '--filter', '-F', '--dir', '-C', '--loglevel', '--tag', '-p', '--package', '--cwd', '--reporter',
]);
const INSTALLER_BASE = /^Sequence.*\.(exe|msi|dmg|pkg|appimage)$/i;
const TREE_RE = new RegExp(`node_modules[\\\\/](?:${PKG_NAMES.replace(/\//g, '[\\\\/]')})(?=[\\\\/]|$)`, 'i');
const ABS = '(?:[A-Za-z]:|\\/)[^"\']*';
const STR_RES = [
  new RegExp(`${ABS}node_modules[\\\\/](?:${PKG_NAMES.replace(/\//g, '[\\\\/]')})`, 'gi'),
  new RegExp(`${ABS}[\\\\/](?:claude|codex|start-claude)(?:\\.(?:cmd|exe|bat|ps1))?(?=["'\\s]|$)`, 'gi'),
  new RegExp(`${ABS}[\\\\/]Sequence[^\\\\/\\s"']*\\.(?:exe|msi|dmg|pkg|AppImage)(?=["'\\s]|$)`, 'gi'),
  // an install of a blocked package in a command string (npm.cmd install -g <pkg> under cmd /c)
  new RegExp(`\\b(?:install|i|add|dlx)\\b[^"']*?(?:${PKG_NAMES})`, 'gi'),
];

// Captured at load time; a test may override os.tmpdir() later.
const TMP_ROOTS = new Set();
function addRoot(p) {
  if (!p) return;
  TMP_ROOTS.add(path.resolve(p));
  try { TMP_ROOTS.add(fs.realpathSync(p)); } catch { /* absent: keep the literal */ }
}
addRoot(os.tmpdir());
addRoot('/tmp');

const baseOf = (p) => String(p).split(/[\\/]/).pop() ?? '';
const stripExt = (b) => b.replace(/\.(exe|cmd|ps1|bat)$/i, '').toLowerCase();
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isAbs = (p) => path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p);

function isFakePath(abs) {
  let real = abs;
  try { real = fs.realpathSync(abs); } catch { /* not present: check the literal */ }
  const roots = new Set([...TMP_ROOTS, os.tmpdir()].map((r) => path.resolve(r)));
  for (const r of roots) {
    if (real === r || real.startsWith(r + path.sep)) return true;
  }
  return real.split(/[\\/]/).some((seg) => seg === 'fixtures' || seg === 'fakes');
}

/** Whether a command string mentions a fake location before position `at` (a tmp root or fixtures/fakes). */
function fakeBefore(s, at) {
  const head = s.slice(0, at);
  if (/[\\/](fixtures|fakes)[\\/]/.test(head)) return true;
  for (const r of TMP_ROOTS) if (head.includes(r)) return true;
  return false;
}

/** An absolute path that is a real claude, codex, bridge or installer. Returns the path, or null. */
function absHit(p) {
  if (isFakePath(p)) return null;
  if (TREE_RE.test(p)) return p;
  const b = baseOf(p);
  if (NAMES.includes(stripExt(b))) return p;
  if (INSTALLER_BASE.test(b)) return p;
  return null;
}

/** A command string or an arg that is not a plain absolute path: scan for absolute install paths. */
function stringHit(s) {
  for (const re of STR_RES) {
    for (const m of s.matchAll(re)) {
      if (fakeBefore(s, m.index) || isFakePath(m[0])) continue;
      return m[0];
    }
  }
  return null;
}

/** The first PATH match for a bare name, using the call's env PATH (else process.env). */
function firstOnPath(name, options, noShell = false) {
  const env = (options && options.env) || process.env;
  // libuv matches the PATH key case-insensitively (`path`, `pAth`), so must this.
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  const pathValue = (key ? env[key] : undefined) ?? process.env.PATH ?? '';
  // A shell resolves by PATHEXT; libuv's spawn without a shell tries only .com and .exe,
  // and looks in the cwd first. The two can pick different files: check both.
  const exts = !WIN ? [''] : noShell ? ['.com', '.exe'] : ['', ...((env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';'))];
  const dirs = pathValue.split(path.delimiter);
  if (WIN && noShell) dirs.unshift(options?.cwd ? String(options.cwd) : process.cwd());
  for (const raw of dirs) {
    if (!raw) continue;
    const dir = path.resolve(raw);
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

/** npm, pnpm, npx installing or running a blocked package (array args only). */
function pkgHit(file, args, options) {
  const name = stripExt(baseOf(file));
  if (name !== 'npm' && name !== 'pnpm' && name !== 'npx') return null;
  const pos = [];
  let endOpts = false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (!endOpts && a === '--') { endOpts = true; continue; }
    if (!endOpts && a.startsWith('-')) { if (NPM_VALUE_OPTS.has(a)) k++; continue; }
    pos.push(a);
  }
  const pkgOf = (s) => { const m = CLI_PKG.exec(s); return m ? m[1] : null; };
  let hit = null;
  if (name === 'npx') hit = pos[0] ? pkgOf(pos[0]) : null;
  else if (INSTALL_VERBS.has(pos[0])) hit = pos.slice(1).map(pkgOf).find(Boolean) ?? null;
  if (!hit) return null;
  const resolved = /[\\/]/.test(String(file)) ? String(file) : firstOnPath(String(file), options);
  return resolved && !isFakePath(resolved) ? hit : null;
}

/** Exactly the bridge's entry file: nothing nested under the package (no .bin, no bundled CLI). */
const BRIDGE_ENTRY_RE = /[\\/]node_modules[\\/]@agentclientprotocol[\\/]claude-agent-acp[\\/]dist[\\/]index\.js$/i;

/**
 * The bundled bridge is not the claude CLI, so `node <bridge entry>` is allowed when
 * everything it could reach is a fake: the call passes its own env; that env loads
 * this guard by NODE_OPTIONS (so the bridge's own spawns are guarded in the child);
 * CLAUDE_CODE_EXECUTABLE, which the bridge runs first, is unset or a fake; and the
 * claude first on that PATH is a fake the test wrote (not the tripwire stub). Only a
 * plain argv entry qualifies: a command string is never exempt.
 */
function bridgeEnvIsFake(options) {
  const env = options?.env;
  if (!env || !String(env.NODE_OPTIONS ?? '').includes(import.meta.url)) return false;
  const exe = env.CLAUDE_CODE_EXECUTABLE;
  if (exe && !(isAbs(exe) && isFakePath(exe))) return false;
  const m = firstOnPath('claude', options);
  return Boolean(m && isFakePath(m) && path.dirname(m) !== TRIP);
}

/** The hit for one call: a resolved path or package name, or null. */
function callHit(file, args, options) {
  const f = String(file);
  const exempt = (s) => isAbs(s) && BRIDGE_ENTRY_RE.test(s) && bridgeEnvIsFake(options);
  // A whole-path check first; a string that is not one plain path is then scanned for paths inside it.
  const check = (s) => (exempt(s) ? null : (isAbs(s) && absHit(s)) || stringHit(s));
  if (!isAbs(f) && !/[\\/]/.test(f) && NAMES.includes(stripExt(f))) {
    for (const m of [firstOnPath(f, options), WIN ? firstOnPath(f, options, true) : null]) {
      const h = m && absHit(m);
      if (h) return h;
    }
  } else {
    const h = check(f);
    if (h) return h;
  }
  for (const a of args) {
    const h = check(a);
    if (h) return h;
  }
  return pkgHit(f, args, options);
}

/** The tripwire directory this process put first on PATH (for tests). */
export function tripwireDir() {
  return TRIP;
}

/** The hit for a call as the wrappers see it, or null. */
export function hitFor(file, args, options) {
  return callHit(file, (args ?? []).map(String), options);
}

function enforce(name, a) {
  let file;
  let args;
  let opts;
  if (name === 'exec' || name === 'execSync') {
    file = String(a[0]);
    args = [];
    opts = isObj(a[1]) ? a[1] : undefined;
  } else {
    file = String(a[0]);
    args = Array.isArray(a[1]) ? a[1].map(String) : typeof a[1] === 'string' ? [a[1]] : [];
    opts = isObj(a[1]) ? a[1] : isObj(a[2]) ? a[2] : undefined;
  }
  const hit = callHit(file, args, opts);
  if (hit) {
    const err = new Error(
      `test tried to run a real ${hit}; use a fake (allowed: a file under os.tmpdir() or a fixtures/ or fakes/ directory)`,
    );
    err.code = 'ERR_TEST_REAL_BINARY';
    err.guard = name;
    // A refusal is a hit: product code that swallows this throw must still fail the process (the exit hook reads it).
    recordRefusal(hit, args);
    throw err;
  }
}

// ---- the tripwire -------------------------------------------------------------

let TRIP = null;
let EMPTY = null;

function stubText(n, hitsDefault) {
  if (WIN) {
    return [
      '@echo off',
      `if defined ${HITS_ENV} (echo {"name":"${n}","args":"%*"}>>"%${HITS_ENV}%") else (echo {"name":"${n}","args":"%*"}>>"${hitsDefault}")`,
      `echo test reached a real ${n}; use a fake 1>&2`,
      'exit /b 97',
      '',
    ].join('\r\n');
  }
  return [
    '#!/bin/sh',
    `printf '{"name":"${n}","args":"%s","pid":%s}\\n' "$*" "$$" >> "\${${HITS_ENV}:-${hitsDefault}}"`,
    `echo "test reached a real ${n}; use a fake" >&2`,
    'exit 97',
    '',
  ].join('\n');
}

function envKey(env) {
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
}

/**
 * The package-manager cache must survive the blanking below. Corepack keeps the pinned pnpm under
 * %LOCALAPPDATA%\node\corepack; with LOCALAPPDATA empty it finds nothing, prints "Corepack is about to download
 * pnpm-X.tgz", waits on a prompt nobody answers and then goes to the network, so every real `pnpm` a test starts
 * hangs until its own timeout whatever the machine load. Pinned to the real location once, before the blanking;
 * a child inherits the pin because it inherits the environment.
 */
function keepToolCaches(env) {
  if (env.COREPACK_HOME || !WIN || !env.LOCALAPPDATA) return;
  env.COREPACK_HOME = path.join(env.LOCALAPPDATA, 'node', 'corepack');
}

/** Vendor and npm dirs that binResolve and claudeCli search after PATH: empty for tests. */
function pointVendorDirsAtEmpty(env) {
  env.APPDATA = EMPTY;
  env.LOCALAPPDATA = EMPTY;
  env.npm_config_prefix = EMPTY;
}

function installTripwire() {
  if (TRIP) return;
  if (process.env[TRIP_ENV] && fs.existsSync(process.env[TRIP_ENV])) {
    TRIP = process.env[TRIP_ENV];
    EMPTY = process.env[EMPTY_ENV];
  } else {
    TRIP = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-tripwire-'));
    EMPTY = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-empty-'));
    const hitsDefault = path.join(TRIP, 'hits.jsonl');
    fs.writeFileSync(hitsDefault, '');
    for (const n of NAMES) {
      if (WIN) fs.writeFileSync(path.join(TRIP, `${n}.cmd`), stubText(n, hitsDefault), 'utf8');
      else fs.writeFileSync(path.join(TRIP, n), stubText(n, hitsDefault), { mode: 0o755 });
    }
    process.env[TRIP_ENV] = TRIP;
    process.env[EMPTY_ENV] = EMPTY;
  }
  if (!process.env[HITS_ENV]) process.env[HITS_ENV] = path.join(TRIP, 'hits.jsonl');
  const key = envKey(process.env);
  process.env[key] = placeTripwire(process.env[key] ?? '');
  if (WIN && key !== 'Path') process.env.Path = process.env[key];
  keepToolCaches(process.env);
  pointVendorDirsAtEmpty(process.env);
}

/** Whether a PATH dir holds a claude, codex or start-claude that is not a fake. */
function holdsRealInstall(rawDir) {
  if (!rawDir) return false;
  // A relative entry (node_modules/.bin) resolves against the cwd: checked, not trusted.
  const dir = path.resolve(rawDir);
  if (isFakePath(dir)) return false;
  const exts = WIN ? ['', '.exe', '.cmd', '.bat', '.ps1'] : [''];
  return NAMES.some((n) => exts.some((e) => {
    try { return fs.statSync(path.join(dir, n + e)).isFile(); } catch { return false; }
  }));
}

/**
 * The tripwire goes first, unless this PATH already carries it with no real install
 * ahead of it. That keeps a test's fake ahead of the stub in a child started with
 * PATH = fakeDir + the parent's PATH; re-prepending would shadow the fake.
 */
function placeTripwire(value) {
  const dirs = value.split(path.delimiter);
  const at = dirs.indexOf(TRIP);
  if (at >= 0 && !dirs.slice(0, at).some(holdsRealInstall)) return value;
  return [TRIP, ...dirs.filter((d) => d !== TRIP)].join(path.delimiter);
}

function hitsFile() {
  return process.env[HITS_ENV] || (TRIP ? path.join(TRIP, 'hits.jsonl') : null);
}

/** Append a refused call to the hits file, in the stubs' line shape plus `refused`. */
function recordRefusal(hit, args) {
  const f = hitsFile();
  if (!f) return;
  const name = stripExt(path.basename(String(hit).split(/\s/)[0])).toLowerCase();
  try {
    fs.appendFileSync(f, JSON.stringify({ name, args: args.join(' '), refused: String(hit) }) + '\n');
  } catch {
    /* an unwritable hits file must not turn a refusal into a different error */
  }
}

/** The hit lines written to the hits file so far (by this process or any child). */
function readHits() {
  const f = hitsFile();
  if (!f) return [];
  try {
    return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

// ---- wiring -------------------------------------------------------------------

/** node-pty's spawn and fork take (file, args, options); args may be a string on Windows. */
export function wrapPtyModule(mod) {
  for (const name of ['spawn', 'fork']) {
    const orig = mod?.[name];
    if (typeof orig !== 'function' || orig[MARK]) continue;
    const w = function guardedPty(...a) {
      enforce(name, a);
      return orig.apply(this, a);
    };
    Object.defineProperty(w, MARK, { value: true });
    mod[name] = w;
  }
  return mod;
}

const PTY_WRAP = Symbol.for('sequence.test-guard.wrap-pty');
const PTY_MAIN = /[\\/]node-pty[\\/]lib[\\/]index\.js$/i;

/**
 * Wrap node-pty when it is first loaded, by require OR by `await import('node-pty')`
 * (ptyShell.ts imports it that way, which never passes Module._load): a module load
 * hook appends one line to node-pty's main file that hands its exports to
 * wrapPtyModule before anything can read them. No eager require in every child.
 */
function hookNodePty() {
  if (typeof Module.registerHooks === 'function' && !globalThis[PTY_WRAP]) {
    globalThis[PTY_WRAP] = (exp) => { try { wrapPtyModule(exp); } catch { /* not a module we can wrap */ } };
    Module.registerHooks({
      load(url, context, nextLoad) {
        const r = nextLoad(url, context);
        if (!PTY_MAIN.test(url) || r.source == null) return r;
        return { ...r, source: `${String(r.source)}\n;globalThis[Symbol.for('sequence.test-guard.wrap-pty')]?.(module.exports);\n` };
      },
    });
  }
  const orig = Module._load;
  if (orig[MARK]) return;
  const hooked = function guardedLoad(request, parent, isMain) {
    const exp = orig.apply(this, arguments);
    if (typeof request === 'string' && (request === 'node-pty' || request.endsWith('/node-pty'))) {
      try { wrapPtyModule(exp); } catch { /* not a module we can wrap */ }
    }
    return exp;
  };
  Object.defineProperty(hooked, MARK, { value: true });
  Module._load = hooked;
}

function withImport(nodeOptions) {
  const url = import.meta.url;
  const cur = nodeOptions ?? '';
  return cur.includes(url) ? cur : `${cur} --import=${url}`.trim();
}

function wrapFn(name, orig) {
  const wrapper = function guardedChildProcess(...a) {
    enforce(name, a);
    return orig.apply(this, a);
  };
  for (const key of Reflect.ownKeys(orig)) {
    if (['length', 'name', 'prototype', 'arguments', 'caller'].includes(key)) continue;
    if (key === util.promisify.custom) continue;
    Object.defineProperty(wrapper, key, Object.getOwnPropertyDescriptor(orig, key));
  }
  const custom = orig[util.promisify.custom];
  if (typeof custom === 'function') {
    Object.defineProperty(wrapper, util.promisify.custom, {
      value: function guardedPromisified(...a) {
        enforce(name, a);
        return custom.apply(this, a);
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  Object.defineProperty(wrapper, MARK, { value: true });
  return wrapper;
}

/**
 * A complete env for a child process that the test starts with its own env: the
 * tripwire first on PATH, the vendor dirs empty, the guard loaded by NODE_OPTIONS,
 * and the same hits file. Use it for any spawn that passes an explicit env.
 */
export function guardedEnv(base = process.env) {
  install();
  const env = { ...base };
  const key = envKey(env);
  env[key] = `${TRIP}${path.delimiter}${env[key] ?? ''}`;
  env[HITS_ENV] = process.env[HITS_ENV];
  env.NODE_OPTIONS = withImport(env.NODE_OPTIONS);
  pointVendorDirsAtEmpty(env);
  return env;
}

let reported = false;
function reportAtExit() {
  if (reported) return;
  reported = true;
  process.on('exit', () => {
    const hits = readHits();
    if (hits.length) {
      process.stderr.write(`test-guard: ${hits.length} real-binary hit(s) (a stub ran, so a test reached a real claude/codex):\n${hits.join('\n')}\n`);
      process.exitCode = 1;
    }
  });
}

function registerVitestCheck() {
  if (typeof globalThis.afterAll !== 'function') return;
  const before = readHits().length;
  globalThis.afterAll(() => {
    const fresh = readHits().slice(before);
    if (fresh.length) throw new Error(`test-guard: a test reached a real claude/codex:\n${fresh.join('\n')}`);
  });
}

function install() {
  if (cp[MARK]) return;
  installTripwire();
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
    cp[name] = wrapFn(name, cp[name]);
  }
  Object.defineProperty(cp, MARK, { value: true, enumerable: false });
  syncBuiltinESMExports();
  hookNodePty();
  process.env.NODE_OPTIONS = withImport(process.env.NODE_OPTIONS);
  reportAtExit();
}

install();
registerVitestCheck();
