/**
 * ONE-CLICK INSTALL FOR AGENTS THAT SHIP AS AN ARCHIVE (OpenCode, goose, Kimi, Mistral Vibe).
 *
 * The npx agents run with nothing to install; these could only say "Get it" and send the person
 * to a website. The ACP registry gives each one a per-platform archive URL and its sha256, so the
 * install is: download the archive for this machine (https only, size-capped), hash it while it
 * downloads, refuse it unless the hash matches the registry's, unpack it with the system's own
 * `tar` into `<user store>/agents-bin/<id>/<version>/`, check the agent's executable is inside that
 * folder, and write `installed.json`. The catalog then starts it from there (agentCatalog.ts
 * readInstalled). Nothing is put on PATH and nothing outside that folder is touched.
 *
 * Only on a person's click (POST /api/acp/catalog/install). An archive with no checksum in the
 * registry is refused, not trusted: Cursor's entry has none, so Cursor keeps "Get it".
 */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { installableBinary, platformKey, type CatalogAgent } from './agentCatalog.js';
import { writeUserJson } from './store.js';

/** The largest archive accepted. OpenCode's Windows zip is ~40 MB; this leaves room and stops a runaway. */
export const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;

export interface InstallJob {
  id: string;
  version: string;
  state: 'downloading' | 'unpacking' | 'done' | 'failed';
  receivedBytes: number;
  totalBytes: number | null;
  error?: string;
}

export interface InstallOptions {
  /** `<user store>/agents-bin`. */
  installRoot: string;
  plat?: string;
  fetchImpl?: typeof fetch;
  /** The unpacker: `tar` that reads zip, tar.gz and tar.bz2 (Windows' own bsdtar does all three). */
  tarCommand?: string;
  onProgress?: (job: InstallJob) => void;
}

