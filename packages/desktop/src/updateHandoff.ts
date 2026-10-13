import { execFile, spawn } from 'node:child_process';
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SIGNING_PUBLIC_KEY } from './signingKey';
import { APPIMAGE_SWAP_SCRIPT, MAC_SWAP_SCRIPT, PORTABLE_HELPER_SCRIPT } from './updateScripts';

/**
 * RUN THE UPDATE THE SERVER LEFT, AFTER THE SERVER IS STOPPED, AND TRUST NOTHING IT CANNOT ANCHOR.
 *
 * The server verifies an update and writes `<userDir>/updates/handoff.json`. It cannot start the installer itself: on quit
 * this app ends the server's whole process tree (server-control.ts), so anything the server started dies with it. Main is
 * not in that tree, so main runs it in `will-quit`.
 *
 * The file is only a REQUEST: kind, version, the release asset's name and the path of the file the server staged. Main
 * re-derives everything else from what it already knows:
 *   - the version must be newer than the running app, and the request younger than 24 h;
 *   - the staged file must sit in `<userDir>/updates` and must hash to the line for its asset in SHASUMS256.txt, which MAIN
 *     downloads over HTTPS from the fixed release URL for that version (if it cannot, nothing runs and the request stays
 *     for the next quit);
 *   - every command, argument, script and environment value is built here: NSIS arguments are constant; the helper
 *     scripts are constant text written by main; the app folder, executable and pid are this process's own
 *     (dirname/basename of execPath, pid); the Windows delete list is computed by main as old manifest minus new manifest;
 *     the mac bundle is this app's own; the AppImage target is $APPIMAGE.
 * Anything off is dropped (the request deleted) and logged. Nothing here is run by a test.
 */

export type HandoffKind = 'nsis' | 'portable' | 'mac-swap' | 'appimage-swap';

export interface Handoff {
  v: 2;
  kind: HandoffKind;
  version: string;
  /** The release asset's name, the key in SHASUMS256.txt. */
  asset: string;
  /** nsis, portable, mac-swap: the verified installer or zip in the updates folder. appimage-swap: ignored (main derives it). */
  staged?: string;
  createdAt: number;
}

export const RELEASES_REPO = 'naidx0/sequence-arch-tool';
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const shasumsUrl = (version: string): string => `https://github.com/${RELEASES_REPO}/releases/download/v${version}/SHASUMS256.txt`;

export interface HandoffContext {
  userDir: string;
  platform: string;
  /** The running app's version (four-part allowed). */
  currentVersion: string;
  /** This process: process.execPath, process.pid, process.env.SystemRoot, process.env.APPIMAGE. */
  execPath: string;
  pid: number;
  /** process.arch: the asset must be this CPU's (arm64 vs x64). */
  arch: string;
  systemRoot?: string;
  appImage?: string;
  now?: number;
}

export const handoffFile = (userDir: string): string => path.join(userDir, 'updates', 'handoff.json');

export function readHandoff(userDir: string): Handoff | null {
  try {
    const h = JSON.parse(fs.readFileSync(handoffFile(userDir), 'utf8')) as Handoff;
    return h && typeof h === 'object' ? h : null;
  } catch {
    return null;
  }
}

/** Characters that can break out of a quoted cmd or sh argument, plus control characters. */
const BAD_CHARS = /["%^&|<>\u0000-\u001f]/;
const ASSET_SHAPE: Record<HandoffKind, RegExp> = {
  nsis: /\.exe$/i,
  portable: /-win\.zip$/i,
  'mac-swap': /-mac\.zip$/i,
  'appimage-swap': /\.AppImage$/i,
};
const KIND_PLATFORM: Record<HandoffKind, string> = { nsis: 'win32', portable: 'win32', 'mac-swap': 'darwin', 'appimage-swap': 'linux' };
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

/** A release version exactly as the server writes it: 3 or 4 numeric parts, no leading zeros, no 'v', no spaces, no suffix. */
export const STRICT_VERSION = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){2,3}$/;

/** The asset is the one for this CPU: an arm64 build only on arm64, the x64 build everywhere else. */
export function archMatches(asset: string, arch: string): boolean {
  const arm = /arm64|aarch64/i.test(asset);
  return arch === 'arm64' ? arm : !arm;
}

