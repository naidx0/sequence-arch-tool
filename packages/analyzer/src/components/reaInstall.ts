/**
 * REA (morluto/rea, "Reverse Engineer Anything"), as a component Sequence manages.
 *
 * OFF BY DEFAULT. Nothing here runs until a person clicks "Add REA" in Settings and sees the plan (what will be
 * downloaded and from where). The install is a pinned commit of the repository, built where Sequence keeps it:
 *
 *   ~/.sequence/components/rea/<commit>/      no admin rights, no global install, no change to any agent's own config
 *
 *   1. git fetch --depth 1 <repo> <commit>    the pinned commit only; the checked-out HEAD must equal the pin
 *   2. npm ci --ignore-scripts                REA's own lockfile; no dependency's install script runs (esbuild, frida, fsevents)
 *   3. npm run compile                        the one build step verified (tsc, then bundle); nothing else from `scripts`
 *   4. npm prune --omit=dev --ignore-scripts  drops the build tools again (about 490 MB down to about 115 MB)
 *   5. node scripts/rea.mjs --version         must print the pinned version, else the install is thrown away
 *
 * Built in a sibling `.partial-*` folder and renamed into place on success, so an interrupted install leaves no
 * half-built `<commit>` folder for the next run to mistake for a good one. Everything external (git, npm, node)
 * goes through an injected {@link Runner}, so the tests drive the real routine against a local bare repository
 * with no network.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadMcpConfigFromFile, writeMcpConfigDocument, type McpServerConfig } from '../server/mcpClient.js';
import { REA_ADDON, addonPlan, installAddon, type AddonRecord, type AddonSpec, type FetchLike } from './reaAddon.js';
import { REA_CATALOG_SOURCE } from './reaCatalog.js';
import { checkDoctor, readDoctor, type ReaDoctor } from './reaDoctor.js';
import { REA_SERVER_NAME, reaAgentToolNames } from './reaTools.js';

/** The release this build of Sequence installs. Changing the commit changes the catalog, the profile's tools and the notices. */
export const REA_PIN = {
  id: 'rea',
  name: 'Reverse Engineer Anything (REA)',
  repo: REA_CATALOG_SOURCE.repo,
  commit: REA_CATALOG_SOURCE.commit,
  version: REA_CATALOG_SOURCE.version,
  licence: 'MIT',
  node: '^22.19.0 || ^24.11.0 || >=26.0.0',
  /** Measured on the verified build (see docs/research/rea.md), in megabytes. */
  downloadMb: 115,
  diskMb: 185,
} as const;

export const REA_MANIFEST_FILE = 'sequence-component.json';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type Runner = (command: string, args: readonly string[], opts: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs?: number; /** Keep this many trailing characters of each stream (default 4000). The doctor's JSON is far longer. */ maxOutputChars?: number }) => Promise<RunResult>;

const cap = (s: string, n = 4000): string => (s.length > n ? s.slice(s.length - n) : s);

/**
 * npm as `node npm-cli.js ...`, so no shell is needed (on Windows npm is a .cmd, and Node refuses to run one without a shell).
 * Looks beside the node that PATH finds; null when npm is somewhere unexpected, and the caller then falls back to the name.
 */
export function npmCliPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { node: string; cli: string } | null {
  const node = resolveOnPath('node', env, platform);
  if (!node) return null;
  const dir = path.dirname(node);
  for (const cli of [path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
    if (fs.existsSync(cli)) return { node, cli };
  }
  return null;
}

/** The default runner: no shell. npm goes through its own cli script; only an npm found nowhere else falls back to a Windows shell. */
export const systemRunner: Runner = (command, args, { cwd, env, timeoutMs = 15 * 60_000, maxOutputChars = 4000 }) =>
  new Promise((resolve) => {
    const npm = command === 'npm' ? npmCliPath(env) : null;
    if (npm) {
      command = npm.node;
      args = [npm.cli, ...args];
    }
    const useShell = process.platform === 'win32' && command === 'npm';
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r: RunResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(command, [...args], { cwd, env, shell: useShell, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stdout: cap(stdout, maxOutputChars), stderr: cap(`${stderr}\ntimed out after ${Math.round(timeoutMs / 1000)}s`, maxOutputChars) });
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => finish({ code: null, stdout: cap(stdout, maxOutputChars), stderr: cap(`${stderr}\n${e.message}`, maxOutputChars) }));
    child.on('close', (code) => finish({ code, stdout: cap(stdout, maxOutputChars), stderr: cap(stderr, maxOutputChars) }));
  });

