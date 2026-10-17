/**
 * REA's Windows native addon, taken from the published npm package.
 *
 * A source build of REA has no Windows native controls: they are built on Linux with MinGW and ship only inside the npm
 * package `rea-agents`. Without them the static JavaScript/Electron analysis and the other provider-backed tools answer
 * `capability_unavailable`. This step downloads that one package tarball and copies exactly two files out of it.
 *
 *   1. GET <registry>/rea-agents/6.5.0       metadata only: the tarball address and its `dist.integrity` (sha512)
 *   2. GET the tarball (same origin as the registry), into a scratch folder
 *   3. sha512 of the bytes must equal `dist.integrity`, before anything is extracted
 *   4. the system `tar -tzf` lists the entries; any absolute, drive-lettered or `..` entry refuses the whole tarball
 *   5. the system `tar -xzf` extracts the two named members only, into a scratch folder
 *   6. each must be a plain file inside that folder; its sha256 is recorded; it is copied into the install
 *
 * No package script is run, and the package is never installed with npm: it is read as an archive. Everything external
 * (tar, the registry) is injected, so the tests drive this against a local HTTP server with a tarball built in the test.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Runner } from './reaInstall.js';

export interface AddonSpec {
  package: string;
  version: string;
  /** Registry base URL, no trailing slash. The tarball must be served from the same origin. */
  registry: string;
  /** The members to take, relative to the package root. Nothing else is extracted. */
  files: readonly string[];
  platform: NodeJS.Platform;
  /** Measured size of the tarball, in megabytes, for the plan. */
  downloadMb: number;
}

export const REA_ADDON: AddonSpec = {
  package: 'rea-agents',
  version: '6.5.0',
  registry: 'https://registry.npmjs.org',
  files: ['native/windows/build/manifest.json', 'native/windows/build/rea-windows-x64.node'],
  platform: 'win32',
  downloadMb: 6,
};

export interface AddonRecord {
  package: string;
  version: string;
  integrity: string;
  tarball: string;
  files: { path: string; sha256: string }[];
}

export type AddonResult = { ok: true; record: AddonRecord } | { ok: false; error: string };

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

const MAX_TARBALL_BYTES = 64 * 1024 * 1024;

export interface AddonMeta {
  tarball: string;
  integrity: string;
}

/** The plan's view of the addon: what is downloaded from where. The integrity is read from the registry only at Start. */
export function addonPlan(spec: AddonSpec): { package: string; version: string; source: string; files: readonly string[]; downloadMb: number } {
  return { package: spec.package, version: spec.version, source: `${spec.registry}/${spec.package}/${spec.version}`, files: spec.files, downloadMb: spec.downloadMb };
}

/** Registry metadata for one version: where the tarball is and the sha512 its bytes must have. */
export async function fetchAddonMeta(spec: AddonSpec, fetchFn: FetchLike): Promise<{ ok: true; meta: AddonMeta } | { ok: false; error: string }> {
  const url = `${spec.registry}/${spec.package}/${spec.version}`;
  let body: unknown;
  try {
    const res = await fetchFn(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, error: `The npm registry answered ${res.status} for ${spec.package}@${spec.version}.` };
    body = await res.json();
  } catch (e) {
    return { ok: false, error: `Could not reach the npm registry at ${spec.registry}: ${(e as Error).message}` };
  }
  const dist = (body as { dist?: { tarball?: unknown; integrity?: unknown } } | null)?.dist;
  if (!dist || typeof dist.tarball !== 'string' || typeof dist.integrity !== 'string') return { ok: false, error: `The registry's record for ${spec.package}@${spec.version} has no tarball address or integrity value.` };
  if (!/(^|\s)sha512-[A-Za-z0-9+/]+=*(\s|$)/.test(dist.integrity)) return { ok: false, error: `The registry gave no sha512 integrity for ${spec.package}@${spec.version}, so the download cannot be checked.` };
  let sameOrigin = false;
  try {
    sameOrigin = new URL(dist.tarball).origin === new URL(spec.registry).origin;
  } catch {
    /* not a URL */
  }
  if (!sameOrigin) return { ok: false, error: `The registry pointed at a tarball outside ${spec.registry}. Nothing was downloaded.` };
  return { ok: true, meta: { tarball: dist.tarball, integrity: dist.integrity } };
}

/** True when the bytes match one of the sha512 values in an SRI string. */
export function integrityMatches(bytes: Uint8Array, integrity: string): boolean {
  const actual = crypto.createHash('sha512').update(bytes).digest('base64');
  return integrity
    .split(/\s+/)
    .filter((t) => t.startsWith('sha512-'))
    .some((t) => t.slice('sha512-'.length).split('?')[0] === actual);
}

