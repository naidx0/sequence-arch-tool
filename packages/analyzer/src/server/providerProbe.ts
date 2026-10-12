/**
 * First-run provider probe: which coding agents are installed, and are they
 * signed in? Read-only, no typing required from the user.
 *
 * WHAT IT READS, AND WHAT IT NEVER READS.
 *
 * Sign-in state comes ONLY from each vendor's own status command
 * (`claude auth status --json`, `codex login status`). This module never opens
 * `~/.claude/.credentials.json`, `~/.codex/auth.json` or any keychain item, and
 * never reads or stores a token. The status output can carry the account email;
 * that is dropped here, field by field, so it never reaches the API. A plan
 * label ("ChatGPT", "Claude Max") is kept because it tells the user which
 * account is in use without identifying them.
 *
 * HOW IT SPAWNS. On Windows the npm-installed CLIs are `.cmd` shims, which Node
 * refuses to start without a shell (CVE-2024-27980, EINVAL). The policy is the
 * one {@link spawnVerifyBin} in `harness/verifyGate.ts` established and measured:
 * spawn directly with `shell: false`, and only when the process could not START
 * ({@link isSpawnLookupFailure}) retry through `cmd.exe /d /s /c` in argv form.
 * That helper is synchronous; the probes here must run in parallel under one
 * wall-clock cap, so this is the same two-step policy over the async `spawn`.
 * Every argument is a constant from {@link PROVIDER_SPECS}: nothing a caller
 * sends ever reaches a command line.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSpawnLookupFailure } from '../harness/verifyGate.js';
import { bridgeSourceDisabled, bundledBridgePath, compareVersions, defaultClaudeDirs, launcherPath, MIN_CLAUDE_VERSION, resolveClaudeExecutable } from './claudeCli.js';
import { createBridgeProvisioner, megabytes, type BridgeProvisioner } from './claudeBridgeInstall.js';
import { userStoreDir } from './store.js';
import { cmdShimArgs, launchForResolved, nodeForShim, pathKey, resolveBinary, searchDirs, windowsShimTarget } from './binResolve.js';

/* The resolution helpers moved to binResolve.ts (the bundled Claude bridge shares them); these names stay importable from here. */
export { cmdShimArgs, launchForResolved, nodeForShim, pathKey, resolveBinary, searchDirs, windowsShimTarget };

/**
 * Round 7 (A4): `adapter` is a signed-in Claude Code with no ACP bridge
 * (claude-agent-acp). Sequence cannot drive it yet, so it is not Ready.
 */
export type ProviderState = 'checking' | 'install' | 'signIn' | 'ready' | 'adapter' | 'limited' | 'attention' | 'preparing' | 'update';

export interface ProviderStatus {
  id: string;
  label: string;
  installed: boolean;
  /** Bare version number (`2.1.280`), or null when it could not be read. */
  version: string | null;
  state: ProviderState;
  /** The vendor's own sign-in command, for the UI to open in its Terminal. */
  signInCommand: string;
  /** The official install command. */
  installHint: string;
  /** Account kind ("ChatGPT", "Claude Max"); never an email address. */
  plan?: string;
  /**
   * Set whenever the CLI is installed but its bridge is missing, whatever the
   * sign-in state: the command the Install bridge button runs (global npm
   * install of the bridge). On state `adapter` (signed in) it is the only step
   * left; on `signIn` the card offers bridge and sign-in as one step.
   */
  adapterInstall?: string;
  /** The bridge Sequence will drive the CLI with: shipped inside the app, or one the person installed globally. Absent when there is none. */
  bridge?: 'bundled' | 'downloaded' | 'global';
  /** State `preparing`: the bridge is being fetched; compressed bytes so far ("Setting up Claude… 12 MB"). */
  setupBytes?: number;
  /** The first-use download failed (the reason); the global install is offered instead. */
  setupError?: string;
  /** State `update`: the oldest `claude` Sequence drives (the card says "Update Claude Code"). */
  minVersion?: string;
  /** Round 13: the bridge is missing, whatever the sign-in state, so first run can show both steps up front. */
  bridgeMissing?: boolean;
  /** State `limited`: signed in, but its usage limit is spent until this time (epoch ms), from the last failed turn. */
  limitResetsAt?: number;
}

