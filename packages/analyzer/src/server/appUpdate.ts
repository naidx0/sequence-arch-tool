/**
 * THE APP'S VERSION, THE UPDATE CHECK, AND THE INSTALLER (G7, 0.1.5).
 *
 * What it does, and the only network it uses:
 *   - reports the running version and build (version from the desktop shell or
 *     package.json, commit from build-info.json or git);
 *   - asks GitHub's public API for the latest release of naidx0/sequence-arch-tool
 *     (https://api.github.com, no token), caches the answer for a day, and fails
 *     SILENTLY when offline: an unreachable GitHub is "no news", never an error;
 *   - on the person's click only, reads the release from GitHub again (never a
 *     cache file), downloads the installer for this OS from it, checks its SHA-256
 *     against the release's SHASUMS256.txt, and only then runs it. A download that
 *     does not match is deleted and nothing is run.
 *
 * No model call, no other host. Every download's first hop is exactly
 * https://github.com/naidx0/sequence-arch-tool/releases/download/<tag>/<file>
 * (isReleaseDownloadUrl); a redirect may go only to github.com or the two release
 * CDNs, objects.githubusercontent.com and release-assets.githubusercontent.com.
 */

import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { proxyAwareFetch } from './proxyFetch.js';
import { debHowto, linuxInstallKind, stageAppImage, type LinuxKind } from './update/linuxInstall.js';
import { clearHandoff, readHandoff, writeHandoff, type Handoff } from './update/handoff.js';
import { checkPortable } from './update/portableUpdate.js';
import { installKind, type InstallKind } from './update/winInstall.js';
import { ChecksumMismatch, downloadZip, type Net } from './update/differential.js';
import { appBundleFromExecPath, canSwapInPlace, clearZipCache, extractZip, makeTempBeside, promoteZipCache, readZipCache, recordHandoff, sweepLeftovers, writePendingZip, type HandoffArgs } from './update/macInstall.js';

export const RELEASES_REPO = 'naidx0/sequence-arch-tool';
export const LATEST_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
export const SHASUMS_NAME = 'SHASUMS256.txt';
export const DAY_MS = 24 * 60 * 60 * 1000;
/** After a failed check (offline), the next try waits this long, not a day. */
export const RETRY_MS = 30 * 60 * 1000;
const MAX_BYTES = 1_500_000_000;
const MAX_REDIRECTS = 5;
/** A download that receives nothing for this long is given up (and can be started again). */
export const IDLE_MS = 60_000;

/* ── versions ───────────────────────────────────────────────────────────── */

interface Parsed {
  /** major, minor, patch, then an optional fourth part (0.1.6.1); absent counts as 0. */
  nums: [number, number, number, number];
  pre: string[];
}

function parse(v: string): Parsed | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(v);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? Number(m[4]) : 0], pre: m[5] ? m[5].split('.') : [] };
}

/** -1, 0 or 1 by semantic version, also with a fourth part (0.1.6.1 sits after 0.1.6, before 0.1.7); a leading v is fine; a prerelease is older than its release; null when either is not a version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 4; i++) {
    if (x.nums[i]! !== y.nums[i]!) return x.nums[i]! < y.nums[i]! ? -1 : 1;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn) return -1;
    if (qn) return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/* ── the release and its assets ─────────────────────────────────────────── */

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface LatestRelease {
  tag: string;
  version: string;
  name: string;
  notes: string;
  htmlUrl: string;
  publishedAt: string | null;
  assets: ReleaseAsset[];
}

const canonicalPage = (tag: string): string => `https://github.com/${RELEASES_REPO}/releases/tag/${encodeURIComponent(tag)}`;

/** The release out of GitHub's JSON, or null when it is not a release we can read. */
export function parseRelease(json: unknown): LatestRelease | null {
  if (typeof json !== 'object' || json === null) return null;
  const j = json as Record<string, unknown>;
  const tag = typeof j.tag_name === 'string' ? j.tag_name : '';
  if (!parse(tag)) return null;
  if (j.draft === true || j.prerelease === true) return null;
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(j.assets)) {
    for (const a of j.assets) {
      const r = a as Record<string, unknown>;
      if (typeof r.name === 'string' && typeof r.browser_download_url === 'string') {
        assets.push({ name: r.name, url: r.browser_download_url, size: typeof r.size === 'number' ? r.size : 0 });
      }
    }
  }
  return {
    tag,
    version: tag.replace(/^v/i, ''),
    name: typeof j.name === 'string' && j.name ? j.name : tag,
    notes: typeof j.body === 'string' ? j.body : '',
    htmlUrl: typeof j.html_url === 'string' && isRepoPageUrl(j.html_url) ? j.html_url : canonicalPage(tag),
    publishedAt: typeof j.published_at === 'string' ? j.published_at : null,
    assets,
  };
}

/**
 * The installer for this OS: Windows the NSIS .exe (not the zip), macOS the .dmg for the CPU
 * (arm64 by name; Intel is the one without), Linux the .AppImage. null when the release has none.
 */
export function pickAsset(assets: readonly ReleaseAsset[], platform: string, arch: string, kind: InstallKind | LinuxKind = 'nsis'): ReleaseAsset | null {
  const usable = assets.filter((a) => !/\.blockmap$/i.test(a.name));
  if (platform === 'win32' && kind === 'portable') return usable.find((a) => /-win\.zip$/i.test(a.name)) ?? null;
  if (platform === 'win32') {
    const exes = usable.filter((a) => /\.exe$/i.test(a.name));
    return exes.find((a) => /setup/i.test(a.name)) ?? exes[0] ?? null;
  }
  if (platform === 'darwin') {
    const dmgs = usable.filter((a) => /\.dmg$/i.test(a.name));
    const arm = (a: ReleaseAsset): boolean => /arm64/i.test(a.name);
    if (arch === 'arm64') return dmgs.find(arm) ?? null;
    return dmgs.find((a) => !arm(a)) ?? null;
  }
  if (platform === 'linux' && kind === 'deb') {
    const debs = usable.filter((a) => /\.deb$/i.test(a.name));
    return debs.find((a) => /(amd64|x86_64|x64)/i.test(a.name) && arch !== 'arm64') ?? debs.find((a) => /(arm64|aarch64)/i.test(a.name) && arch === 'arm64') ?? null;
  }
  if (platform === 'linux') {
    const imgs = usable.filter((a) => /\.AppImage$/i.test(a.name));
    const x64 = (a: ReleaseAsset): boolean => /(x86_64|x64|amd64)/i.test(a.name);
    const arm = (a: ReleaseAsset): boolean => /(arm64|aarch64)/i.test(a.name);
    if (arch === 'arm64') return imgs.find(arm) ?? null;
    return imgs.find((a) => !arm(a) && (x64(a) || imgs.length === 1)) ?? imgs.find((a) => !arm(a)) ?? null;
  }
  return null;
}

