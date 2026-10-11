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
  nums: [number, number, number];
  pre: string[];
}

function parse(v: string): Parsed | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(v);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** -1, 0 or 1 by semantic version (a leading v is fine; a prerelease is older than its release); null when either is not a version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
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
export function pickAsset(assets: readonly ReleaseAsset[], platform: string, arch: string): ReleaseAsset | null {
  const usable = assets.filter((a) => !/\.blockmap$/i.test(a.name));
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
  if (platform === 'linux') {
    const imgs = usable.filter((a) => /\.AppImage$/i.test(a.name));
    const x64 = (a: ReleaseAsset): boolean => /(x86_64|x64|amd64)/i.test(a.name);
    const arm = (a: ReleaseAsset): boolean => /(arm64|aarch64)/i.test(a.name);
    if (arch === 'arm64') return imgs.find(arm) ?? null;
    return imgs.find((a) => !arm(a) && (x64(a) || imgs.length === 1)) ?? imgs.find((a) => !arm(a)) ?? null;
  }
  return null;
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
    return res;
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

export function readVersionInfo(env: NodeJS.ProcessEnv = process.env, platform = process.platform, arch = process.arch): VersionInfo {
  /* dist/server/ (tsc) or dist/ (the one-file server bundle): the analyzer's package.json is one or two levels up. */
  const pkg = readJson(path.resolve(HERE, '..', 'package.json'))?.name === '@sequence/analyzer' ? readJson(path.resolve(HERE, '..', 'package.json')) : readJson(path.resolve(HERE, '..', '..', 'package.json'));
  let info: Record<string, unknown> | null = null;
  for (const r of rootDirs()) {
    info = readJson(path.join(r, 'build-info.json'));
    if (info) break;
  }
  const fromEnv = env.SEQUENCE_APP_VERSION && parse(env.SEQUENCE_APP_VERSION) ? env.SEQUENCE_APP_VERSION : null;
  const version = fromEnv ?? (typeof info?.version === 'string' ? info.version : null) ?? (typeof pkg?.version === 'string' ? pkg.version : '0.0.0');
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
  private job: InstallJob = { state: 'idle', version: null, received: 0, total: 0, error: null, howto: null, file: null };
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

  private current(): string {
    return (this.deps.current ?? (() => readVersionInfo().version))();
  }

  private isDesktop(): boolean {
    return (this.deps.desktop ?? (() => readVersionInfo().desktop))();
  }

  private view(c: CacheFile | null): UpdateCheck {
    const current = this.current();
    const desktop = this.isDesktop();
    const rel = c?.release ?? null;
    const newer = rel !== null && compareVersions(rel.version, current) === 1;
    const asset = rel ? pickAsset(rel.assets, this.deps.platform, this.deps.arch) : null;
    const sums = rel ? rel.assets.find((a) => a.name === SHASUMS_NAME) : undefined;
    /* Offered only when both downloads start on this repo's own release; anything else is not ours to run. */
    const pinned = rel !== null && sums !== undefined && isReleaseDownloadUrl(sums.url, rel.tag) && asset !== null && isReleaseDownloadUrl(asset.url, rel.tag);
    return {
      current,
      latest: rel ? { version: rel.version, tag: rel.tag, name: rel.name, htmlUrl: isRepoPageUrl(rel.htmlUrl) ? rel.htmlUrl : canonicalPage(rel.tag), publishedAt: rel.publishedAt, notes: (rel.notes ?? '').slice(0, 20_000) } : null,
      newer,
      asset: asset ? { name: asset.name, size: asset.size } : null,
      installable: newer && pinned && desktop,
      desktop,
      checkedAt: c?.checkedAt ?? null,
      offline: this.offline,
    };
  }

  /** The cached answer when it is fresh; otherwise ask GitHub once. Never throws: offline is a field, not an error. */
  check(force = false): Promise<UpdateCheck> {
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
    const f = this.deps.fetchImpl ?? (fetch as unknown as FetchLike);
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
    this.job = { state: 'downloading', version: null, received: 0, total: 0, error: null, howto: null, file: null };
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
    const asset = pickAsset(rel.assets, this.deps.platform, this.deps.arch);
    const sums = rel.assets.find((a) => a.name === SHASUMS_NAME);
    if (!asset) return fail(`Release ${rel.tag} has no installer for this computer. Open the release page to download one.`);
    if (!sums) return fail(`Release ${rel.tag} has no ${SHASUMS_NAME}, so the download cannot be checked. Nothing was run.`);
    if (!isReleaseDownloadUrl(asset.url, rel.tag) || !isReleaseDownloadUrl(sums.url, rel.tag)) {
      return fail(`Release ${rel.tag} points its download outside ${RELEASES_REPO}'s own releases, so nothing was downloaded.`);
    }
    const first = (u: string): boolean => isReleaseDownloadUrl(u, rel.tag);
    this.job = { state: 'downloading', version: rel.version, received: 0, total: asset.size, error: null, howto: null, file: null };
    const f = this.deps.fetchImpl ?? (fetch as unknown as FetchLike);
    const dir = path.join(this.deps.userDir, 'updates');
    const safeName = path.basename(asset.name).replace(/[^\w.\- ]/g, '_');
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
      const expected = shaFor(parseShasums(sumsText), asset.name);
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
      const howto = await (this.deps.launch ?? launchInstaller)(file, this.deps.platform);
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

/** Resolves once the stream's file handle is closed (also after an error). */
function closed(s: fs.WriteStream): Promise<void> {
  if (s.closed) return Promise.resolve();
  return new Promise<void>((r) => s.once('close', () => r()));
}

/** Start a detached process; rejects on a spawn error (missing file, no permission) instead of throwing it at the process. */
function start(cmd: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
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

/** Run the verified installer for this OS and say how to finish. Rejects when it could not be started. */
export async function launchInstaller(file: string, platform: string): Promise<string> {
  if (platform === 'win32') {
    await start(file, []);
    return 'The installer is open. Follow it; it will ask to close Sequence, then start the new version.';
  }
  if (platform === 'darwin') {
    await start('open', [file]);
    return 'The disk image is open. Quit Sequence, drag Sequence into Applications and replace the old one, then open it again.';
  }
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* the folder opens either way */
  }
  try {
    await start('xdg-open', [path.dirname(file)]);
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
      const m = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.md$/.exec(n);
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

/** Once a day while the app is up. unref'd: it never keeps the process alive. */
export function startDailyUpdateCheck(service: UpdateService, everyMs = DAY_MS): () => void {
  const t = setInterval(() => void service.check(false), everyMs);
  t.unref?.();
  return () => clearInterval(t);
}