/** Look an asset up in SHASUMS256.txt the way the server does (shaFor): GitHub names an asset "Sequence.Setup.0.1.7.exe" and the file lists "Sequence Setup 0.1.7.exe". */
export function shaFor(sums: ReadonlyMap<string, string>, asset: string): string | null {
  for (const [name, hex] of sums) if (name === asset) return hex;
  for (const [name, hex] of sums) if (name.replace(/ /g, '.') === asset) return hex;
  return null;
}

/** True when `sigB64` is an ed25519 signature of exactly `data` by `publicKeyPem` (the analyzer's verifySignature). Never throws. */
export function verifySignature(data: Buffer, sigB64: string, publicKeyPem: string): boolean {
  try {
    const t = sigB64.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return false;
    const sig = Buffer.from(t, 'base64');
    if (sig.length !== 64) return false;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return cryptoVerify(null, data, key, sig);
  } catch {
    return false;
  }
}

/** Version order with an optional fourth part (0.1.7.1 is newer than 0.1.7). null when either is not a version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parse = (v: string): number[] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0)] : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 4; i += 1) if (x[i] !== y[i]) return x[i]! > y[i]! ? 1 : -1;
  return 0;
}

/** "<64 hex>  <name>" lines (a leading * marks binary mode). */
export function parseShasums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})[ \t]+\*?(.+?)\s*$/i.exec(line);
    if (m) out.set(m[2]!, m[1]!.toLowerCase());
  }
  return out;
}

/**
 * A file name or relative path that may be handed to `del` as a plain file: relative, no empty, `.` or `..` segment, no
 * wildcard, no drive or stream colon, no characters that break a quote, no Windows device name, no trailing dot or space.
 */
export function plainRelativeFile(p: string): boolean {
  if (p === '' || BAD_CHARS.test(p) || /[*?]/.test(p) || p.includes(':') || /^[\\/]/.test(p)) return false;
  const parts = p.split(/[\\/]/);
  return parts.every((s) => s !== '' && s !== '.' && s !== '..' && !WINDOWS_RESERVED.test(s) && !/[. ]$/.test(s));
}

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
const MANIFEST = 'app-manifest.json';