/**
 * macOS only: the update zip for the CPU (arm64 by name; Intel is the one without) and its `.blockmap`, which
 * electron-builder writes beside every mac zip. Both are offered; the dmg stays the fallback (pickAsset).
 * `blockmap` is null when the release has none. null when there is no zip for this CPU.
 */
export function pickMacUpdate(assets: readonly ReleaseAsset[], arch: string): { zip: ReleaseAsset; blockmap: ReleaseAsset | null } | null {
  const zips = assets.filter((a) => /-mac\.zip$/i.test(a.name));
  const arm = (a: ReleaseAsset): boolean => /arm64/i.test(a.name);
  const zip = arch === 'arm64' ? zips.find(arm) : zips.find((a) => !arm(a));
  if (!zip) return null;
  return { zip, blockmap: assets.find((a) => a.name === `${zip.name}.blockmap`) ?? null };
}

/* ── checksums ──────────────────────────────────────────────────────────── */

/** SHASUMS256.txt: "<64 hex>  <file name>" per line (a leading * marks binary mode). */
export function parseShasums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m) out.set(m[2]!, m[1]!.toLowerCase());
  }
  return out;
}

/**
 * The expected hash for an asset. GitHub stores "Sequence Setup 0.1.4.exe" as "Sequence.Setup.0.1.4.exe",
 * so a space in the LISTED name may stand for a dot in the asset name. Nothing else is loosened: a dot in
 * the list is not a space, and case counts.
 */
export function shaFor(sums: ReadonlyMap<string, string>, assetName: string): string | null {
  for (const [name, hex] of sums) if (name === assetName) return hex;
  for (const [name, hex] of sums) if (name.replace(/ /g, '.') === assetName) return hex;
  return null;
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = fs.createReadStream(file);
    s.on('data', (c) => h.update(c));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/** True when the file's SHA-256 is exactly the expected one. */
export async function verifyChecksum(file: string, expectedHex: string): Promise<{ ok: boolean; actual: string }> {
  const actual = await sha256File(file);
  return { ok: actual === expectedHex.trim().toLowerCase(), actual };
}

/* ── the only hosts ─────────────────────────────────────────────────────── */

/** The two CDN names GitHub redirects a release download to. Not raw., gist. or any other githubusercontent.com name. */
const RELEASE_CDNS = new Set(['objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

function httpsUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  return u;
}

/** https only; GitHub's API and site, and the CDN names it serves release assets from. */
export function isAllowedUrl(raw: string): boolean {
  const u = httpsUrl(raw);
  if (!u) return false;
  const h = u.hostname.toLowerCase();
  return h === 'api.github.com' || h === 'github.com' || RELEASE_CDNS.has(h);
}

/** A redirect hop of a download: github.com or a release CDN (never the API). */
function isDownloadHop(raw: string): boolean {
  const u = httpsUrl(raw);
  return u !== null && (u.hostname === 'github.com' || RELEASE_CDNS.has(u.hostname));
}

/** The first hop of any download: exactly https://github.com/<this repo>/releases/download/<tag>/<one file name>. */
export function isReleaseDownloadUrl(raw: string, tag: string): boolean {
  const u = httpsUrl(raw);
  if (!u || u.hostname !== 'github.com' || u.search || u.hash) return false;
  const prefix = `/${RELEASES_REPO}/releases/download/${encodeURIComponent(tag)}/`;
  if (!u.pathname.startsWith(prefix)) return false;
  const rest = u.pathname.slice(prefix.length);
  return rest.length > 0 && !rest.includes('/');
}

/** A page of this repo on github.com (the release page link the Settings page renders). */
export function isRepoPageUrl(raw: string): boolean {
  const u = httpsUrl(raw);
  return u !== null && u.hostname === 'github.com' && (u.pathname === `/${RELEASES_REPO}` || u.pathname.startsWith(`/${RELEASES_REPO}/`));
}

/* ── signed checksums (ready, off until the owner pins a key; docs/updater-signing.md) ── */

/** The detached signature over SHASUMS256.txt: base64 of a raw 64-byte ed25519 signature. */
export const SIGNATURE_NAME = `${SHASUMS_NAME}.sig`;

/**
 * The release-signing public key (SPKI PEM), pinned in the app. null: signatures are not checked and the
 * SHA-256 against SHASUMS256.txt is the only check, as before. Setting it makes a valid signature REQUIRED.
 * Only the public half ever lives here; the secret half is a GitHub Actions secret.
 */
export const SIGNING_PUBLIC_KEY: string | null = null;

/** True when `sigB64` is an ed25519 signature of exactly `data` by `publicKeyPem`. Never throws. */
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

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; redirect?: 'manual' | 'follow'; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel?(): Promise<void> } } | null;
}>;

/**
 * GET with the host check at every redirect hop. `first` checks the first hop (default isAllowedUrl),
 * `hop` every redirect after it.
 */
async function getAllowed(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  first: (u: string) => boolean = isAllowedUrl,
  hopOk: (u: string) => boolean = isAllowedUrl,
) {
  return (await getAllowedAt(fetchImpl, url, headers, signal, first, hopOk)).res;
}

/** getAllowed, also saying which url the bytes came from (the CDN url after redirects), so range requests can go straight there. */
async function getAllowedAt(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  first: (u: string) => boolean = isAllowedUrl,
  hopOk: (u: string) => boolean = isAllowedUrl,
): Promise<{ res: Awaited<ReturnType<FetchLike>>; finalUrl: string }> {
  let at = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(hop === 0 ? first : hopOk)(at)) throw new Error(`refused: ${hostOf(at)} is not where this release is published`);
    const res = await fetchImpl(at, { headers, redirect: 'manual', ...(signal ? { signal } : {}) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect without a location');
      at = new URL(loc, at).toString();
      continue;
    }
    return { res, finalUrl: at };
  }
  throw new Error('too many redirects');
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname || raw;
  } catch {
    return 'that address';
  }
}

/* ── version info ───────────────────────────────────────────────────────── */

