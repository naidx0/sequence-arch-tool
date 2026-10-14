/*
 * release-smoke/lib.mjs - the pure parts of the release smoke: arguments, the verdict, the budgets, the environment
 * the app is launched with, and the helpers that make its fixtures. Nothing here launches the app; run.mjs does.
 * Every function is covered by tools/release-smoke/test/release-smoke.test.mjs, each budget with a negative control.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The ten steps, in the order they run. The verdict is derived from THIS list: a step that never reported fails. */
export const STEPS = [
  { id: 'a', name: 'first run, nothing installed: onboarding shows, no crash' },
  { id: 'b', name: '"Connect a model" goes to a route, never back to the picker' },
  { id: 'c', name: 'Skip, then send: "Connect a model to run this" card, typed text kept' },
  { id: 'd', name: 'open a folder inside home works; outside home is a plain refusal' },
  { id: 'e', name: 'clone a local git URL lands exactly in the chosen folder' },
  { id: 'f', name: 'Files, Spaces, Terminal, Agents tab clicks leave exactly one pane' },
  { id: 'g', name: 'terminal survives 1440 -> 780 -> 1440 and still renders text' },
  { id: 'h', name: 'board Clear then Undo restores the shapes' },
  { id: 'i', name: 'slash menu /goal text equals the chip text' },
  { id: 'j', name: 'Settings "Read more" URL answers HTTP 200' },
];

/** The budgets. Any status but PASS fails the run; SKIP is never a pass. */
export const BUDGETS = [
  { id: 'window-shown', name: 'window shown < 2 s with a ~3k-file repo as the last-opened repo' },
  { id: 'slow-scan', name: 'the app never quits on a slow startup scan' },
  { id: 'server-size', name: 'resources/server < 60 MiB' },
  { id: 'repo-secrets', name: 'no secret under <repo>/.sequence after saving a key' },
  { id: 'key-file-mode', name: 'the user-level key file is not readable by others' },
];

export const WINDOW_SHOWN_LIMIT_MS = 2000;
export const SERVER_SIZE_LIMIT_BYTES = 60 * 1024 * 1024;
export const SLOW_SCAN_DELAY_MS = 45_000;
export const SLOW_SCAN_HOOK = 'SEQUENCE_DEBUG_STARTUP_SCAN_DELAY_MS';
/** Not a key: the shape of one, so a leak of it is found by the same scan that would find a real one. */
export const FAKE_KEY = 'sk-test-' + '0'.repeat(40);
/** Words the UI must never show a person (C5, audit P1-8). */
export const INTERNAL_WORDS = ['jail', 'boundary', 'browseRoot'];

/** `--app <exe> | --release-dir <packages/desktop/release> --out <dir> --only a,b,window-shown --keep-temp --help` */
export function parseArgs(argv) {
  const out = { app: null, releaseDir: null, out: null, only: null, keepTemp: false, help: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        out.errors.push(`${a} needs a value`);
        return null;
      }
      i += 1;
      return v;
    };
    if (a === '--app') out.app = value();
    else if (a === '--release-dir') out.releaseDir = value();
    else if (a === '--out') out.out = value();
    else if (a === '--only') {
      const v = value();
      if (v !== null) out.only = v.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--') continue; // pnpm run passes the separator through
    else if (a === '--keep-temp') out.keepTemp = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else out.errors.push(`unknown argument: ${a}`);
  }
  if (out.only) {
    const known = new Set([...STEPS, ...BUDGETS].map((s) => s.id));
    for (const id of out.only) if (!known.has(id)) out.errors.push(`--only names an unknown step or budget: ${id}`);
  }
  return out;
}

/** The packaged app for this platform, as tools/desktop-smoke.mjs resolves it. */
export function packagedCandidates(releaseDir, platform) {
  return (
    {
      win32: [path.join(releaseDir, 'win-unpacked', 'Sequence.exe')],
      darwin: [
        path.join(releaseDir, 'mac-arm64', 'Sequence.app', 'Contents', 'MacOS', 'Sequence'),
        path.join(releaseDir, 'mac', 'Sequence.app', 'Contents', 'MacOS', 'Sequence'),
      ],
      linux: [path.join(releaseDir, 'linux-unpacked', 'sequence')],
    }[platform] ?? []
  );
}

/** Where `resources/` sits next to the executable. */
export function resourcesDir(exe, platform) {
  return platform === 'darwin' ? path.resolve(path.dirname(exe), '..', 'Resources') : path.join(path.dirname(exe), 'resources');
}