export function readManifestFile(dir: string): string[] | null {
  try {
    return parseManifest(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
  } catch {
    return null;
  }
}

export function parseManifest(text: string): string[] | null {
  try {
    const m = JSON.parse(text) as { v?: unknown; files?: unknown };
    return m && m.v === 1 && Array.isArray(m.files) && m.files.every((f) => typeof f === 'string') ? (m.files as string[]) : null;
  } catch {
    return null;
  }
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk('');
  return out;
}

/** Entries of the OLD manifest that the NEW one lacks and that are safe to hand to `del`: the only files an update removes. */
export function deleteList(oldFiles: readonly string[], newFiles: readonly string[]): string[] {
  const keep = new Set(newFiles.map(norm));
  keep.add(norm(MANIFEST));
  /* A name that is a file in the old version and a folder in the new one ("locales" and "locales/en.pak") is not deleted. */
  const dirs = new Set<string>();
  for (const f of newFiles) {
    const parts = norm(f).split('/');
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
  }
  return oldFiles.filter((f) => !keep.has(norm(f)) && !dirs.has(norm(f)) && plainRelativeFile(f));
}

/** On disk, a delete-list entry must be a regular file reached through no link: not a folder, a symlink, a junction or a reparse point. */
export function isPlainFileOnDisk(appDir: string, rel: string): boolean {
  try {
    let at = appDir;
    const parts = rel.split(/[\\/]/);
    for (let i = 0; i < parts.length; i += 1) {
      at = path.join(at, parts[i]!);
      const st = fs.lstatSync(at);
      if (st.isSymbolicLink()) return false;
      if (i < parts.length - 1 ? !st.isDirectory() : !st.isFile()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface LaunchDeps {
  spawnFn?: typeof spawn;
  /** Download text over HTTPS (default: Electron's net.fetch, which follows the system proxy and PAC). Rejects when unreachable. */
  fetchText?: (url: string) => Promise<string>;
  hashFile?: (f: string) => Promise<string>;
  /** The new version's app-manifest.json, read out of the verified zip (default: System32 tar -xOf). null when absent. */
  manifestFromZip?: (zip: string) => Promise<string[] | null>;
  /** The pinned signing key (default: signingKey.ts). null: no signature is checked. */
  signingKey?: string | null;
  log?: (line: string) => void;
}

const hashFile = (f: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    fs.createReadStream(f).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });

/** Windows 10+ ships bsdtar in System32; `-xOf zip member` writes one member to stdout. */
function manifestFromZipWith(systemRoot: string): (zip: string) => Promise<string[] | null> {
  return (zip) =>
    new Promise((resolve) => {
      execFile(path.join(systemRoot, 'System32', 'tar.exe'), ['-xOf', zip, MANIFEST], { windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (e, out) => resolve(e ? null : parseManifest(out)));
    });
}

export interface Outcome {
  launched: boolean;
  reason?: string;
  /** The request was left in place to be tried again at the next quit (the network was unreachable). */
  kept?: boolean;
}

/**
 * Read, vet and start the pending update. Never throws. A request that fails a check is deleted; one that only could not
 * be checked (SHASUMS256.txt unreachable) is kept. The request is deleted before anything is started, so it cannot run twice.
 */
export async function launchPendingUpdate(ctx: HandoffContext, deps: LaunchDeps = {}): Promise<Outcome> {
  const log = deps.log ?? (() => undefined);
  const h = readHandoff(ctx.userDir);
  if (!h) return { launched: false };
  const drop = (reason: string): Outcome => {
    try {
      fs.rmSync(handoffFile(ctx.userDir), { force: true });
    } catch {
      /* nothing more to do */
    }
    log(`update-handoff refused: ${reason}`);
    return { launched: false, reason };
  };
  try {
    return await vet(ctx, deps, h, drop, log);
  } catch (e) {
    return drop(`unexpected error: ${(e as Error).message}`);
  }
}

async function vet(ctx: HandoffContext, deps: LaunchDeps, h: Handoff, drop: (r: string) => Outcome, log: (l: string) => void): Promise<Outcome> {
  const now = ctx.now ?? Date.now();
  if (h.v !== 2 || !(h.kind in KIND_PLATFORM)) return drop('not a handoff this build understands');
  if (KIND_PLATFORM[h.kind] !== ctx.platform) return drop(`${h.kind} does not apply on ${ctx.platform}`);
  if (typeof h.createdAt !== 'number' || now - h.createdAt > MAX_AGE_MS || h.createdAt - now > 5 * 60_000) return drop('the request is older than 24 hours');
  if (typeof h.version !== 'string' || !STRICT_VERSION.test(h.version)) return drop('the version is not a plain release version');
  if (compareVersions(h.version, ctx.currentVersion) !== 1) return drop(`version ${h.version} is not newer than the running ${ctx.currentVersion}`);
  if (typeof h.asset !== 'string' || !/^[A-Za-z0-9._ ()+-]{1,200}$/.test(h.asset) || !ASSET_SHAPE[h.kind].test(h.asset)) return drop('the asset name does not fit this kind');
  if (!archMatches(h.asset, ctx.arch)) return drop(`the asset ${h.asset} is not for this CPU (${ctx.arch})`);

  const updates = path.resolve(ctx.userDir, 'updates');
  const win = process.platform === 'win32';
  const lc = (x: string): string => (win ? x.toLowerCase() : x);
  const under = (p: string, root: string): boolean => lc(path.resolve(p)).startsWith(lc(root + path.sep));

  /* The updates folder itself must not be a link (a junction would move "inside" to anywhere). */
  let updatesReal: string;
  try {
    const userReal = fs.realpathSync(ctx.userDir);
    updatesReal = fs.realpathSync(updates);
    if (lc(updatesReal) !== lc(path.join(userReal, 'updates'))) return drop('the updates folder is a link to somewhere else');
  } catch {
    return drop('there is no updates folder');
  }

  /* The file to verify: the staged one for nsis, portable and mac; for the AppImage main derives it beside $APPIMAGE. */
  let source: string;
  let appImage = '';
  if (h.kind === 'appimage-swap') {
    appImage = ctx.appImage ?? '';
    if (!path.isAbsolute(appImage) || BAD_CHARS.test(appImage)) return drop('APPIMAGE is not a plain absolute path');
    source = path.join(path.dirname(appImage), `.${path.basename(appImage)}.update-${ctx.pid}`);
  } else {
    if (typeof h.staged !== 'string' || BAD_CHARS.test(h.staged)) return drop('the staged path has characters that are not allowed');
    source = path.resolve(h.staged);
    if (!under(source, updates)) return drop('the staged file is outside the updates folder');
  }
  try {
    const st = fs.lstatSync(source);
    if (!st.isFile() || st.isSymbolicLink()) return drop('the staged file is not a plain file');
    const real = fs.realpathSync(source);
    if (h.kind !== 'appimage-swap' && !under(real, updatesReal)) return drop('the staged file resolves outside the updates folder');
  } catch {
    return drop('the staged file is not there');
  }

  /* The anchor: SHASUMS256.txt, fetched by main from the fixed release URL (and, when a key is pinned, its signature). */
  const fetchText = deps.fetchText ?? defaultFetchText;
  const key = deps.signingKey === undefined ? SIGNING_PUBLIC_KEY : deps.signingKey;
  let sums: Map<string, string>;
  try {
    const text = await fetchText(shasumsUrl(h.version));
    if (key) {
      const sig = await fetchText(`${shasumsUrl(h.version)}.sig`);
      if (!verifySignature(Buffer.from(text, 'utf8'), sig, key)) return drop('SHASUMS256.txt does not carry a valid signature by the release key');
    }
    sums = parseShasums(text);
  } catch (e) {
    log(`update-handoff kept: could not read SHASUMS256.txt (${(e as Error).message})`);
    return { launched: false, kept: true, reason: 'SHASUMS256.txt could not be fetched' };
  }
  const want = shaFor(sums, h.asset);
  if (!want) return drop(`SHASUMS256.txt for ${h.version} does not list ${h.asset}`);

  /* TOCTOU: hash the bytes of a PRIVATE copy main made, and run only that copy. The staged file is never read again. */
  sweepVetted(updates);
  const ext = h.kind === 'nsis' ? '.exe' : h.kind === 'appimage-swap' ? '' : '.zip';
  const vettedDir = h.kind === 'appimage-swap' ? path.dirname(appImage) : updates;
  const file = path.join(vettedDir, `.vetted-${ctx.pid}-${randomBytes(6).toString('hex')}${ext}`);
  let got: string;
  try {
    got = await copyExclusive(source, file);
  } catch (e) {
    return drop(`could not copy the staged file privately (${(e as Error).message})`);
  }
  if (got !== want) {
    fs.rmSync(file, { force: true });
    return drop('the staged file does not match SHASUMS256.txt');
  }
  if (h.kind === 'appimage-swap') fs.chmodSync(file, 0o755);

  const spawnFn = deps.spawnFn ?? spawn;
  const start = (cmd: string, args: string[], opts: { env?: Record<string, string>; verbatim?: boolean } = {}): Outcome => {
    /* Removed first: a crash or a second call can never run it twice. */
    fs.rmSync(handoffFile(ctx.userDir), { force: true });
    const child = spawnFn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, ...(opts.env ?? {}) },
      ...(opts.verbatim ? { windowsVerbatimArguments: true } : {}),
    });
    child.on('error', (e) => log(`update-handoff start error: ${e.message}`));
    child.unref();
    log(`update-handoff started ${h.kind} ${h.version}`);
    return { launched: true };
  };
  const refuse = (why: string): Outcome => {
    fs.rmSync(file, { force: true });
    return drop(why);
  };
  const writeScript = (name: string, text: string, mode?: number): string => {
    const f = path.join(updates, name);
    fs.rmSync(f, { force: true });
    fs.writeFileSync(f, text, mode === undefined ? undefined : { mode });
    return f;
  };

  switch (h.kind) {
    case 'nsis': {
      /* The silent, per-user installer (the private copy); it closes this app if it is still running and starts the new version. */
      return start(file, ['/S', '--force-run']);
    }
    case 'portable': {
      const appDir = path.win32.dirname(ctx.execPath);
      const exe = path.win32.basename(ctx.execPath);
      const sysRoot = ctx.systemRoot ?? '';
      if (!/^[A-Za-z]:\\/.test(sysRoot) || BAD_CHARS.test(sysRoot)) return refuse('SystemRoot is not a plain path');
      if (BAD_CHARS.test(appDir) || BAD_CHARS.test(file) || BAD_CHARS.test(updates) || !/^[\w .()+-]+\.exe$/i.test(exe)) return refuse('the app or updates path has characters that are not allowed');
      const old = readManifestFile(appDir);
      if (!old) return refuse('this folder has no app-manifest.json, so it is not updated in place');
      const known = new Set(old.map(norm));
      known.add(norm(MANIFEST));
      const extra = listFiles(appDir).filter((f) => !known.has(norm(f)));
      if (extra.length) return refuse(`the app folder holds files that are not Sequence's (${extra.slice(0, 3).join(', ')})`);
      const next = await (deps.manifestFromZip ?? manifestFromZipWith(sysRoot))(file);
      if (!next) return refuse('the new zip has no app-manifest.json');
      const dels = deleteList(old, next).filter((d) => isPlainFileOnDisk(appDir, d));
      const listFile = writeScript(`delete-list-${ctx.pid}.txt`, dels.map((d) => d.replace(/\//g, '\\')).join('\r\n') + (dels.length ? '\r\n' : ''));
      const script = writeScript(`sequence-update-${ctx.pid}.cmd`, PORTABLE_HELPER_SCRIPT);
      if (BAD_CHARS.test(script) || BAD_CHARS.test(listFile)) return refuse('the helper path has characters that are not allowed');
      return start(path.win32.join(sysRoot, 'System32', 'cmd.exe'), ['/d', '/v:off', '/s', '/c', `""${script}""`], {
        verbatim: true,
        env: { SEQ_PID: String(ctx.pid), SEQ_ZIP: file, SEQ_STAGE: path.join(updates, `stage-win-${ctx.pid}`), SEQ_APP: appDir, SEQ_EXE: exe, SEQ_DELETE: listFile },
      });
    }
    case 'mac-swap': {
      const m = /^(.*?\.app)(?:\/|$)/.exec(ctx.execPath.replace(/\\/g, '/'));
      if (!m) return refuse('this process is not inside an .app bundle');
      const bundle = m[1]!;
      const tmp = path.posix.join(path.posix.dirname(bundle), `.${path.posix.basename(bundle, '.app')}-update-${ctx.pid}`);
      const script = writeScript('apply-update.sh', MAC_SWAP_SCRIPT, 0o755);
      return start('/bin/sh', [script, String(ctx.pid), file, bundle, tmp]);
    }
    case 'appimage-swap': {
      const script = writeScript('appimage-swap.sh', APPIMAGE_SWAP_SCRIPT, 0o755);
      return start('/bin/sh', [script, String(ctx.pid), file, appImage]);
    }
  }
}

/** Copy `src` to `dest`, creating `dest` exclusively (it must not exist), and return the sha256 of the bytes that were copied. */
function copyExclusive(src: string, dest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const out = fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 });
    const inp = fs.createReadStream(src);
    const fail = (e: Error): void => {
      inp.destroy();
      out.destroy();
      fs.rmSync(dest, { force: true });
      reject(e);
    };
    inp.on('data', (d) => h.update(d));
    inp.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => resolve(h.digest('hex')));
    inp.pipe(out);
  });
}