export interface VersionInfo {
  version: string;
  commit: string | null;
  platform: string;
  arch: string;
  /** The desktop shell set the version (an installed app), as against a source checkout. */
  desktop: boolean;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The bundle or checkout root: three levels above dist/server (dist/server -> dist -> packages/analyzer -> packages -> root). */
function rootDirs(): string[] {
  return [path.resolve(HERE, '..', '..', '..', '..'), path.resolve(HERE, '..', '..', '..')];
}

/**
 * The build number from `app-build.json` ({ "build": 1 }, written beside package.json by the release workflow for a
 * four-part release such as 0.1.7.1). Absent, unreadable or not a non-negative integer = 0.
 */
export function readBuildNumber(dirs: readonly string[]): number {
  for (const d of dirs) {
    const b = readJson(path.join(d, 'app-build.json'))?.build;
    if (typeof b === 'number' && Number.isInteger(b) && b >= 0) return b;
  }
  return 0;
}

/** A three-part version with a build number is that version's fourth part (0.1.7 + 1 = 0.1.7.1); anything else is unchanged. */
export function withBuild(version: string, build: number): string {
  return build > 0 && /^\d+\.\d+\.\d+$/.test(version) ? `${version}.${build}` : version;
}

/**
 * Where app-build.json may be: beside the running file, then each level up to the analyzer package root (dist/server -> dist ->
 * packages/analyzer, where the release workflow writes it), then the bundle or checkout roots.
 */
export function defaultBuildDirs(here: string = HERE): string[] {
  return [here, path.resolve(here, '..'), path.resolve(here, '..', '..'), path.resolve(here, '..', '..', '..'), path.resolve(here, '..', '..', '..', '..')];
}

export function readVersionInfo(env: NodeJS.ProcessEnv = process.env, platform = process.platform, arch = process.arch, buildDirs?: readonly string[]): VersionInfo {
  /* dist/server/ (tsc) or dist/ (the one-file server bundle): the analyzer's package.json is one or two levels up. */
  const pkg = readJson(path.resolve(HERE, '..', 'package.json'))?.name === '@sequence/analyzer' ? readJson(path.resolve(HERE, '..', 'package.json')) : readJson(path.resolve(HERE, '..', '..', 'package.json'));
  let info: Record<string, unknown> | null = null;
  for (const r of rootDirs()) {
    info = readJson(path.join(r, 'build-info.json'));
    if (info) break;
  }
  const fromEnv = env.SEQUENCE_APP_VERSION && parse(env.SEQUENCE_APP_VERSION) ? env.SEQUENCE_APP_VERSION : null;
  const base = fromEnv ?? (typeof info?.version === 'string' ? info.version : null) ?? (typeof pkg?.version === 'string' ? pkg.version : '0.0.0');
  const version = withBuild(base, readBuildNumber(buildDirs ?? defaultBuildDirs()));
  let commit: string | null = typeof info?.commit === 'string' && info.commit ? info.commit : null;
  if (!commit && env.SEQUENCE_APP_COMMIT) commit = env.SEQUENCE_APP_COMMIT;
  if (!commit) {
    for (const r of rootDirs()) {
      if (!fs.existsSync(path.join(r, '.git'))) continue;
      try {
        commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: r, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, windowsHide: true }).trim() || null;
      } catch {
        commit = null;
      }
      break;
    }
  }
  return { version, commit, platform, arch, desktop: Boolean(fromEnv) };
}

/* ── the update service ─────────────────────────────────────────────────── */

export interface UpdateCheck {
  current: string;
  /** The latest published release, or null when none was ever read. */
  latest: { version: string; tag: string; name: string; htmlUrl: string; publishedAt: string | null; /** The release's own notes (markdown), for the Settings page to render. Display only. */ notes: string } | null;
  /** The latest is newer than the running version. */
  newer: boolean;
  /** The installer this OS would run, when the release has one and its checksums. */
  asset: { name: string; size: number } | null;
  /** False when the release has no installer for this OS or no SHASUMS256.txt, or this is not the desktop app: nothing is offered. */
  installable: boolean;
  /** A deb install is updated by the package manager: the words saying how (installable is false then), else null. */
  manual: string | null;
  /** This is the installed desktop app; a source checkout or a CLI install updates another way. */
  desktop: boolean;
  checkedAt: number | null;
  /** GitHub could not be reached on the last try (the cached answer, if any, is shown). */
  offline: boolean;
}

export type InstallState = 'idle' | 'downloading' | 'verifying' | 'launching' | 'launched' | 'failed';

export interface InstallJob {
  state: InstallState;
  version: string | null;
  received: number;
  total: number;
  error: string | null;
  /** What the person does to finish, when the installer cannot finish by itself. */
  howto: string | null;
  file: string | null;
  /** macOS zip update: 'differential' fetched only the changed parts, 'full' the whole zip, 'cached' a zip already on disk (nothing fetched); null for any other install. */
  mode: 'differential' | 'full' | 'cached' | null;
  /** Bytes fetched over the network for this update (zip and block map). 0 until known. */
  downloaded: number;
  /** The full size of the update file, to compare `downloaded` with. 0 until known. */
  fullSize: number;
  /** Bytes reused from the installed version's cached copy instead of downloaded. */
  reused: number;
  /** 'in-place': the app replaces itself when Sequence is quit. 'dmg': the disk image is opened (see `fallbackReason`). */
  installMode: 'in-place' | 'dmg' | null;
  /** Why the faster path was not used, in plain words; null when it was (or on other platforms). */
  fallbackReason: string | null;
}

const IDLE_JOB: InstallJob = { state: 'idle', version: null, received: 0, total: 0, error: null, howto: null, file: null, mode: null, downloaded: 0, fullSize: 0, reused: 0, installMode: null, fallbackReason: null };

/** Test seams for the in-place mac install; the real ones run ditto and the swap helper. */
export interface MacInstallDeps {
  /** The running app's .app bundle, or null when it is not in one (default: from process.execPath). */
  bundle?: () => string | null;
  /** Can the process replace that bundle? (default: write access to it and its folder). */
  canSwap?: (bundle: string) => { ok: boolean; reason: string | null };
  extract?: (zip: string, dest: string) => Promise<string>;
  handoff?: (a: HandoffArgs) => Promise<void>;
  /** The pid the helper waits on (default: this process's parent, the desktop shell). */
  pid?: () => number;
  /** Local runs up to this long between two changed runs are fetched along with them (default 64 KiB). */
  mergeGap?: number;
  /** When this process started, ms since the epoch (default: now minus uptime); leftovers older than it are swept. */
  startedAtMs?: number;
}