/** The environment every external step gets: scripts off, no update checks, no audit or fund calls, no git hooks. */
export function sealedEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    npm_config_ignore_scripts: 'true',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    HUSKY: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
}

export const reaRoot = (userDir: string): string => path.join(userDir, 'components', 'rea');
export const reaInstallDir = (userDir: string, commit: string = REA_PIN.commit): string => path.join(reaRoot(userDir), commit);
export const reaEntry = (installDir: string): string => path.join(installDir, 'scripts', 'rea.mjs');

export interface Requirement {
  name: 'git' | 'node' | 'npm';
  ok: boolean;
  detail: string;
}

/** Compare a node version with REA's `^22.19.0 || ^24.11.0 || >=26.0.0`. */
export function nodeVersionOk(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  if (major >= 26) return true;
  if (major === 24) return minor >= 11;
  if (major === 22) return minor >= 19;
  return false;
}

export interface PlanStep {
  id: 'fetch' | 'install' | 'build' | 'prune' | 'addon' | 'verify';
  label: string;
  command: string;
}

/** What Start adds on Windows: the npm package's two native files, checked against the registry's integrity value. */
export function defaultAddon(platform: NodeJS.Platform = process.platform): AddonSpec | null {
  return platform === REA_ADDON.platform ? REA_ADDON : null;
}

export interface ReaPlan {
  pin: typeof REA_PIN;
  installDir: string;
  /** The npm package the native files come from, or null where the source build already has them. */
  addon: ReturnType<typeof addonPlan> | null;
  /** Download and disk totals for the whole Start, in megabytes. */
  totalDownloadMb: number;
  totalDiskMb: number;
  steps: PlanStep[];
  requirements: Requirement[];
  /** Plain sentences about what will not work, shown in the row before the click. */
  limitations: string[];
  /** True when every requirement is met, so the button can act. */
  ready: boolean;
}

export function planSteps(repo: string, commit: string, addon: AddonSpec | null = null): PlanStep[] {
  return [
    { id: 'fetch', label: `Download the pinned commit ${commit.slice(0, 7)} from ${repo}`, command: `git fetch --depth 1 origin ${commit}` },
    { id: 'install', label: "Install REA's locked dependencies, running none of their install scripts", command: 'npm ci --ignore-scripts' },
    { id: 'build', label: 'Build it (the one build step checked)', command: 'npm run compile' },
    { id: 'prune', label: 'Drop the build tools again', command: 'npm prune --omit=dev --ignore-scripts' },
    ...(addon
      ? [
          {
            id: 'addon' as const,
            label: `Download ${addon.package}@${addon.version} from npm, check it against the registry's integrity value, and take its two Windows native files`,
            command: `GET ${addon.registry}/${addon.package}/${addon.version}, then tar -xzf (two named files only)`,
          },
        ]
      : []),
    { id: 'verify', label: 'Check that it starts and reports the pinned version', command: `node scripts/rea.mjs --version` },
  ];
}

/** What REA cannot do on this machine, said before anyone clicks. Only what was observed. */
export function limitationsFor(platform: NodeJS.Platform, installDir: string | null, willAddNative = false): string[] {
  const out: string[] = [];
  const hasNative = installDir !== null && fs.existsSync(path.join(installDir, 'native', 'windows', 'build', 'manifest.json'));
  if (platform === 'win32' && !hasNative && !willAddNative) {
    out.push(
      "On Windows, REA's source build has no Windows native controls (they ship only in its npm package), so JavaScript and Electron analysis and the other provider-backed tools report themselves unavailable. Listing what is inside an .asar or archive works.",
    );
  }
  out.push('Deep native analysis needs Hopper, Ghidra or IDA that you install yourself; Sequence installs none of them and needs no admin rights.');
  out.push('Frida live instrumentation is not installed (its install script is not run).');
  return out;
}