/**
 * The verdict for the whole run. `expected` is every id that should have reported (derived from STEPS/BUDGETS, or the
 * --only subset); a missing one is a FAIL. Exit 0 only when every expected result is PASS.
 */
export function verdict(results, expected) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const rows = expected.map((id) => byId.get(id) ?? { id, status: 'FAIL', reason: 'did not run (no result was recorded)' });
  for (const r of results) if (!expected.includes(r.id)) rows.push(r);
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const ok = rows.length > 0 && rows.every((r) => r.status === 'PASS');
  return { ok, exitCode: ok ? 0 : 1, rows, counts };
}

/** A fixed-width table for the console and the report. */
export function formatTable(rows) {
  const lines = rows.map((r) => `${r.status.padEnd(4)}  ${r.id.padEnd(13)} ${r.reason ?? ''}`);
  return lines.join('\n');
}

/* ── budgets ─────────────────────────────────────────────────────────────── */

export function windowShownVerdict(ms, limit = WINDOW_SHOWN_LIMIT_MS) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return { status: 'FAIL', reason: 'no window-shown time was reported' };
  return ms < limit
    ? { status: 'PASS', reason: `window shown ${Math.round(ms)} ms after launch (< ${limit} ms)` }
    : { status: 'FAIL', reason: `window shown ${Math.round(ms)} ms after launch (budget < ${limit} ms)` };
}

/** Total bytes under a directory (files only, symlinks not followed). */
export function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) total += fs.statSync(p).size;
    }
  }
  return total;
}

export function serverSizeVerdict(bytes, limit = SERVER_SIZE_LIMIT_BYTES, exists = true) {
  if (!exists) return { status: 'FAIL', reason: 'resources/server does not exist in this build' };
  const mib = (b) => (b / 1024 / 1024).toFixed(1);
  return bytes < limit
    ? { status: 'PASS', reason: `resources/server is ${mib(bytes)} MiB (< ${mib(limit)} MiB)` }
    : { status: 'FAIL', reason: `resources/server is ${mib(bytes)} MiB (budget < ${mib(limit)} MiB)` };
}

const SECRET_RE = /sk-[A-Za-z0-9_-]{16,}/;

/** Files under `dir` holding the fake key or anything shaped like an sk- key. A missing dir has none. */
export function scanForSecrets(dir, needles = [FAKE_KEY]) {
  const hits = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!e.isFile()) continue;
      let text;
      try {
        text = fs.readFileSync(p).toString('latin1');
      } catch {
        continue;
      }
      const needle = needles.find((n) => text.includes(n));
      const m = needle ? null : SECRET_RE.exec(text);
      if (needle || m) hits.push({ file: p, match: needle ? 'the saved key' : m[0].slice(0, 8) + '...' });
    }
  }
  return hits;
}

/**
 * The repo-secrets budget. Its preconditions are part of it: with no repo attached, or the repo not trusted (the case
 * where 0.1.8 wrote ai.json into the repo), or no key saved, a clean scan proves nothing, so each is a FAIL.
 */
export function repoSecretsVerdict({ attached, trusted, trustReason = '', saved, savedReason, dirs }) {
  if (!attached) return { status: 'FAIL', reason: 'no repository was attached when the key was saved (nothing to scan)' };
  if (!trusted) return { status: 'FAIL', reason: `could not trust the attached repository before saving the key (${trustReason})` };
  if (!saved) return { status: 'FAIL', reason: `could not save a test key through the app: ${savedReason}` };
  const hits = dirs.flatMap((d) => scanForSecrets(d));
  if (hits.length) return { status: 'FAIL', reason: `key material under the repo: ${hits.map((h) => `${h.file} (${h.match})`).join('; ')}` };
  return { status: 'PASS', reason: `trusted repo ${attached}, key saved, none under ${dirs.join(', ')}` };
}

/** Principals that make a Windows file readable by other people on the machine. */
const WIDE_PRINCIPALS = [/\bEveryone\b/i, /BUILTIN\\Users\b/i, /NT AUTHORITY\\Authenticated Users\b/i, /\\Users:/i];

/**
 * One key file. `content` is what is on disk; ciphertext (no key in plain) passes whatever the mode. Plaintext must be
 * 0o600-ish on POSIX (no group/other bits) and, on Windows, must not be granted to Everyone/Users/Authenticated Users.
 */