export interface UpdateDeps {
  fetchImpl?: FetchLike;
  now?: () => number;
  /** Where the cache and the downloaded installer live. */
  userDir: string;
  platform?: string;
  arch?: string;
  current?: () => string;
  /** This is the installed desktop app (VersionInfo.desktop). Only it is offered the installer. */
  desktop?: () => boolean;
  /** Test seams for running the installer. */
  launch?: (file: string, platform: string) => string | Promise<string>;
  /** Give up a download after this long with no data (default IDLE_MS). */
  idleMs?: number;
  /** Give up the release check after this long, body included (default 8000). */
  checkMs?: number;
  /** The pinned release-signing key (default SIGNING_PUBLIC_KEY); null checks no signature. */
  signingKey?: string | null;
  mac?: MacInstallDeps;
  /** Windows: NSIS install or portable zip folder (default: installKind of this process). */
  installKind?: () => InstallKind;
  /** Linux: AppImage, deb or neither (default: from APPIMAGE and process.execPath). */
  linuxKind?: () => LinuxKind;
  /** Linux test seams for the AppImage swap. */
  linux?: LaunchDeps;
  /** Windows test seams for starting the installer or the portable helper. */
  win?: LaunchDeps;
}

interface CacheFile {
  checkedAt: number;
  failedAt?: number;
  release: LatestRelease | null;
}

export class UpdateService {
  private readonly deps: Required<Pick<UpdateDeps, 'now' | 'platform' | 'arch'>> & UpdateDeps;
  private memo: CacheFile | null = null;
  private inflight: Promise<UpdateCheck> | null = null;
  private running: Promise<InstallJob> | null = null;
  private job: InstallJob = { ...IDLE_JOB };
  private offline = false;

  constructor(deps: UpdateDeps) {
    this.deps = { now: Date.now, platform: process.platform, arch: process.arch, ...deps };
  }

  private cachePath(): string {
    return path.join(this.deps.userDir, 'update-check.json');
  }

  private readCache(): CacheFile | null {
    if (this.memo) return this.memo;
    const j = readJson(this.cachePath());
    if (!j || typeof j.checkedAt !== 'number') return null;
    const r = j.release as LatestRelease | null;
    const release = r && typeof r.tag === 'string' && typeof r.version === 'string' && Array.isArray(r.assets) ? r : null;
    this.memo = { checkedAt: j.checkedAt, ...(typeof j.failedAt === 'number' ? { failedAt: j.failedAt } : {}), release };
    return this.memo;
  }

  private writeCache(c: CacheFile): void {
    this.memo = c;
    try {
      fs.mkdirSync(this.deps.userDir, { recursive: true });
      fs.writeFileSync(this.cachePath(), JSON.stringify(c));
    } catch {
      /* A cache that cannot be written is only a second request tomorrow. */
    }
  }

  private settled = false;

  /**
   * Once per process, on macOS: promote a pending cached zip whose version is now the running one (deleting the old
   * cache), drop a stale pending one, and remove unpack folders an earlier run left beside the app.
   */
  private settle(): void {
    if (!this.settled) {
      /* A handoff for a version that is now running (the update finished) must not run again at the next quit. */
      try {
        const h = readHandoff(this.deps.userDir);
        if (h && compareVersions(h.version, this.current()) !== 1) clearHandoff(this.deps.userDir);
      } catch {
        /* housekeeping only */
      }
    }
    if (this.settled || this.deps.platform !== 'darwin') {
      if (this.deps.platform !== 'darwin') this.settled = true;
      return;
    }
    this.settled = true;
    try {
      promoteZipCache(this.deps.userDir, this.current(), (a, b) => compareVersions(a, b));
      const m = this.deps.mac ?? {};
      const bundle = (m.bundle ?? (() => appBundleFromExecPath(process.execPath)))();
      if (bundle) sweepLeftovers(bundle, m.startedAtMs ?? Date.now() - process.uptime() * 1000, this.deps.userDir);
    } catch {
      /* housekeeping only */
    }
  }

  private current(): string {
    return (this.deps.current ?? (() => readVersionInfo().version))();
  }

  /**
   * mac: leave the verified zip for main to unpack and swap in after quit (main is not in the server's kill tree, and builds
   * the swap script and every path itself). The zip is copied to a fixed name in the updates folder because the cache moves
   * it; the folder the server unpacked into here (only to prove the zip opens) is removed.
   */
  private async queueSwap(a: HandoffArgs, version: string, zip: string, asset: string): Promise<void> {
    const staged = path.join(this.deps.userDir, 'updates', 'mac-update.zip');
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.copyFileSync(zip, staged);
    fs.rmSync(a.tmpDir, { recursive: true, force: true });
    writeHandoff(this.deps.userDir, { v: 2, kind: 'mac-swap', version, asset, staged, createdAt: Date.now() });
  }

  private kind(): InstallKind {
    if (this.deps.installKind) return this.deps.installKind();
    /* A server started from plain node (development, tests) is not an installed app: the installer path, as before. */
    if (/^node(\.exe)?$/i.test(path.basename(process.execPath)) && !process.env.SEQUENCE_INSTALL_KIND) return 'nsis';
    return installKind(process.execPath, process.env);
  }

  private linuxKind(): LinuxKind {
    if (this.deps.linuxKind) return this.deps.linuxKind();
    return linuxInstallKind(process.execPath, process.env);
  }

  /** The install flavour that decides which file is offered. */
  private assetKind(): InstallKind | LinuxKind {
    return this.deps.platform === 'linux' ? this.linuxKind() : this.kind();
  }

  private isDesktop(): boolean {
    return (this.deps.desktop ?? (() => readVersionInfo().desktop))();
  }

  private view(c: CacheFile | null): UpdateCheck {
    const current = this.current();
    const desktop = this.isDesktop();
    const rel = c?.release ?? null;
    const newer = rel !== null && compareVersions(rel.version, current) === 1;
    const asset = rel ? pickAsset(rel.assets, this.deps.platform, this.deps.arch, this.assetKind()) : null;
    const sums = rel ? rel.assets.find((a) => a.name === SHASUMS_NAME) : undefined;
    /* Offered only when both downloads start on this repo's own release; anything else is not ours to run. */
    const deb = this.deps.platform === 'linux' && this.linuxKind() === 'deb';
    const pinned = rel !== null && sums !== undefined && isReleaseDownloadUrl(sums.url, rel.tag) && asset !== null && isReleaseDownloadUrl(asset.url, rel.tag);
    return {
      current,
      latest: rel ? { version: rel.version, tag: rel.tag, name: rel.name, htmlUrl: isRepoPageUrl(rel.htmlUrl) ? rel.htmlUrl : canonicalPage(rel.tag), publishedAt: rel.publishedAt, notes: (rel.notes ?? '').slice(0, 20_000) } : null,
      newer,
      asset: asset ? { name: asset.name, size: asset.size } : null,
      installable: newer && pinned && desktop && !deb,
      manual: newer && deb && asset ? debHowto(asset.name) : null,
      desktop,
      checkedAt: c?.checkedAt ?? null,
      offline: this.offline,
    };
  }