/** Why a tar entry name must not be extracted, or null when it is a plain relative path. */
export function unsafeTarEntry(name: string): string | null {
  if (name === '') return 'an empty name';
  if (name.includes('\0')) return 'a NUL in the name';
  if (/^[\\/]/.test(name)) return 'an absolute path';
  if (/^[A-Za-z]:/.test(name)) return 'a drive-lettered path';
  if (name.split(/[\\/]+/).includes('..')) return 'a ".." path';
  return null;
}

/** The system tar: on Windows the one Windows ships, ahead of any other tar on PATH. */
export function systemTar(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') {
    const p = path.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(p)) return p;
  }
  return 'tar';
}

const sha256File = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tail = (s: string, n = 600): string => (s.length > n ? s.slice(s.length - n) : s);

/**
 * Download, verify and take the addon's files into `targetDir`. Never throws. `scratchDir` is created here and removed
 * on return; the caller owns `targetDir`.
 */
export async function installAddon(opts: {
  spec: AddonSpec;
  targetDir: string;
  scratchDir: string;
  run: Runner;
  env: NodeJS.ProcessEnv;
  fetchFn?: FetchLike;
  onDetail?: (detail: string) => void;
}): Promise<AddonResult> {
  const { spec, targetDir, scratchDir, run, env } = opts;
  const fetchFn: FetchLike = opts.fetchFn ?? ((u, i) => fetch(u, i as RequestInit) as unknown as ReturnType<FetchLike>);
  const label = `${spec.package}@${spec.version}`;
  const extractDir = path.join(scratchDir, 'extract');
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });

    opts.onDetail?.(`Asking the npm registry about ${label}`);
    const meta = await fetchAddonMeta(spec, fetchFn);
    if (!meta.ok) return meta;

    opts.onDetail?.(`Downloading ${label}`);
    let bytes: Uint8Array;
    try {
      const res = await fetchFn(meta.meta.tarball);
      if (!res.ok) return { ok: false, error: `The npm registry answered ${res.status} for the ${label} download.` };
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      return { ok: false, error: `The ${label} download failed: ${(e as Error).message}` };
    }
    if (bytes.length === 0 || bytes.length > MAX_TARBALL_BYTES) return { ok: false, error: `The ${label} download was ${bytes.length} bytes, outside what is expected. Nothing was installed.` };

    if (!integrityMatches(bytes, meta.meta.integrity)) {
      return { ok: false, error: `The ${label} download does not match the integrity value npm published for it, so it was thrown away unopened.` };
    }
    const tgz = path.join(scratchDir, 'package.tgz');
    fs.writeFileSync(tgz, bytes);

    const tar = systemTar(process.platform, env);
    const listing = await run(tar, ['-tzf', 'package.tgz'], { cwd: scratchDir, env, timeoutMs: 60_000 });
    if (listing.code !== 0) return { ok: false, error: `Could not list the ${label} archive (tar exit ${listing.code ?? 'none'}): ${tail(listing.stderr)}` };
    const entries = listing.stdout.split(/\r?\n/).filter((l) => l !== '');
    for (const e of entries) {
      const why = unsafeTarEntry(e);
      if (why) return { ok: false, error: `The ${label} archive contains ${why} ("${e.slice(0, 120)}"). It was refused and nothing was extracted.` };
    }
    const members = spec.files.map((f) => `package/${f}`);
    const missing = members.filter((m) => !entries.includes(m));
    if (missing.length) return { ok: false, error: `The ${label} archive does not contain ${missing.join(', ')}.` };

    const ex = await run(tar, ['-xzf', 'package.tgz', '-C', extractDir.replace(/\\/g, '/'), ...members], { cwd: scratchDir, env, timeoutMs: 60_000 });
    if (ex.code !== 0) return { ok: false, error: `Could not extract from the ${label} archive (tar exit ${ex.code ?? 'none'}): ${tail(ex.stderr)}` };

    const realExtract = fs.realpathSync(extractDir);
    const files: AddonRecord['files'] = [];
    for (const rel of spec.files) {
      const src = path.join(extractDir, 'package', ...rel.split('/'));
      const st = fs.lstatSync(src, { throwIfNoEntry: false });
      if (!st || !st.isFile() || st.isSymbolicLink()) return { ok: false, error: `${rel} in the ${label} archive is not a plain file. Nothing was installed.` };
      const real = fs.realpathSync(src);
      if (!real.startsWith(realExtract + path.sep)) return { ok: false, error: `${rel} resolved outside the extraction folder. Nothing was installed.` };
      files.push({ path: rel, sha256: sha256File(src) });
    }
    for (const rel of spec.files) {
      const dest = path.join(targetDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(extractDir, 'package', ...rel.split('/')), dest);
    }
    return { ok: true, record: { package: spec.package, version: spec.version, integrity: meta.meta.integrity, tarball: meta.meta.tarball, files } };
  } catch (e) {
    return { ok: false, error: `Adding the Windows native files failed: ${(e as Error).message}` };
  } finally {
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows: stale scratch folders are cleared by the next install */
    }
  }
}