/** Private copies from earlier quits (an installer cannot delete itself) are removed once they are an hour old. */
function sweepVetted(dir: string): void {
  try {
    for (const n of fs.readdirSync(dir)) {
      if (!n.startsWith('.vetted-')) continue;
      const f = path.join(dir, n);
      if (Date.now() - fs.statSync(f).mtimeMs > 3600_000) fs.rmSync(f, { force: true });
    }
  } catch {
    /* housekeeping only */
  }
}

/**
 * The quit hook, registered only in the first instance: a second launch (which hands over to the running app and quits) must
 * not run an update that belongs to the first. `run` does the vetting and the start; the quit waits for it, at most `capMs`.
 */
export interface QuitHost {
  on(event: 'will-quit', listener: (event: { preventDefault(): void }) => void): unknown;
  quit(): void;
}
export function registerUpdateOnQuit(app: QuitHost, o: { firstInstance: boolean; smoke: boolean; run: () => Promise<unknown>; capMs?: number }): boolean {
  if (!o.firstInstance || o.smoke) return false;
  let state: 'idle' | 'running' | 'done' = 'idle';
  app.on('will-quit', (event) => {
    if (state === 'done') return;
    event.preventDefault();
    if (state === 'running') return;
    state = 'running';
    const finish = (): void => {
      if (state === 'done') return;
      state = 'done';
      app.quit();
    };
    const cap = setTimeout(finish, o.capMs ?? 20_000);
    void o.run().catch(() => undefined).finally(() => {
      clearTimeout(cap);
      finish();
    });
  });
  return true;
}

/** Electron's network stack: it uses the system proxy settings and PAC, like the rest of the app. */
async function defaultFetchText(url: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { net } = require('electron') as typeof import('electron');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await net.fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