  /** The cached answer as it is, with no request (the `updates.check` switch is off). */
  cachedCheck(): UpdateCheck {
    this.settle();
    return this.view(this.readCache());
  }

  /** The cached answer when it is fresh; otherwise ask GitHub once. Never throws: offline is a field, not an error. */
  check(force = false): Promise<UpdateCheck> {
    this.settle();
    const cached = this.readCache();
    const now = this.deps.now();
    if (!force && cached) {
      const age = now - cached.checkedAt;
      const retry = cached.failedAt !== undefined && now - cached.failedAt < RETRY_MS;
      if ((age < DAY_MS && cached.failedAt === undefined) || retry) return Promise.resolve(this.view(cached));
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchLatest(cached).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchLatest(cached: CacheFile | null): Promise<UpdateCheck> {
    const f = this.deps.fetchImpl ?? proxyAwareFetch();
    const now = this.deps.now();
    try {
      const ctl = new AbortController();
      const ms = this.deps.checkMs ?? 8000;
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctl.abort();
          reject(new Error('the release check timed out'));
        }, ms);
        timer.unref?.();
      });
      timedOut.catch(() => undefined);
      let release;
      try {
        /* The timer stays armed through the body: a response that sends headers and then stalls must not hang. */
        const res = await Promise.race([getAllowed(f, LATEST_URL, { accept: 'application/vnd.github+json', 'user-agent': 'sequence-app-update-check' }, ctl.signal), timedOut]);
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        release = parseRelease(await Promise.race([res.json(), timedOut]));
      } finally {
        clearTimeout(timer);
      }
      if (!release) throw new Error('not a release');
      this.offline = false;
      const next: CacheFile = { checkedAt: now, release };
      this.writeCache(next);
      return this.view(next);
    } catch {
      this.offline = true;
      const next: CacheFile = { checkedAt: cached?.checkedAt ?? 0, failedAt: now, release: cached?.release ?? null };
      this.writeCache(next);
      return this.view(next);
    }
  }

  /**
   * macOS: download the release's zip (by difference when the installed version's zip is cached), unpack it beside the
   * app and hand the swap to a helper that runs once Sequence quits. `{ done: false, reason }` means "use the dmg
   * instead" and says why; a download that fails its checksum is an error (thrown), not a fallback.
   */
  private async installMac(c: MacCtx): Promise<{ done: true } | { done: false; reason: string }> {
    const m = this.deps.mac ?? {};
    const bundle = (m.bundle ?? (() => appBundleFromExecPath(process.execPath)))();
    if (!bundle) return { done: false, reason: 'Sequence is not running from an .app bundle, so it cannot replace itself; the disk image is used.' };
    const can = (m.canSwap ?? ((b: string) => canSwapInPlace(b)))(bundle);
    if (!can.ok) return { done: false, reason: `${can.reason ?? 'Sequence cannot replace itself here.'} The disk image is used instead.` };
    const zipSha = shaFor(c.sums, c.zip.name);
    if (!zipSha) return { done: false, reason: `${SHASUMS_NAME} does not list ${c.zip.name}, so the update zip cannot be checked; the disk image is used.` };
    const cached = readZipCache(this.deps.userDir, (v) => compareVersions(v, this.current()) === 0);
    /* The target's zip may already be here (an earlier download whose swap has not happened yet): verify it and use it, fetching nothing. */
    const pending = readZipCache(this.deps.userDir, (v) => compareVersions(v, c.rel.version) === 0, 'pending');
    const reuse = pending !== null && pending.meta.sha256 === zipSha && (await sha256File(pending.zip)) === zipSha ? pending : null;
    const part = path.join(c.dir, `${path.basename(c.zip.name).replace(/[^\w.\- ]/g, '_')}.${randomBytes(6).toString('hex')}.part`);
    this.job = { ...this.job, total: c.zip.size, fullSize: c.zip.size, installMode: 'in-place' };
    const net: Net = {
      get: (url, headers, resolved) => getAllowedAt(c.f, url, headers, c.ctl.signal, resolved ? isDownloadHop : c.first, isDownloadHop),
      arm: c.arm,
      timed: c.timed,
    };
    let tmp: string | null = null;
    try {
      let result: Awaited<ReturnType<typeof downloadZip>>;
      if (reuse) {
        result = { mode: 'full', downloaded: 0, fullSize: reuse.meta.size, reused: reuse.meta.size, fallbackReason: null, blockmap: null };
      } else {
        try {
        result = await downloadZip({
          net,
          zipUrl: c.zip.url,
          /* The block map only steers which parts are fetched; the zip's own checksum is what decides if the result is used. */
          blockmapUrl: c.blockmap?.url ?? null,
          blockmapSha: c.blockmap ? shaFor(c.sums, c.blockmap.name) : null,
          expectedSha: zipSha,
          size: c.zip.size,
          part,
          ...(m.mergeGap !== undefined ? { mergeGap: m.mergeGap } : {}),
          cached: cached ? { zip: cached.zip, blockmap: cached.blockmap } : null,
          onProgress: (received, total) => {
            this.job = { ...this.job, received, total };
          },
        });
        } catch (e) {
          if (e instanceof ChecksumMismatch) {
            throw new Error(`The download did not match its published checksum (${SHASUMS_NAME}), so it was deleted and nothing was run.`);
          }
          if (c.ctl.signal.aborted) throw e;
          /* A 404, a dropped connection, a refused range: the zip is unavailable, not untrustworthy. The disk image is the fallback. */
          return { done: false, reason: `The update zip could not be downloaded (${(e as Error).message}); the disk image is used instead.` };
        }
      }
      this.job = { ...this.job, state: 'verifying', mode: reuse ? 'cached' : result.mode, downloaded: result.downloaded, fullSize: result.fullSize, reused: result.reused, received: result.downloaded, total: result.downloaded, fallbackReason: result.fallbackReason };
      this.job = { ...this.job, state: 'launching' };
      try {
        tmp = makeTempBeside(bundle);
        const newBundle = await (m.extract ?? extractZip)(reuse ? reuse.zip : part, tmp);
        const pid = (m.pid ?? (() => (process.ppid > 1 ? process.ppid : process.pid)))();
        await (m.handoff ?? ((a) => this.queueSwap(a, c.rel.version, reuse ? reuse.zip : part, c.zip.name)))({ script: path.join(c.dir, 'apply-update.sh'), pid, newBundle, appBundle: bundle, tmpDir: tmp });
        try {
          recordHandoff(this.deps.userDir, tmp, pid);
        } catch {
          /* the sweep then only has the age rule to go by */
        }
      } catch (e) {
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
        tmp = null;
        return { done: false, reason: `${(e as Error).message}; the disk image is used instead.` };
      }
      try {
        /* Pending, not installed: the installed copy stays until this version is seen running. */
        if (!reuse) writePendingZip(this.deps.userDir, c.rel.version, part, zipSha, result.blockmap);
      } catch {
        /* no cache only means the next update downloads the whole file */
      }
      this.job = { ...this.job, state: 'launched', installMode: 'in-place', howto: 'The update is ready. Quit Sequence (Cmd+Q) to finish: it installs as it closes and opens again by itself.', error: null };
      return { done: true };
    } finally {
      fs.rmSync(part, { force: true });
    }
  }

  status(): InstallJob {
    return { ...this.job };
  }

  /**
   * Download the installer, verify it, run it. Called only from the person's click on "Update to vX".
   * Resolves when the job has finished or failed; the state is readable meanwhile (status()).
   *
   * One install at a time: the state turns 'downloading' before this returns (so the POST that started it
   * answers a running job, and the page polls), and a second click while it runs gets the same promise.
   */
  install(expected?: string): Promise<InstallJob> {
    if (this.running) return this.running;
    this.job = { ...IDLE_JOB, state: 'downloading' };
    this.running = this.runInstall(expected)
      .catch((e: unknown) => {
        this.job = { ...this.job, state: 'failed', error: `Could not update: ${(e as Error)?.message ?? String(e)}`, file: null };
        return this.status();
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** `expected`: the version the person's button showed; the job refuses to install any other. */
  private async runInstall(expected?: string): Promise<InstallJob> {
    this.settle();
    const fail = (error: string, file: string | null = null): InstallJob => {
      this.job = { ...this.job, state: 'failed', error, file: null };
      if (file) fs.rmSync(file, { force: true });
      return this.status();
    };
    if (!this.isDesktop()) return fail('This copy of Sequence is not the installed app (it runs from source or the command line), so it is not updated by an installer. Open the release page, or update it the way it was installed.');
    /* Read the release from GitHub again: the click acts on what GitHub says now, never on a cache file on disk. */
    let gate: NodeJS.Timeout | undefined;
    const view = await Promise.race([
      this.check(true),
      new Promise<never>((_, reject) => {
        gate = setTimeout(() => reject(new Error(`the release check stalled (nothing arrived for ${Math.max(1, Math.round((this.deps.idleMs ?? IDLE_MS) / 1000))}s)`)), this.deps.idleMs ?? IDLE_MS);
      }),
    ]).finally(() => clearTimeout(gate));
    if (view.offline) return fail('Could not reach GitHub to confirm the release, so nothing was downloaded. Try again in a moment.');
    const rel = this.memo?.release ?? null;
    if (!view.newer || !rel) return fail('There is no newer version to install.');
    if (expected !== undefined && compareVersions(expected, rel.version) !== 0) {
      return fail(`The newest release is now v${rel.version}, not the v${expected.replace(/^v/i, '')} you clicked, so nothing was downloaded. Check again and choose.`);
    }
    const asset = pickAsset(rel.assets, this.deps.platform, this.deps.arch, this.assetKind());
    /* A deb belongs to the package manager: say what to run and download nothing. */
    if (this.deps.platform === 'linux' && this.linuxKind() === 'deb') return fail(asset ? debHowto(asset.name) : `Sequence is installed through your package manager. Download the .deb from the release page and install it with: sudo apt install ./<file>.deb`);
    const sums = rel.assets.find((a) => a.name === SHASUMS_NAME);
    /* macOS: the zip (+ block map) updates in place and, after the first time, by difference; the dmg is the fallback. */
    const mac = this.deps.platform === 'darwin' ? pickMacUpdate(rel.assets, this.deps.arch) : null;
    if (!asset && !mac) return fail(`Release ${rel.tag} has no installer for this computer. Open the release page to download one.`);
    if (!sums) return fail(`Release ${rel.tag} has no ${SHASUMS_NAME}, so the download cannot be checked. Nothing was run.`);
    if ((asset && !isReleaseDownloadUrl(asset.url, rel.tag)) || !isReleaseDownloadUrl(sums.url, rel.tag) || (!asset && mac && !isReleaseDownloadUrl(mac.zip.url, rel.tag))) {
      return fail(`Release ${rel.tag} points its download outside ${RELEASES_REPO}'s own releases, so nothing was downloaded.`);
    }
    const first = (u: string): boolean => isReleaseDownloadUrl(u, rel.tag);
    this.job = { ...IDLE_JOB, state: 'downloading', version: rel.version, total: asset?.size ?? 0 };
    const f = this.deps.fetchImpl ?? proxyAwareFetch();
    const dir = path.join(this.deps.userDir, 'updates');
    const safeName = path.basename((asset ?? mac!.zip).name).replace(/[^\w.\- ]/g, '_');
    const file = path.join(dir, safeName);
    /* A name of its own: never a file another run (or a leftover) holds. */
    const part = `${file}.${randomBytes(6).toString('hex')}.part`;
    const idleMs = this.deps.idleMs ?? IDLE_MS;
    const ctl = new AbortController();
    let idle: NodeJS.Timeout | undefined;
    const stalled = new Promise<never>((_, reject) => {
      ctl.signal.addEventListener('abort', () => reject(new Error(`the download stalled (nothing arrived for ${Math.max(1, Math.round(idleMs / 1000))}s)`)), { once: true });
    });
    stalled.catch(() => undefined);
    /* Every wait on the network races the idle timer, which each chunk re-arms. Not unref'd: while a download is
       stalled the timer may be the only thing pending, and it must fire (it is always cleared at the end). */
    const arm = (): void => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => ctl.abort(), idleMs);
    };
    const timed = <T>(p: Promise<T>): Promise<T> => Promise.race([p, stalled]);
    let out: fs.WriteStream | null = null;
    try {
      arm();
      fs.mkdirSync(dir, { recursive: true });
      const sumRes = await timed(getAllowed(f, sums.url, { 'user-agent': 'sequence-app-update-check' }, ctl.signal, first, isDownloadHop));
      if (!sumRes.ok) throw new Error(`could not read ${SHASUMS_NAME} (${sumRes.status})`);
      const sumsText = await timed(sumRes.text());
      /* With a pinned key, the checksums themselves must be signed by it (off while SIGNING_PUBLIC_KEY is null). */
      const key = this.deps.signingKey === undefined ? SIGNING_PUBLIC_KEY : this.deps.signingKey;
      if (key) {
        const sigAsset = rel.assets.find((a) => a.name === SIGNATURE_NAME);
        if (!sigAsset || !isReleaseDownloadUrl(sigAsset.url, rel.tag)) return fail(`Release ${rel.tag} carries no signature (${SIGNATURE_NAME}), so its checksums cannot be trusted. Nothing was downloaded.`);
        const sigRes = await timed(getAllowed(f, sigAsset.url, { 'user-agent': 'sequence-app-update-check' }, ctl.signal, first, isDownloadHop));
        if (!sigRes.ok) throw new Error(`could not read ${SIGNATURE_NAME} (${sigRes.status})`);
        if (!verifySignature(Buffer.from(sumsText, 'utf8'), await timed(sigRes.text()), key)) {
          return fail(`${SHASUMS_NAME} does not carry a valid signature by Sequence's release key, so nothing was downloaded or run.`);
        }
      }
      const sumMap = parseShasums(sumsText);
      let macReason: string | null = null;
      if (mac && isReleaseDownloadUrl(mac.zip.url, rel.tag)) {
        const r = await this.installMac({ rel, zip: mac.zip, blockmap: mac.blockmap && isReleaseDownloadUrl(mac.blockmap.url, rel.tag) ? mac.blockmap : null, sums: sumMap, f, ctl, arm, timed, first, dir });
        if (r.done) return this.status();
        macReason = r.reason;
      } else if (mac) {
        macReason = `Release ${rel.tag} points its update zip outside ${RELEASES_REPO}'s own releases.`;
      }
      if (!asset) throw new Error(macReason ?? 'there is no installer for this computer');
      if (this.deps.platform === 'darwin') this.job = { ...this.job, installMode: 'dmg', fallbackReason: macReason ?? 'This release has no update zip, so the disk image is used.' };
      const expected = shaFor(sumMap, asset.name);
      if (!expected) throw new Error(`${SHASUMS_NAME} does not list ${asset.name}`);
      arm();
      const res = await timed(getAllowed(f, asset.url, { 'user-agent': 'sequence-app-update-check' }, ctl.signal, first, isDownloadHop));
      if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
      const total = Number(res.headers.get('content-length')) || asset.size;
      this.job = { ...this.job, total };
      /* 'wx': create, never open a file that is already there. Its errors reject the wait; they never crash. */
      const stream = fs.createWriteStream(part, { flags: 'wx' });
      out = stream;
      const broke = new Promise<never>((_, reject) => stream.once('error', reject));
      broke.catch(() => undefined);
      const reader = res.body.getReader();
      try {
        for (;;) {
          arm();
          const { done, value } = await Promise.race([reader.read(), stalled, broke]);
          if (done) break;
          if (value) {
            this.job.received += value.length;
            if (this.job.received > MAX_BYTES) throw new Error('download is larger than any release');
            if (!stream.write(value)) await Promise.race([new Promise<void>((r) => stream.once('drain', () => r())), stalled, broke]);
          }
        }
      } catch (e) {
        void reader.cancel?.().catch(() => undefined);
        throw e;
      }
      await Promise.race([new Promise<void>((r) => stream.end(() => r())), broke]);
      await closed(stream);
      out = null;
      if (idle) clearTimeout(idle);
      /* What is checked is the closed file on disk, the bytes that will run, not what passed through memory. */
      this.job = { ...this.job, state: 'verifying' };
      const actual = await sha256File(part);
      if (actual !== expected) {
        fs.rmSync(part, { force: true });
        return fail(`The download did not match its published checksum (${SHASUMS_NAME}), so it was deleted and nothing was run.`);
      }
      fs.rmSync(file, { force: true });
      fs.renameSync(part, file);
      this.job = { ...this.job, state: 'launching', file };
      const linuxKind = this.deps.platform === 'linux' ? this.linuxKind() : undefined;
      clearHandoff(this.deps.userDir);
      const howto = await (this.deps.launch ?? ((f, p) => launchInstaller(f, p, { kind: this.kind(), userDir: this.deps.userDir, version: rel.version, asset: asset?.name, ...(linuxKind ? { linuxKind, appImage: process.env.APPIMAGE } : {}), ...this.deps.win, ...this.deps.linux })))(file, this.deps.platform);
      /* An update queued for main (installer, portable copy, AppImage swap) runs when the app quits, like the mac swap. */
      if (readHandoff(this.deps.userDir)?.version === rel.version) this.job = { ...this.job, installMode: 'in-place' };
      /* The disk image replaces the app by hand: no cached zip can be the new version's base, so none is kept. */
      if (this.deps.platform === 'darwin') {
        try {
          clearZipCache(this.deps.userDir);
        } catch {
          /* only disk space */
        }
      }
      this.job = { ...this.job, state: 'launched', howto, error: null };
      return this.status();
    } catch (e) {
      if (out) {
        out.destroy();
        await closed(out);
      }
      try {
        fs.rmSync(part, { force: true });
      } catch {
        /* a file Windows still holds is only disk space; the next run uses another name */
      }
      return fail(`Could not update: ${(e as Error).message}`);
    } finally {
      if (idle) clearTimeout(idle);
    }
  }
}