export interface ProvidersResponse {
  providers: ProviderStatus[];
}

/** What a vendor status command said, reduced to the two facts we keep. */
export interface SignInReading {
  loggedIn: boolean;
  plan?: string;
}

export interface ProviderSpec {
  id: string;
  label: string;
  /** Binary name, without extension. */
  bin: string;
  versionArgs: readonly string[];
  statusArgs: readonly string[];
  /** Null = the output could not be understood (state `attention`). */
  parseStatus: (stdout: string, stderr: string, exitCode: number | null) => SignInReading | null;
  signInCommand: string;
  installHint: string;
  /**
   * Round 7 (A4): a bridge Sequence needs beside the CLI to drive it as an
   * agent. Claude Code is driven over ACP through claude-agent-acp; its bins
   * are the ones agentLaunch looks for, and `npmPackage` is what Install
   * bridge installs globally.
   */
  adapter?: { bins: readonly string[]; npmPackage: string };
}

/**
 * The npm package that provides the `claude-agent-acp` bin (github.com/
 * agentclientprotocol/claude-agent-acp). The older `claude-code-acp` bin is
 * still accepted if it is already installed.
 */
export const CLAUDE_ACP_PACKAGE = '@agentclientprotocol/claude-agent-acp';

/**
 * A plan label is letters, spaces, `_` and `-` only, and short. Anything else
 * (an email, a key fragment, an org name with digits) is dropped, not trimmed.
 */
function safePlan(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z][A-Za-z _-]{0,29}$/.test(s)) return undefined;
  return s;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * `claude auth status --json`. Signed out exits 1 but still prints the JSON
 * (measured: `{"loggedIn": false, "authMethod": "none", ...}`), so the exit code
 * is not the verdict; the parsed `loggedIn` field is.
 */
export function parseClaudeStatus(stdout: string): SignInReading | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let j: unknown;
  try {
    j = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const r = j as Record<string, unknown>;
  if (typeof r.loggedIn !== 'boolean') return null;
  if (!r.loggedIn) return { loggedIn: false };
  // Whitelisted fields only. `email` and anything else are never copied.
  const sub = r.subscriptionType ?? (r.subscription as Record<string, unknown> | undefined)?.type;
  let plan: string | undefined;
  if (typeof sub === 'string' && sub.trim() !== '') plan = safePlan(`Claude ${titleCase(sub.trim())}`);
  else if (typeof r.apiProvider === 'string' && r.apiProvider !== 'firstParty') plan = safePlan(titleCase(r.apiProvider));
  else if (typeof r.authMethod === 'string' && /api.?key/i.test(r.authMethod)) plan = 'API key';
  return plan ? { loggedIn: true, plan } : { loggedIn: true };
}

/**
 * `codex login status`. Prints e.g. "Logged in using ChatGPT", sometimes on
 * stderr, and "Not logged in" when signed out.
 */
export function parseCodexStatus(stdout: string, stderr: string): SignInReading | null {
  const text = `${stdout}\n${stderr}`;
  if (/not\s+logged\s+in/i.test(text)) return { loggedIn: false };
  if (!/logged\s+in/i.test(text)) return null;
  // Whitelisted labels only: the API-key form prints a masked key fragment
  // ("Logged in using an API key - sk-proj-***abc"), which must not travel.
  if (/logged\s+in\s+using\s+chatgpt/i.test(text)) return { loggedIn: true, plan: 'ChatGPT' };
  if (/logged\s+in\s+using\s+(?:an?\s+)?api\s*key/i.test(text)) return { loggedIn: true, plan: 'API key' };
  return { loggedIn: true };
  return null;
}

export const PROVIDER_SPECS: readonly ProviderSpec[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    versionArgs: ['--version'],
    statusArgs: ['auth', 'status', '--json'],
    parseStatus: (out) => parseClaudeStatus(out),
    signInCommand: 'claude auth login',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    adapter: { bins: ['claude-agent-acp', 'claude-code-acp'], npmPackage: CLAUDE_ACP_PACKAGE },
  },
  {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    versionArgs: ['--version'],
    statusArgs: ['login', 'status'],
    parseStatus: (out, err) => parseCodexStatus(out, err),
    signInCommand: 'codex login',
    installHint: 'npm install -g @openai/codex',
  },
];