/** Windows ships bsdtar in System32, which unpacks zip as well; elsewhere the `tar` on PATH, and `unzip` for a zip. */
export function defaultTar(): string {
  if (process.platform === 'win32') return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return 'tar';
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let err = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      reject(e as Error);
      return;
    }
    child.stderr?.setEncoding('utf8').on('data', (c: string) => {
      if (err.length < 4000) err += c;
    });
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split('\n').slice(-2).join(' ')}`))));
  });
}

/** `./goose-package\goose.exe` -> the path parts below the install folder, refusing any that climb out. */
export function cmdInside(dir: string, cmd: string): string | null {
  const parts = cmd.split(/[\\/]+/).filter((p) => p !== '' && p !== '.');
  if (parts.length === 0 || parts.some((p) => p === '..')) return null;
  const full = path.join(dir, ...parts);
  const rel = path.relative(dir, full);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : full;
}

/**
 * Download, verify and unpack agent `a` for this machine. Resolves with the finished job;
 * throws with a sentence a person can act on. A failed install leaves no `installed.json`.
 */
export async function installAgentBinary(a: CatalogAgent, opts: InstallOptions): Promise<InstallJob> {
  const plat = opts.plat ?? platformKey();
  const bin = installableBinary(a, plat);
  if (!bin) {
    const any = a.distribution.binary?.[plat];
    throw new Error(any ? `the registry gives no checksum for ${a.name}'s ${plat} download, so Sequence will not install it` : `${a.name} has no download for ${plat}`);
  }
  const version = a.version ?? 'unversioned';
  /* One plain folder name: `..` would make the version folder agents-bin itself, and the cleanup below would empty it. */
  if (!/^[\w.+-]{1,40}$/.test(version) || /^\.+$/.test(version)) throw new Error(`unusable version '${version}'`);
  const job: InstallJob = { id: a.id, version, state: 'downloading', receivedBytes: 0, totalBytes: null };
  const tell = (): void => opts.onProgress?.({ ...job });
  const agentDir = path.join(opts.installRoot, a.id);
  const dir = path.join(agentDir, version);
  /* Unpacked here first and swapped in only once it checks out, so a failed reinstall never touches the live folder. */
  const tag = `${process.pid}-${Date.now().toString(36)}`;
  const staging = path.join(agentDir, `.${version}.new-${tag}`);
  const parked = path.join(agentDir, `.${version}.old-${tag}`);
  let swapped = false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `seq-agent-${a.id}-`));
  const name = (new URL(bin.archive).pathname.split('/').pop() ?? '').replace(/[^\w.-]/g, '_') || 'archive';
  const file = path.join(tmp, name);
  try {
    const res = await (opts.fetchImpl ?? fetch)(bin.archive, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    job.totalBytes = Number.isFinite(len) && len > 0 ? len : null;
    if (job.totalBytes !== null && job.totalBytes > MAX_ARCHIVE_BYTES) throw new Error(`the download is ${Math.round(job.totalBytes / 1e6)} MB, over the ${MAX_ARCHIVE_BYTES / 1e6} MB limit`);
    const hash = createHash('sha256');
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        job.receivedBytes += chunk.byteLength;
        if (job.receivedBytes > MAX_ARCHIVE_BYTES) return cb(new Error(`the download passed the ${MAX_ARCHIVE_BYTES / 1e6} MB limit`));
        hash.update(chunk);
        tell();
        cb(null, chunk);
      },
    });
    /* pipeline carries a write error (EISDIR, ENOSPC, an antivirus lock) into this await instead of an uncaught event. */
    await pipeline(Readable.fromWeb(res.body as never), counter, fs.createWriteStream(file));
    const got = hash.digest('hex');
    if (got !== bin.sha256.toLowerCase()) throw new Error(`the download does not match the registry's checksum (expected ${bin.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…), so it was not installed`);
    job.state = 'unpacking';
    tell();
    fs.mkdirSync(staging, { recursive: true });
    const tar = opts.tarCommand ?? defaultTar();
    if (/\.zip$/i.test(name) && process.platform !== 'win32' && !opts.tarCommand) await run('unzip', ['-q', '-o', file, '-d', staging]);
    else await run(tar, ['-xf', file, '-C', staging]);
    const staged = cmdInside(staging, bin.cmd);
    if (!staged || !fs.existsSync(staged)) throw new Error(`the archive did not contain ${bin.cmd}`);
    /* A link in the archive could point anywhere; the executable must be a real file inside the folder. */
    const real = path.relative(fs.realpathSync(staging), fs.realpathSync(staged));
    if (!fs.lstatSync(staged).isFile() || real.startsWith('..') || path.isAbsolute(real)) throw new Error(`${bin.cmd} in the archive is a link, which Sequence does not install`);
    if (process.platform !== 'win32') fs.chmodSync(staged, 0o755);
    /* Swap in: park the live folder, move the new one into place, put the old one back if that fails. */
    const hadOld = fs.existsSync(dir);
    if (hadOld) fs.renameSync(dir, parked);
    try {
      fs.renameSync(staging, dir);
    } catch (err) {
      if (hadOld) fs.renameSync(parked, dir);
      throw err;
    }
    swapped = true;
    const exe = cmdInside(dir, bin.cmd)!;
    writeUserJson(agentDir, 'installed.json', { id: a.id, version, command: exe, args: bin.args ?? [], sha256: got });
    /* Older versions go once the new one is in place; best effort, so a locked old file never undoes the install. */
    for (const old of fs.readdirSync(agentDir)) {
      if (old === version || old === 'installed.json') continue;
      try {
        fs.rmSync(path.join(agentDir, old), { recursive: true, force: true });
      } catch {
        /* in use (Windows): it goes on the next install */
      }
    }
    job.state = 'done';
    tell();
    return job;
  } catch (e) {
    /* Put the previous version back if the new one was already in place; no cleanup error may hide the first one. */
    try {
      if (swapped) {
        fs.rmSync(dir, { recursive: true, force: true });
        if (fs.existsSync(parked)) fs.renameSync(parked, dir);
      }
    } catch {
      /* the first error is the one worth reporting */
    }
    throw e;
  } finally {
    for (const d of [staging, tmp]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* a locked leftover goes with the next install */
      }
    }
    try {
      if (fs.existsSync(parked) && fs.existsSync(dir)) fs.rmSync(parked, { recursive: true, force: true });
    } catch {
      /* in use (Windows) */
    }
  }
}