interface MacCtx {
  rel: LatestRelease;
  zip: ReleaseAsset;
  blockmap: ReleaseAsset | null;
  sums: ReadonlyMap<string, string>;
  f: FetchLike;
  ctl: AbortController;
  arm: () => void;
  timed: <T>(p: Promise<T>) => Promise<T>;
  first: (u: string) => boolean;
  dir: string;
}

/** Resolves once the stream's file handle is closed (also after an error). */
function closed(s: fs.WriteStream): Promise<void> {
  if (s.closed) return Promise.resolve();
  return new Promise<void>((r) => s.once('close', () => r()));
}

export interface StartOptions {
  env?: NodeJS.ProcessEnv;
  /** Windows: hand the arguments to CreateProcess untouched (for `cmd /s /c "..."`). */
  verbatim?: boolean;
}

/** Test seams for launchInstaller. */
export interface LaunchDeps {
  /** Starts a detached process: only for the harmless "open the disk image / the folder" fallbacks. Installs never use it. */
  start?: (cmd: string, args: string[], opts?: StartOptions) => Promise<void>;
  /** Where the handoff file is written (the user dir). Installs are handed to the desktop's main process, never started here. */
  userDir?: string;
  /** Replaces writing the handoff file (tests). */
  queue?: (h: Handoff) => void;
  /** The release this update brings (recorded in the handoff so a stale one is dropped). */
  version?: string;
  kind?: InstallKind;
  /** Linux: how this copy was installed, and the AppImage file running now. */
  linuxKind?: LinuxKind;
  appImage?: string;
  /** The pid the helper waits on (default: the desktop shell, this process's parent). */
  pid?: () => number;
  /** The folder the portable app lives in, and its exe (default: from process.execPath). */
  appDir?: string;
  exeName?: string;
  /** The release asset's name (the key of its line in SHASUMS256.txt). */
  asset?: string;
}