/** `2.1.280 (Claude Code)` -> `2.1.280`; `codex-cli 0.153.4` -> `0.153.4`. */
export function parseVersion(stdout: string): string | null {
  const m = /\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/.exec(stdout);
  return m ? m[0] : null;
}

interface RunResult {
  started: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runOnce(
  cmd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  verbatim = false,
): Promise<RunResult & { lookupFailure: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    // Declared before `finish`: spawn() can throw synchronously (EINVAL for a
    // `.cmd` on Windows) before any timer exists.
    let timer: NodeJS.Timeout | undefined;
    const finish = (r: RunResult & { lookupFailure: boolean }): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, [...args], { env, shell: false, windowsHide: true, windowsVerbatimArguments: verbatim, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ started: false, lookupFailure: isSpawnLookupFailure(err), code: null, stdout: '', stderr: '', timedOut: false });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish({ started: true, lookupFailure: false, code: null, stdout, stderr, timedOut: true });
    }, Math.max(1, timeoutMs));
    child.stdout?.setEncoding('utf8').on('data', (c: string) => {
      if (stdout.length < 64_000) stdout += c;
    });
    child.stderr?.setEncoding('utf8').on('data', (c: string) => {
      if (stderr.length < 64_000) stderr += c;
    });
    child.on('error', (err) => {
      finish({ started: false, lookupFailure: isSpawnLookupFailure(err), code: null, stdout, stderr, timedOut });
    });
    child.on('close', (code) => {
      finish({ started: true, lookupFailure: false, code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Async twin of `spawnVerifyBin`: direct spawn first, and on Windows only a
 * failure to START falls back to {@link launchForResolved}: the shim's own
 * target, else cmd.exe running the shim by its ABSOLUTE path. A command that
 * started and failed is never retried. Never the bare name: cmd.exe looks in
 * the current directory first, so a `claude.bat` in the repo the app was
 * started from would run in place of the real CLI (the hole sign-in and launch
 * already closed).
 */
export async function spawnBinAsync(
  resolved: string,
  _bareName: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  dirs: readonly string[] = [],
): Promise<RunResult> {
  const t0 = Date.now();
  const direct = await runOnce(resolved, args, env, timeoutMs);
  if (!direct.lookupFailure || process.platform !== 'win32') return direct;
  const left = timeoutMs - (Date.now() - t0);
  const l = launchForResolved(resolved, args, dirs, env);
  return runOnce(l.command, l.args, env, left, l.verbatim === true);
}

export interface ProbeOptions {
  /** PATH value to search (defaults to the server's own). */
  pathValue?: string;
  /** Extra install dirs searched after PATH. Defaults to ~/.local/bin and ~/.claude/local. */
  extraDirs?: readonly string[];
  specs?: readonly ProviderSpec[];
  /** Total wall-clock cap for one probe round. */
  capMs?: number;
  /** How long a complete result is served from cache. */
  cacheMs?: number;
  /**
   * The bundled Claude bridge file: a path, null for "this install has none", or absent to look
   * for it beside the server (bundledBridgePath). A test seam, and SEQUENCE_CLAUDE_BRIDGE for the rest.
   */
  bundledBridge?: string | null;
  /**
   * Fetches the bridge on first use. Absent = the process-wide one in the user-data folder (unless
   * SEQUENCE_CLAUDE_BRIDGE is set, which means "use this file or none"); null = never download.
   */
  bridgeProvisioner?: BridgeProvisioner | null;
}

let defaultProvisioner: BridgeProvisioner | undefined;
function provisionerFor(opts: Pick<ProbeOptions, 'bridgeProvisioner'>): BridgeProvisioner | null {
  if (opts.bridgeProvisioner !== undefined) return opts.bridgeProvisioner;
  if (bridgeSourceDisabled() || process.env.SEQUENCE_CLAUDE_BRIDGE_DOWNLOAD === '0') return null;
  return (defaultProvisioner ??= createBridgeProvisioner({ dir: path.join(userStoreDir(), 'claude-bridge') }));
}

/** Where `claude` is searched for the bridge: exactly what the bridge process itself will search (claudeCli.defaultClaudeDirs), not the probe's learned npm dirs. */
interface ClaudeSearch {
  pathValue: string;
  extraDirs: readonly string[];
}

type BridgeChoice =
  | { kind: 'bundled'; args: string[] }
  | { kind: 'downloaded'; args: string[] }
  | { kind: 'global' }
  | { kind: 'fetching'; bytes: number }
  | { kind: 'failed'; error: string }
  | { kind: 'none' };

/**
 * Which bridge drives the person's `claude`, in order: the full bundle (flag builds), the downloaded
 * and verified one, a bridge they installed globally, else fetch one. The first two need a `claude` the
 * SDK can start (they run it); `start` false = look only (agent launch), true = begin the download.
 */
function chooseBridge(opts: Pick<ProbeOptions, 'bundledBridge' | 'bridgeProvisioner'>, search: ClaudeSearch, env: NodeJS.ProcessEnv, globalBridge: boolean, start: boolean): BridgeChoice {
  const claude = resolveClaudeExecutable({ pathValue: search.pathValue, extraDirs: search.extraDirs, env });
  if (claude) {
    const bundle = opts.bundledBridge === undefined ? bundledBridgePath(env) : opts.bundledBridge;
    if (bundle) return { kind: 'bundled', args: [bundle] };
    const prov = provisionerFor(opts);
    const entry = prov?.entry();
    const launcher = launcherPath();
    if (prov && entry && launcher) return { kind: 'downloaded', args: [launcher, entry] };
    if (globalBridge) return { kind: 'global' };
    if (prov && launcher) {
      if (start) prov.start();
      const s = prov.status();
      if (s.state === 'failed') return { kind: 'failed', error: s.error ?? 'the download failed' };
      return { kind: 'fetching', bytes: s.receivedBytes };
    }
    return { kind: 'none' };
  }
  return globalBridge ? { kind: 'global' } : { kind: 'none' };
}

/**
 * npm's global bin dirs learned this process (`npm prefix -g` after a bridge
 * install). The install lands there, and that dir need not be on the
 * server's PATH (%APPDATA%\npm, an nvm or custom prefix): without it the probe
 * would still say the bridge is missing right after installing it.
 */
const learnedBinDirs = new Set<string>();

/** Add a dir to the default search (after PATH and the vendor dirs), for the life of the process. */
export function rememberBinDir(dir: string): void {
  if (dir.trim() !== '') learnedBinDirs.add(dir);
}

function defaultExtraDirs(): string[] {
  return [...defaultClaudeDirs(), ...learnedBinDirs];
}

function initialStatus(spec: ProviderSpec): ProviderStatus {
  return {
    id: spec.id,
    label: spec.label,
    installed: false,
    version: null,
    state: 'checking',
    signInCommand: spec.signInCommand,
    installHint: spec.installHint,
  };
}

/**
 * Probe one provider, writing each fact into `out` as soon as it is known so a
 * caller that stops waiting at the cap still gets what is settled.
 */
async function probeOne(
  spec: ProviderSpec,
  out: ProviderStatus,
  dirs: readonly string[],
  env: NodeJS.ProcessEnv,
  deadline: number,
  search: ClaudeSearch,
  bridgeOpts: Pick<ProbeOptions, 'bundledBridge' | 'bridgeProvisioner'>,
): Promise<void> {
  const resolved = resolveBinary(spec.bin, dirs, env);
  if (!resolved) {
    out.state = 'install';
    return;
  }
  const ver = await spawnBinAsync(resolved, spec.bin, spec.versionArgs, env, deadline - Date.now(), dirs);
  if (!ver.started) {
    out.state = 'install';
    return;
  }
  out.installed = true;
  out.version = ver.code === 0 ? parseVersion(ver.stdout) : null;
  const st = await spawnBinAsync(resolved, spec.bin, spec.statusArgs, env, deadline - Date.now(), dirs);
  const reading = st.started && !st.timedOut ? spec.parseStatus(st.stdout, st.stderr, st.code) : null;
  if (!reading) {
    /* Claude Code before 2.1.40 has no `auth status --json`: say what to do, not "did not answer cleanly". */
    if (spec.id === 'claude' && st.started && /unknown option[^\n]*--json|--json[^\n]*unknown option/i.test(`${st.stdout}\n${st.stderr}`)) {
      out.state = 'update';
      out.minVersion = MIN_CLAUDE_VERSION;
      return;
    }
    out.state = 'attention';
    return;
  }
  if (reading.plan) out.plan = reading.plan;
  out.state = reading.loggedIn ? 'ready' : 'signIn';
  /* Signed in is not Ready when Sequence cannot drive it: no bridge, no agent. The bridge that ships
     inside the app counts as present whenever the person's own `claude` can be started for it, so a
     signed-in Claude is Ready with no install step. Otherwise a globally installed bridge counts; with
     neither, the bridge is looked for whatever the sign-in state, so a signed-out Claude Code is told
     about both steps at once (round 13): `bridgeMissing` says so, and `adapterInstall` is the command
     the one button runs. */
  /* The bundled and downloaded bridges run the person's own `claude`, and only a recent one. A bridge they
     installed globally brings its own Claude binary, so it is not held to this floor. */
  if (spec.id === 'claude' && (out.state === 'ready' || out.state === 'signIn') && out.version && compareVersions(out.version, MIN_CLAUDE_VERSION) < 0 && !(spec.adapter && spec.adapter.bins.some((b) => resolveBinary(b, dirs, env)))) {
    out.state = 'update';
    out.minVersion = MIN_CLAUDE_VERSION;
    return;
  }
  if ((out.state === 'ready' || out.state === 'signIn') && spec.adapter) {
    const global = spec.adapter.bins.some((b) => resolveBinary(b, dirs, env));
    const choice = chooseBridge(bridgeOpts, search, env, global, true);
    if (choice.kind === 'bundled' || choice.kind === 'downloaded') {
      out.bridge = choice.kind;
    } else if (choice.kind === 'global') {
      out.bridge = 'global';
    } else if (choice.kind === 'fetching') {
      /* Nothing to click: the fetch is under way. A signed-out card still offers Sign in meanwhile. */
      out.setupBytes = choice.bytes;
      if (out.state === 'ready') out.state = 'preparing';
    } else {
      if (choice.kind === 'failed') out.setupError = choice.error;
      out.bridgeMissing = true;
      out.adapterInstall = `npm install -g ${spec.adapter.npmPackage}`;
      if (out.state === 'ready') out.state = 'adapter';
    }
  }
}

export interface ProviderProbe {
  get(refresh?: boolean): Promise<ProvidersResponse>;
  /** Forget the cached round (something on the machine changed, e.g. a bridge was installed). */
  invalidate?(): void;
  /** Search this dir too from the next round on (npm's global bin after a bridge install). */
  addSearchDir?(dir: string): void;
}

/**
 * A probe with its own cache. A complete round is cached for `cacheMs`; a round
 * cut off by the cap is returned with `checking` entries and NOT cached as
 * final: it keeps running, and the next call reuses it instead of spawning a
 * second set of processes.
 */
export function createProviderProbe(opts: ProbeOptions = {}): ProviderProbe {
  const capMs = opts.capMs ?? 3000;
  const cacheMs = opts.cacheMs ?? 30_000;
  const specs = opts.specs ?? PROVIDER_SPECS;
  let cached: { at: number; value: ProvidersResponse } | null = null;
  let inflight: { done: Promise<void>; statuses: ProviderStatus[] } | null = null;
  const added: string[] = [];

  function start(): { done: Promise<void>; statuses: ProviderStatus[] } {
    const baseEnv = { ...process.env };
    const key = pathKey(baseEnv);
    const pathValue = opts.pathValue ?? baseEnv[key] ?? '';
    const dirs = searchDirs(pathValue, [...(opts.extraDirs ?? defaultExtraDirs()), ...added]);
    const env: NodeJS.ProcessEnv = { ...baseEnv, [key]: dirs.join(path.delimiter) };
    const deadline = Date.now() + capMs;
    const statuses = specs.map(initialStatus);
    const round = {
      statuses,
      done: Promise.all(
        specs.map((s, i) =>
          // A probe that crashed proves nothing about installation: say so.
          probeOne(s, statuses[i], dirs, env, deadline, { pathValue: opts.pathValue ?? baseEnv[key] ?? '', extraDirs: opts.extraDirs ?? defaultClaudeDirs(baseEnv) }, opts).catch(() => {
            statuses[i].state = 'attention';
          }),
        ),
      ).then(() => {
        /* A download under way changes every second: never serve it from the cache. */
        cached = statuses.some((x) => x.state === 'preparing') ? null : { at: Date.now(), value: snapshot(statuses) };
        if (inflight === round) inflight = null;
      }),
    };
    return round;
  }

  return {
    invalidate() {
      cached = null;
      inflight = null;
    },
    addSearchDir(dir) {
      if (dir.trim() !== '' && !added.includes(dir)) added.push(dir);
    },
    async get(refresh = false) {
      if (!refresh && cached && Date.now() - cached.at < cacheMs) return cached.value;
      if (refresh || !inflight) inflight = start();
      const round = inflight;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        round.done,
        new Promise<void>((r) => {
          timer = setTimeout(r, capMs);
        }),
      ]);
      clearTimeout(timer);
      return snapshot(round.statuses);
    },
  };
}

function snapshot(statuses: readonly ProviderStatus[]): ProvidersResponse {
  return { providers: statuses.map((s) => ({ ...s })) };
}

/** The process-wide probe the HTTP route uses. */
export const defaultProviderProbe: ProviderProbe = createProviderProbe();

/** How to start a provider's own sign-in command in a terminal. */
export interface SignInLaunch {
  /** The executable to spawn (the resolved binary, or cmd.exe for a Windows shim). */
  file: string;
  args: string[];
  /** The environment, with PATH widened to the vendor install dirs. */
  env: NodeJS.ProcessEnv;
  /** The command as the vendor documents it (`claude auth login`), for display. */
  command: string;
  /** Spawn with windowsVerbatimArguments: `args` is cmd.exe's `/s /c` line, quoted already. */
  verbatim?: true;
}

/**
 * The sign-in launch for provider `id`, or null when the id is unknown or the
 * binary is not installed. The command comes from {@link PROVIDER_SPECS} and
 * never from the caller: a client names a provider, not a command line.
 * Nothing here reads a credential; the vendor's own CLI does the sign-in.
 */
export function signInLaunch(id: string, opts: Pick<ProbeOptions, 'pathValue' | 'extraDirs' | 'specs'> = {}): SignInLaunch | null {
  const spec = (opts.specs ?? PROVIDER_SPECS).find((s) => s.id === id);
  if (!spec) return null;
  const [bin, ...args] = spec.signInCommand.split(/\s+/);
  if (bin !== spec.bin) return null;
  const baseEnv = { ...process.env };
  const key = pathKey(baseEnv);
  const dirs = searchDirs(opts.pathValue ?? baseEnv[key] ?? '', opts.extraDirs ?? defaultExtraDirs());
  const env: NodeJS.ProcessEnv = { ...baseEnv, [key]: dirs.join(path.delimiter) };
  const resolved = resolveBinary(spec.bin, dirs, env);
  if (!resolved) return null;
  /* An npm shim cannot be started directly: start what it wraps, by absolute path (S-new2). */
  const l = launchForResolved(resolved, args, dirs, env);
  /* Sequence's own Electron flag reaches the sign-in only when Sequence.exe is the node running it. */
  if (!(process.versions.electron && l.command === process.execPath)) delete env.ELECTRON_RUN_AS_NODE;
  return { file: l.command, args: l.args, env, command: spec.signInCommand, ...(l.verbatim ? { verbatim: true } : {}) };
}

/** How Sequence drives a detected provider as an agent (the registry entry `sequence agent add` writes). */
export type AgentLaunch =
  | { ok: true; command: string; args: string[]; label: string }
  | { ok: false; reason: 'unknown' | 'install' | 'adapter'; message: string };

/** The Claude Code ACP adapters, in the order they are looked for. */
export const CLAUDE_ACP_BINS = ['claude-agent-acp', 'claude-code-acp'] as const;

export { defaultExtraDirs };

/**
 * The launch for provider `id`, found on this machine, or why there is none.
 *
 * Codex is driven over its own `codex app-server`, so the entry is the codex
 * binary itself; an npm `.cmd` shim cannot be spawned directly, so on Windows
 * the entry is node plus the package's own `bin/codex.js` next to the shim
 * (the launch `agentKindOf` already reads as the codex CLI). Claude Code is
 * driven over ACP, which needs its bridge (`claude-agent-acp`) installed;
 * without it there is nothing to register, and the answer says so rather than
 * downloading anything. The command comes from here, never from the caller.
 */
export function agentLaunch(id: string, opts: Pick<ProbeOptions, 'pathValue' | 'extraDirs' | 'specs' | 'bundledBridge' | 'bridgeProvisioner'> = {}): AgentLaunch {
  const spec = (opts.specs ?? PROVIDER_SPECS).find((s) => s.id === id);
  if (!spec) return { ok: false, reason: 'unknown', message: `unknown provider '${id}'` };
  const baseEnv = { ...process.env };
  const key = pathKey(baseEnv);
  const dirs = searchDirs(opts.pathValue ?? baseEnv[key] ?? '', opts.extraDirs ?? defaultExtraDirs());
  const env: NodeJS.ProcessEnv = { ...baseEnv, [key]: dirs.join(path.delimiter) };
  if (id === 'codex') {
    const resolved = resolveBinary(spec.bin, dirs, env);
    if (!resolved) return { ok: false, reason: 'install', message: `${spec.label} is not installed (${spec.installHint})` };
    if (/\.(cmd|bat)$/i.test(resolved)) {
      const js = path.join(path.dirname(resolved), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (!fs.existsSync(js)) return { ok: false, reason: 'install', message: `found ${resolved} but not the package it starts (${js})` };
      return { ok: true, command: nodeForShim(resolved, dirs, env), args: [js], label: spec.label };
    }
    return { ok: true, command: resolved, args: [], label: spec.label };
  }
  if (id === 'claude') {
    /* The bridge shipped inside the app, run by this process's own node (Sequence.exe under
       ELECTRON_RUN_AS_NODE, which the agent spawn keeps for exactly this command: acp agentSpawnEnv).
       The bundle finds the person's own `claude` itself when it starts, so the registry entry stays
       two plain fields and never goes stale when `claude` moves. A global bridge is the fallback. */
    const choice = chooseBridge(opts, { pathValue: opts.pathValue ?? baseEnv[key] ?? '', extraDirs: opts.extraDirs ?? defaultClaudeDirs(baseEnv) }, env, false, false);
    if (choice.kind === 'bundled' || choice.kind === 'downloaded') return { ok: true, command: process.execPath, args: choice.args, label: spec.label };
    for (const bin of CLAUDE_ACP_BINS) {
      const resolved = resolveBinary(bin, dirs, env);
      if (!resolved) continue;
      /* A Windows shim: node + the bridge's own JS entry, by absolute path (S-new2), like codex. */
      const l = launchForResolved(resolved, [], dirs, env);
      /* A shim that is not a known template: the registry entry cannot carry cmd.exe's verbatim line, so say so. */
      if (l.verbatim) return { ok: false, reason: 'adapter', message: `found ${resolved}, but it is not an npm or pnpm shim Sequence can start safely; reinstall the bridge with npm` };
      return { ok: true, command: l.command, args: l.args, label: spec.label };
    }
    return { ok: false, reason: 'adapter', message: choice.kind === 'fetching' ? `${spec.label} is still being set up` : `${spec.label} needs its bridge (claude-agent-acp) on PATH` };
  }
  return { ok: false, reason: 'unknown', message: `no agent launch is known for '${id}'` };
}