export function keyFileVerdict({ file, platform, mode, aclText, content, needle = FAKE_KEY }) {
  const plain = typeof content === 'string' ? content.includes(needle) || SECRET_RE.test(content) : true;
  if (!plain) return { status: 'PASS', reason: `${file} holds no key in plain text (sealed)` };
  if (platform === 'win32') {
    if (typeof aclText !== 'string' || aclText.trim() === '') return { status: 'FAIL', reason: `${file}: plain key and its ACL could not be read` };
    const wide = aclText.split(/\r?\n/).filter((l) => WIDE_PRINCIPALS.some((re) => re.test(l)));
    return wide.length
      ? { status: 'FAIL', reason: `${file}: plain key readable by ${wide.map((l) => l.trim()).join(' | ')}` }
      : { status: 'PASS', reason: `${file}: plain key, ACL grants no Everyone/Users read` };
  }
  if (typeof mode !== 'number') return { status: 'FAIL', reason: `${file}: plain key and its mode could not be read` };
  return (mode & 0o077) === 0
    ? { status: 'PASS', reason: `${file}: mode ${(mode & 0o777).toString(8)}` }
    : { status: 'FAIL', reason: `${file}: plain key with mode ${(mode & 0o777).toString(8)} (group/other can read)` };
}

/** The key-file budget across the candidate files. No user-level file at all is a FAIL: the key went somewhere else. */
export function keyFilesVerdict(perFile) {
  if (!perFile.length) return { status: 'FAIL', reason: 'no user-level key file exists after saving a key (the key was not stored at user level)' };
  const bad = perFile.filter((v) => v.status !== 'PASS');
  return bad.length ? { status: 'FAIL', reason: bad.map((v) => v.reason).join('; ') } : { status: 'PASS', reason: perFile.map((v) => v.reason).join('; ') };
}

/**
 * The slow-scan budget. `hookHonoured` says whether this build can be made to scan slowly at all; a run that survived
 * without the hook proves nothing about a slow scan, so it is a SKIP (which fails the run), never a PASS.
 */
export function slowScanVerdict({ hookHonoured, survived, watchedMs, detail }) {
  if (!survived) return { status: 'FAIL', reason: `the app did not stay up through the scan: ${detail}` };
  if (!hookHonoured)
    return { status: 'SKIP', reason: `this build does not read ${SLOW_SCAN_HOOK}, so a slow scan could not be simulated (it stayed up ${Math.round(watchedMs / 1000)} s on a real scan: ${detail})` };
  return { status: 'PASS', reason: `stayed up ${Math.round(watchedMs / 1000)} s with a ${SLOW_SCAN_DELAY_MS / 1000} s scan delay: ${detail}` };
}

/**
 * Did the app stay up through the startup scan? Since B1 the window shows a `data:` boot page while the engine scans
 * and loads the app URL only after the attach, so the page URL during the scan is not an http origin. Survival is:
 * the app did not quit, the main process kept answering, a window became visible and stayed visible, and at the end
 * the window is on the http app URL and /api/status answered there.
 */
export function slowScanSurvival({ quit, mainAnswered, becameVisible, hiddenAfterShown, finalUrl, statusAnswered, bootTexts = [] }) {
  const why = [];
  if (quit) why.push('the app quit');
  if (!mainAnswered) why.push('the main process stopped answering (blocked on a dialog?)');
  if (!becameVisible) why.push('no window was ever visible');
  if (hiddenAfterShown) why.push('the window went away during the scan');
  const onApp = typeof finalUrl === 'string' && /^https?:\/\//.test(finalUrl);
  if (!onApp) why.push(`the window never reached the app URL (still on ${String(finalUrl ?? 'nothing').slice(0, 40)})`);
  else if (!statusAnswered) why.push('the app URL loaded but /api/status did not answer');
  const boot = bootTexts.length ? `boot page said: ${[...new Set(bootTexts)].slice(0, 3).join(' / ')}` : 'no Reading/Counting text seen on the boot page';
  return why.length ? { survived: false, detail: `${why.join('; ')}; ${boot}` } : { survived: true, detail: `window stayed up, then reached ${finalUrl.replace(/\/+$/, '')} and /api/status answered; ${boot}` };
}

export const RELEASES_URL = 'https://github.com/naidx0/sequence-arch-tool/releases/tag/v';