/** Start a detached process; rejects on a spawn error (missing file, no permission) instead of throwing it at the process. */
function start(cmd: string, args: string[], opts: StartOptions = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}), ...(opts.verbatim ? { windowsVerbatimArguments: true } : {}) });
    } catch (e) {
      reject(e as Error);
      return;
    }
    /* Stays attached: a late error lands here rather than crashing the server. */
    child.on('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** Leave the update for the desktop's main process to run after quit (see update/handoff.ts for why not here). */
function hand(deps: LaunchDeps, h: Pick<Handoff, 'kind' | 'staged'>): void {
  const full: Handoff = { v: 2, version: deps.version ?? '', asset: deps.asset ?? '', createdAt: Date.now(), ...h };
  if (deps.queue) return deps.queue(full);
  if (!deps.userDir) throw new Error('no folder to leave the update in');
  writeHandoff(deps.userDir, full);
}

/** Verify-then-queue the installer for this OS and say how to finish. Rejects when it could not be queued. */
export async function launchInstaller(file: string, platform: string, deps: LaunchDeps = {}): Promise<string> {
  const run = deps.start ?? start;
  const pid = (deps.pid ?? (() => process.ppid))();
  if (platform === 'win32' && deps.kind === 'portable') {
    const appDir = deps.appDir ?? path.dirname(process.execPath);
    const plan = checkPortable({ zip: file, appDir });
    if (!plan.ok) return plan.reason;
    hand(deps, { kind: 'portable', staged: file });
    return 'The update is ready. Restart Sequence to finish: it copies the new files over this folder and opens again.';
  }
  if (platform === 'win32') {
    /* Silent and per-user (the build allows no elevation). Run by main after quit; the installer then starts the new version. */
    await sha256File(file);
    hand(deps, { kind: 'nsis', staged: file });
    return 'Restart Sequence to finish: the installer runs quietly and Sequence opens again on the new version.';
  }
  if (platform === 'darwin') {
    await run('open', [file]);
    return 'The disk image is open. Quit Sequence, drag Sequence into Applications and replace the old one, then open it again.';
  }
  if (platform === 'linux' && deps.linuxKind === 'appimage' && deps.appImage) {
    try {
      const h = stageAppImage({ pid, file, target: deps.appImage });
      hand(deps, { kind: 'appimage-swap', staged: h.staged });
      return 'Restart Sequence to finish: it replaces this AppImage and opens again.';
    } catch {
      /* a folder that cannot be written (read-only mount): fall through to the manual words */
    }
  }
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* the folder opens either way */
  }
  try {
    await run('xdg-open', [path.dirname(file)]);
  } catch {
    /* no file manager to open: the file is saved and the words say where */
  }
  return `Saved and made runnable at ${file}. Quit Sequence, then run that file (or move it where you keep your apps).`;
}