export async function checkRequirements(run: Runner, env: NodeJS.ProcessEnv = process.env): Promise<Requirement[]> {
  const probe = async (command: string, args: string[]): Promise<RunResult> => run(command, args, { env: sealedEnv(env), timeoutMs: 15_000 });
  const git = await probe('git', ['--version']);
  const node = await probe('node', ['--version']);
  const npm = await probe('npm', ['--version']);
  const nodeText = node.stdout.trim();
  return [
    { name: 'git', ok: git.code === 0, detail: git.code === 0 ? git.stdout.trim() : 'git was not found on PATH' },
    {
      name: 'node',
      ok: node.code === 0 && nodeVersionOk(nodeText),
      detail: node.code !== 0 ? 'node was not found on PATH' : nodeVersionOk(nodeText) ? nodeText : `${nodeText} is too old (REA needs ${REA_PIN.node})`,
    },
    { name: 'npm', ok: npm.code === 0, detail: npm.code === 0 ? `npm ${npm.stdout.trim()}` : 'npm was not found on PATH' },
  ];
}

export async function planRea(opts: { userDir: string; run?: Runner; platform?: NodeJS.Platform; repo?: string; commit?: string; env?: NodeJS.ProcessEnv; addon?: AddonSpec | null }): Promise<ReaPlan> {
  const repo = opts.repo ?? REA_PIN.repo;
  const commit = opts.commit ?? REA_PIN.commit;
  const installDir = reaInstallDir(opts.userDir, commit);
  const requirements = await checkRequirements(opts.run ?? systemRunner, opts.env);
  const platform = opts.platform ?? process.platform;
  const addon = opts.addon === undefined ? defaultAddon(platform) : opts.addon;
  return {
    pin: REA_PIN,
    installDir,
    addon: addon ? addonPlan(addon) : null,
    totalDownloadMb: REA_PIN.downloadMb + (addon?.downloadMb ?? 0),
    totalDiskMb: REA_PIN.diskMb + (addon ? 1 : 0),
    steps: planSteps(repo, commit, addon),
    requirements,
    limitations: limitationsFor(platform, fs.existsSync(installDir) ? installDir : null, addon !== null),
    ready: requirements.every((r) => r.ok),
  };
}

export interface ReaManifest {
  id: 'rea';
  commit: string;
  version: string;
  source: string;
  installedAt: string;
  /** The Windows native files taken from the npm package: where from, the registry's integrity value, and each file's sha256. */
  addon?: AddonRecord;
}

export function readManifest(installDir: string): ReaManifest | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(installDir, REA_MANIFEST_FILE), 'utf8')) as Partial<ReaManifest>;
    return m && m.id === 'rea' && typeof m.commit === 'string' && typeof m.version === 'string' ? (m as ReaManifest) : null;
  } catch {
    return null;
  }
}

/** An install is good when its manifest, entry script and compiled server are all there. */
export function isInstalled(userDir: string, commit: string = REA_PIN.commit): boolean {
  const dir = reaInstallDir(userDir, commit);
  return readManifest(dir)?.commit === commit && fs.existsSync(reaEntry(dir)) && fs.existsSync(path.join(dir, 'dist', 'mcp', 'main.js'));
}

export type StepState = 'pending' | 'running' | 'done' | 'failed';
export interface ProgressEvent {
  step: PlanStep['id'] | 'doctor';
  state: StepState;
  detail?: string;
}

export type InstallResult = { ok: true; installDir: string; alreadyInstalled: boolean; manifest: ReaManifest; doctor?: ReaDoctor } | { ok: false; step: PlanStep['id'] | 'setup'; error: string };

export interface InstallOptions {
  userDir: string;
  /** Where to fetch from: the pinned GitHub repository, or a local bare clone in tests. */
  repo?: string;
  commit?: string;
  /** The version `--version` must print. */
  version?: string;
  run?: Runner;
  env?: NodeJS.ProcessEnv;
  /** The npm package whose native files are added (Windows). Null or absent: none. Routes pass {@link defaultAddon}. */
  addon?: AddonSpec | null;
  /** The registry fetch, for tests. */
  fetchFn?: FetchLike;
  platform?: NodeJS.Platform;
  onProgress?: (e: ProgressEvent) => void;
}