/**
 * Step j. (a) The app's own "Read more" links its own release exactly. That page exists only once the release is
 * published, and this smoke runs before upload, so it is not fetched. (b) Every What's new link for an already
 * published version (any other listed version) answers 200. A 404 there is a FAIL; a network error is a SKIP.
 */
export function releaseNotesVerdict({ appVersion, ownUrl, published }) {
  const want = `${RELEASES_URL}${appVersion}`;
  if (!appVersion) return { status: 'FAIL', reason: 'the app did not say which version it is' };
  if (!ownUrl) return { status: 'FAIL', reason: `no "Read more" link for this version (v${appVersion}) in What's new` };
  if (ownUrl !== want) return { status: 'FAIL', reason: `"Read more" for v${appVersion} is ${ownUrl}, want ${want}` };
  if (!published.length) return { status: 'FAIL', reason: `What's new lists no published version besides v${appVersion} to check` };
  const bad = published.filter((p) => !p.error && p.status !== 200);
  if (bad.length) return { status: 'FAIL', reason: `published release notes do not answer 200: ${bad.map((p) => `v${p.version} ${p.url} -> HTTP ${p.status}`).join('; ')}` };
  const offline = published.filter((p) => p.error);
  if (offline.length) return { status: 'SKIP', reason: `could not reach ${offline.map((p) => `${p.url} (${p.error})`).join('; ')}; offline is not a pass` };
  return { status: 'PASS', reason: `own link is ${want}; ${published.length} published (${published.map((p) => `v${p.version}`).join(', ')}) answer 200` };
}

/** The Read-more URL check. A network failure is a SKIP with the reason, never a PASS. */
export function urlVerdict({ url, status, error }) {
  if (!url) return { status: 'FAIL', reason: 'Settings "Read more" opens no URL' };
  if (error) return { status: 'SKIP', reason: `could not reach ${url} (${error}); offline is not a pass` };
  return status === 200 ? { status: 'PASS', reason: `${url} -> 200` } : { status: 'FAIL', reason: `${url} -> HTTP ${status}` };
}

/** Text the UI showed, checked for internal words. */
export function internalWordsIn(text) {
  const t = String(text ?? '');
  return INTERNAL_WORDS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(t));
}

/** Collapse whitespace and case, so "Set a  long task" and "set a long task" compare equal. */
export function norm(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ── the environment the app runs in ─────────────────────────────────────── */

const KEEP_WIN = ['SystemRoot', 'SYSTEMROOT', 'windir', 'SystemDrive', 'SYSTEMDRIVE', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'OS', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'ProgramData', 'PUBLIC', 'COMPUTERNAME', 'USERNAME', 'USERDOMAIN'];
const KEEP_POSIX = ['TMPDIR', 'LANG', 'LC_ALL', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'USER', 'LOGNAME', 'SHELL'];

/**
 * A clean environment: only the system variables, a fake home, a user store inside it, and a PATH of system folders
 * plus git's. No API keys, no agent CLIs from the real PATH, nothing that points at the real profile.
 */
export function buildEnv({ base, platform, fakeHome, gitDir, extra = {} }) {
  const env = {};
  for (const k of platform === 'win32' ? KEEP_WIN : KEEP_POSIX) if (base[k] !== undefined) env[k] = base[k];
  const sys = platform === 'win32' ? base.SystemRoot ?? base.SYSTEMROOT ?? 'C:\\Windows' : null;
  const sysPath =
    platform === 'win32'
      ? [path.win32.join(sys, 'System32'), sys, path.win32.join(sys, 'System32', 'Wbem'), path.win32.join(sys, 'System32', 'WindowsPowerShell', 'v1.0')]
      : ['/usr/local/bin', '/usr/bin', '/bin'];
  const sep = platform === 'win32' ? ';' : ':';
  env.PATH = [...sysPath, ...(gitDir ? [gitDir] : [])].join(sep);
  if (platform === 'win32') env.Path = env.PATH;
  env.HOME = fakeHome;
  if (platform === 'win32') {
    env.USERPROFILE = fakeHome;
    env.APPDATA = path.join(fakeHome, 'AppData', 'Roaming');
    env.LOCALAPPDATA = path.join(fakeHome, 'AppData', 'Local');
    const drive = /^[A-Za-z]:/.exec(fakeHome)?.[0];
    if (drive) {
      env.HOMEDRIVE = drive;
      env.HOMEPATH = fakeHome.slice(drive.length);
    }
  } else {
    env.XDG_CONFIG_HOME = path.join(fakeHome, '.config');
    env.XDG_DATA_HOME = path.join(fakeHome, '.local', 'share');
    env.XDG_CACHE_HOME = path.join(fakeHome, '.cache');
  }
  env.SEQUENCE_USER_DIR = path.join(fakeHome, '.sequence');
  return { ...env, ...extra };
}

/** True when an environment would let the app see the real profile: the guard run.mjs applies before every launch. */
export function envLeaks(env, realHome) {
  const leaks = [];
  const under = (p) => typeof p === 'string' && realHome && path.resolve(p).toLowerCase() === path.resolve(realHome).toLowerCase();
  for (const k of ['HOME', 'USERPROFILE']) if (under(env[k])) leaks.push(`${k} is the real home`);
  for (const k of Object.keys(env)) if (/API_KEY|_TOKEN$|SECRET/i.test(k)) leaks.push(`${k} is set`);
  if (!env.SEQUENCE_USER_DIR) leaks.push('SEQUENCE_USER_DIR is not set');
  return leaks;
}

/* ── fixtures ────────────────────────────────────────────────────────────── */

/** A synthetic TypeScript repo of `files` modules in folders of 100, each importing the one before it. */
export function writeSynthRepo(root, files = 3000) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'synthetic-3k', version: '0.0.0', private: true }, null, 2));
  fs.writeFileSync(path.join(root, 'README.md'), `# synthetic\n\n${files} generated modules for the release smoke.\n`);
  for (let i = 0; i < files; i++) {
    const dir = path.join(root, 'src', `pkg${String(Math.floor(i / 100)).padStart(2, '0')}`);
    if (i % 100 === 0) fs.mkdirSync(dir, { recursive: true });
    const prev = i === 0 ? null : i - 1;
    const prevDir = prev === null ? null : `pkg${String(Math.floor(prev / 100)).padStart(2, '0')}`;
    const imp = prev === null ? '' : `import { m${prev} } from '../${prevDir}/m${prev}';\n`;
    const body = prev === null ? 'return n + 1;' : `return m${prev}(n) + 1;`;
    fs.writeFileSync(path.join(dir, `m${i}.ts`), `${imp}export function m${i}(n: number): number {\n  ${body}\n}\n`);
  }
  return root;
}