/* ── what's new: the release notes bundled with the app ─────────────────── */

export interface ReleaseNote {
  version: string;
  title: string;
  /** The markdown after the title. */
  body: string;
}

function releaseDirs(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  if (env.SEQUENCE_RELEASES_DIR) out.push(env.SEQUENCE_RELEASES_DIR);
  for (const r of rootDirs()) out.push(path.join(r, 'docs', 'releases'));
  return out;
}

/** docs/releases/vX.Y.Z.md, newest first. */
export function readReleaseNotes(env: NodeJS.ProcessEnv = process.env, dir?: string): ReleaseNote[] {
  const dirs = dir ? [dir] : releaseDirs(env);
  for (const d of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(d);
    } catch {
      continue;
    }
    const notes: ReleaseNote[] = [];
    for (const n of names) {
      const m = /^v?(\d+\.\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)\.md$/.exec(n);
      if (!m) continue;
      let text: string;
      try {
        text = fs.readFileSync(path.join(d, n), 'utf8').replace(/\r\n/g, '\n');
      } catch {
        continue;
      }
      const head = /^#\s+(.+)\n?/.exec(text);
      notes.push({ version: m[1]!, title: head ? head[1]!.trim() : `Sequence ${m[1]}`, body: head ? text.slice(head[0].length).trim() : text.trim() });
    }
    if (notes.length) return notes.sort((a, b) => compareVersions(b.version, a.version) ?? 0);
  }
  return [];
}

export function defaultUserDir(): string {
  const o = process.env.SEQUENCE_USER_DIR;
  return o && path.isAbsolute(o) ? o : path.join(os.homedir(), '.sequence');
}

/** One check shortly after launch (so a new release shows without waiting a day), then once a day while the app is up. unref'd: it never keeps the process alive. */
export function startDailyUpdateCheck(service: UpdateService, everyMs = DAY_MS, enabled: () => boolean = () => true, firstCheckMs: number | null = FIRST_CHECK_MS): () => void {
  /* `enabled` is the `updates.check` setting (askAgentMap.ts), read on every tick; false skips the request. */
  const tick = (): void => {
    if (enabled()) void service.check(false);
  };
  const first = firstCheckMs === null ? null : setTimeout(tick, firstCheckMs);
  first?.unref?.();
  const t = setInterval(tick, everyMs);
  t.unref?.();
  return () => {
    if (first) clearTimeout(first);
    clearInterval(t);
  };
}

/** The first check after launch: late enough not to compete with start-up, early enough to matter. */
export const FIRST_CHECK_MS = 60_000;