/** Install the pinned REA. Never throws: the failing step and its last output come back as `{ ok: false }`. */
export async function installRea(opts: InstallOptions): Promise<InstallResult> {
  const repo = opts.repo ?? REA_PIN.repo;
  const commit = opts.commit ?? REA_PIN.commit;
  const version = opts.version ?? REA_PIN.version;
  const run = opts.run ?? systemRunner;
  const env = sealedEnv(opts.env ?? process.env);
  const addon = opts.addon ?? null;
  const emit = (step: ProgressEvent['step'], state: StepState, detail?: string): void => opts.onProgress?.({ step, state, ...(detail ? { detail } : {}) });
  if (!/^[0-9a-f]{40}$/.test(commit)) return { ok: false, step: 'setup', error: 'The pinned commit must be a full 40-character hash.' };

  const finalDir = reaInstallDir(opts.userDir, commit);
  if (isInstalled(opts.userDir, commit)) {
    const have = readManifest(finalDir)!;
    if (!addon || have.addon) return { ok: true, installDir: finalDir, alreadyInstalled: true, manifest: have };
    return addNativeToInstalled({ opts, addon, run, env, emit, finalDir, have, platform: opts.platform ?? process.platform });
  }

  const root = reaRoot(opts.userDir);
  const work = path.join(root, `.partial-${commit.slice(0, 7)}-${crypto.randomBytes(4).toString('hex')}`);
  const cleanup = (): void => {
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows: the next install removes stale .partial-* folders */
    }
  };
  try {
    fs.mkdirSync(root, { recursive: true });
    /* An earlier interrupted install: stale partials are ours and safe to clear. */
    for (const n of fs.readdirSync(root)) if (n.startsWith('.partial-')) fs.rmSync(path.join(root, n), { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
  } catch (e) {
    return { ok: false, step: 'setup', error: `Could not create ${root}: ${(e as Error).message}` };
  }

  const fail = (step: PlanStep['id'], r: RunResult | string): InstallResult => {
    const error = typeof r === 'string' ? r : `${step} failed (exit ${r.code ?? 'none'}): ${cap(`${r.stderr}\n${r.stdout}`.trim(), 1500)}`;
    emit(step, 'failed', error);
    cleanup();
    return { ok: false, step, error };
  };

  /* 1. fetch the pinned commit and nothing else */
  emit('fetch', 'running');
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', repo], ['fetch', '-q', '--depth', '1', 'origin', commit], ['checkout', '-q', 'FETCH_HEAD']]) {
    const r = await run('git', args, { cwd: work, env });
    if (r.code !== 0) return fail('fetch', r);
  }
  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: work, env });
  if (head.code !== 0 || head.stdout.trim() !== commit) return fail('fetch', `The checkout is at ${head.stdout.trim() || 'an unknown commit'}, not the pinned ${commit}. Nothing was installed.`);
  emit('fetch', 'done');

  /* 2. REA's own lockfile, no install scripts */
  emit('install', 'running');
  const ci = await run('npm', ['ci', '--ignore-scripts'], { cwd: work, env });
  if (ci.code !== 0) return fail('install', ci);
  emit('install', 'done');

  /* 3. the one verified build step */
  emit('build', 'running');
  const build = await run('npm', ['run', 'compile'], { cwd: work, env });
  if (build.code !== 0) return fail('build', build);
  emit('build', 'done');

  /* 4. build tools out again */
  emit('prune', 'running');
  const prune = await run('npm', ['prune', '--omit=dev', '--ignore-scripts'], { cwd: work, env });
  if (prune.code !== 0) return fail('prune', prune);
  emit('prune', 'done');

  /* 4b. Windows: the two native files from the npm package, checked against the registry's integrity value */
  let addonRecord: AddonRecord | undefined;
  if (addon) {
    emit('addon', 'running');
    const added = await installAddon({ spec: addon, targetDir: work, scratchDir: `${work}-addon`, run, env, ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}), onDetail: (d) => emit('addon', 'running', d) });
    if (!added.ok) return fail('addon', added.error);
    addonRecord = added.record;
    emit('addon', 'done');
  }

  /* 5. it starts, and it is the version that was pinned */
  emit('verify', 'running');
  if (!fs.existsSync(reaEntry(work)) || !fs.existsSync(path.join(work, 'dist', 'mcp', 'main.js'))) return fail('verify', 'The build finished but scripts/rea.mjs or dist/mcp/main.js is missing.');
  const ver = await run('node', [reaEntry(work), '--version'], { cwd: work, env, timeoutMs: 60_000 });
  if (ver.code !== 0 || ver.stdout.trim() !== version) return fail('verify', ver.code === 0 ? `REA reports version ${ver.stdout.trim() || '(nothing)'}, not the pinned ${version}.` : ver);
  emit('verify', 'done');

  const manifest: ReaManifest = { id: 'rea', commit, version, source: repo, installedAt: new Date().toISOString(), ...(addonRecord ? { addon: addonRecord } : {}) };
  try {
    fs.rmSync(path.join(work, '.git'), { recursive: true, force: true });
    fs.writeFileSync(path.join(work, REA_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(work, finalDir);
  } catch (e) {
    cleanup();
    return { ok: false, step: 'verify', error: `Could not move the build into ${finalDir}: ${(e as Error).message}` };
  }
  const doctor = await checkDoctor({ installDir: finalDir, run, env, platform: opts.platform ?? process.platform, emit });
  return { ok: true, installDir: finalDir, alreadyInstalled: false, manifest, doctor };
}

/** An install from before the native files were offered: take them now, without redoing the rest. */
async function addNativeToInstalled(a: {
  opts: InstallOptions;
  addon: AddonSpec;
  run: Runner;
  env: NodeJS.ProcessEnv;
  emit: (step: ProgressEvent['step'], state: StepState, detail?: string) => void;
  finalDir: string;
  have: ReaManifest;
  platform: NodeJS.Platform;
}): Promise<InstallResult> {
  const { addon, run, env, emit, finalDir, have } = a;
  const stage = path.join(reaRoot(a.opts.userDir), `.partial-addon-${crypto.randomBytes(4).toString('hex')}`);
  const drop = (): void => {
    try {
      fs.rmSync(stage, { recursive: true, force: true });
    } catch {
      /* cleared by the next install */
    }
  };
  emit('addon', 'running');
  const added = await installAddon({ spec: addon, targetDir: path.join(stage, 'files'), scratchDir: path.join(stage, 'scratch'), run, env, ...(a.opts.fetchFn ? { fetchFn: a.opts.fetchFn } : {}), onDetail: (d) => emit('addon', 'running', d) });
  if (!added.ok) {
    drop();
    emit('addon', 'failed', added.error);
    return { ok: false, step: 'addon', error: added.error };
  }
  const copied: string[] = [];
  try {
    for (const f of addon.files) {
      const dest = path.join(finalDir, ...f.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(stage, 'files', ...f.split('/')), dest);
      copied.push(dest);
    }
    const manifest: ReaManifest = { ...have, addon: added.record };
    const tmp = path.join(finalDir, `${REA_MANIFEST_FILE}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}
`, 'utf8');
    fs.renameSync(tmp, path.join(finalDir, REA_MANIFEST_FILE));
    drop();
    emit('addon', 'done');
    const doctor = await checkDoctor({ installDir: finalDir, run, env, platform: a.platform, emit });
    return { ok: true, installDir: finalDir, alreadyInstalled: false, manifest, doctor };
  } catch (e) {
    for (const c of copied) fs.rmSync(c, { force: true });
    drop();
    const error = `Could not put the native files into ${finalDir}: ${(e as Error).message}`;
    emit('addon', 'failed', error);
    return { ok: false, step: 'addon', error };
  }
}

/** Remove one installed copy. Only ever a direct child of the REA folder, named by a full commit hash. */
export function removeRea(userDir: string, commit: string = REA_PIN.commit): boolean {
  if (!/^[0-9a-f]{40}$/.test(commit)) return false;
  const dir = reaInstallDir(userDir, commit);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/* ---------------------------------------------------------------- registration -- */

/** Where `node` is, as an absolute path (an agent started from a menu may not have the person's PATH). */
export function resolveOnPath(name: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const cand = path.join(dir, name + ext.toLowerCase());
      try {
        if (fs.statSync(cand).isFile()) return cand;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

/** The `.sequence/mcp.json` entry for an installed REA. Pinned to this install by path. */
export function reaMcpEntry(installDir: string, nodePath: string): McpServerConfig {
  return { command: nodePath, args: [reaEntry(installDir), 'mcp'], timeoutMs: 120_000 };
}

export type Registration = { state: 'absent' } | { state: 'ours'; entry: McpServerConfig } | { state: 'other'; entry: McpServerConfig };

/** Whether `.sequence/mcp.json` has a `rea` entry, and whether it points at an install Sequence manages. */
export function reaRegistration(repoRoot: string, userDir: string): Registration {
  const entry = loadMcpConfigFromFile(repoRoot).config.servers[REA_SERVER_NAME];
  if (!entry) return { state: 'absent' };
  const managed = reaRoot(userDir).replace(/\\/g, '/').toLowerCase();
  const target = String(entry.args?.[0] ?? '').replace(/\\/g, '/').toLowerCase();
  return target.startsWith(`${managed}/`) ? { state: 'ours', entry } : { state: 'other', entry };
}

/** Write the `rea` entry. Refuses to replace one the person wrote themselves. */
export function registerRea(repoRoot: string, userDir: string, installDir: string, nodePath: string): { ok: true; path: string } | { ok: false; error: string } {
  const reg = reaRegistration(repoRoot, userDir);
  if (reg.state === 'other') return { ok: false, error: 'Your .sequence/mcp.json already has a server named "rea" that Sequence did not add. Rename or remove it first.' };
  const loaded = loadMcpConfigFromFile(repoRoot);
  const config = { servers: { ...loaded.config.servers, [REA_SERVER_NAME]: reaMcpEntry(installDir, nodePath) } };
  writeMcpConfigDocument(repoRoot, config);
  return { ok: true, path: '.sequence/mcp.json' };
}

/** Remove the `rea` entry, only when it is the one Sequence added. */
export function unregisterRea(repoRoot: string, userDir: string): boolean {
  if (reaRegistration(repoRoot, userDir).state !== 'ours') return false;
  const loaded = loadMcpConfigFromFile(repoRoot);
  const servers = { ...loaded.config.servers };
  delete servers[REA_SERVER_NAME];
  writeMcpConfigDocument(repoRoot, { servers });
  return true;
}

/**
 * REA as a server in a chat agent's session: only when it is installed here AND registered by the Add REA button
 * (so a person who never clicked it gets nothing added), with REA's read-only tools pre-approved and nothing else.
 */
export function reaAgentServer(repoRoot: string | null, userDir: string, commit: string = REA_PIN.commit): { name: string; command: string; args: string[]; allowTools: string[] } | null {
  if (!repoRoot || !isInstalled(userDir, commit)) return null;
  const reg = reaRegistration(repoRoot, userDir);
  if (reg.state !== 'ours') return null;
  return { name: REA_SERVER_NAME, command: reg.entry.command, args: [...(reg.entry.args ?? [])], allowTools: reaAgentToolNames() };
}

/** What the Settings row shows. */
export interface ReaStatus {
  installed: boolean;
  version: string | null;
  commit: string | null;
  installDir: string;
  registration: Registration['state'];
  /** Disk use of the install, in whole megabytes, when installed. */
  sizeMb: number | null;
  /** The npm package's native files: in the install, or missing from an install made before they were offered. Null off Windows. */
  addon: 'present' | 'missing' | null;
  /** What `rea doctor --json` said after the last Start, in plain words; null before the first check. */
  doctor: ReaDoctor | null;
}

function dirBytes(dir: string, depth = 0): number {
  if (depth > 12) return 0;
  let total = 0;
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const n of names) {
    const p = path.join(dir, n.name);
    try {
      if (n.isDirectory()) total += dirBytes(p, depth + 1);
      else if (n.isFile()) total += fs.statSync(p).size;
    } catch {
      /* skip */
    }
  }
  return total;
}

export function reaStatus(repoRoot: string | null, userDir: string, commit: string = REA_PIN.commit, platform: NodeJS.Platform = process.platform): ReaStatus {
  const installDir = reaInstallDir(userDir, commit);
  const installed = isInstalled(userDir, commit);
  const manifest = installed ? readManifest(installDir) : null;
  return {
    installed,
    version: manifest?.version ?? null,
    commit: manifest?.commit ?? null,
    installDir,
    registration: repoRoot ? reaRegistration(repoRoot, userDir).state : 'absent',
    sizeMb: installed ? Math.round(dirBytes(installDir) / 1_000_000) : null,
    addon: installed && defaultAddon(platform) ? (manifest?.addon ? 'present' : 'missing') : null,
    doctor: installed ? readDoctor(installDir) : null,
  };
}