const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java)$/;

/**
 * Real code for the scale budgets: every code file under `<packagesDir>/<pkg>/src`, copied to `dest/<pkg>/src`, then
 * topped up with synthetic modules to `atLeast` files. A trivial synthetic repo scans in about a second; real code of
 * the same file count is what the audit measured (2.6k nodes, 21 s before the engine listened). Returns the count.
 */
export function writeScaleRepo(dest, packagesDir, atLeast = 3000) {
  let count = 0;
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({ name: 'release-smoke-scale', version: '0.0.0', private: true }, null, 2));
  let pkgs = [];
  try {
    pkgs = fs.readdirSync(packagesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    pkgs = [];
  }
  for (const pkg of pkgs) {
    const src = path.join(packagesDir, pkg, 'src');
    if (!fs.existsSync(src)) continue;
    for (const rel of fs.readdirSync(src, { recursive: true })) {
      const from = path.join(src, String(rel));
      if (!CODE_FILE.test(from) || !fs.statSync(from).isFile()) continue;
      const to = path.join(dest, pkg, 'src', String(rel));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      count += 1;
    }
  }
  if (count < atLeast) {
    writeSynthRepo(path.join(dest, 'synthetic'), atLeast - count);
    count = atLeast;
  }
  return count;
}

/** A small repo to attach: two modules and a README. */
export function writeSmallRepo(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'small-repo', version: '0.0.0', private: true }, null, 2));
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), "import { b } from './b';\nexport const a = () => b() + 1;\n");
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = () => 1;\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# small repo\n');
  return root;
}

/** Process rows -> every descendant of `rootPid` (rows: {pid, ppid, name, created}). */
export function descendants(rows, rootPid) {
  const kids = new Map();
  for (const r of rows) {
    if (!kids.has(r.ppid)) kids.set(r.ppid, []);
    kids.get(r.ppid).push(r);
  }
  const out = [];
  const stack = [rootPid];
  const seen = new Set([rootPid]);
  while (stack.length) {
    const p = stack.pop();
    for (const c of kids.get(p) ?? []) {
      if (seen.has(c.pid)) continue;
      seen.add(c.pid);
      out.push(c);
      stack.push(c.pid);
    }
  }
  return out;
}
