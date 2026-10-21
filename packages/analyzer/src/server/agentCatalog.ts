/**
 * The PLUG-AND-PLAY AGENT CATALOG: every coding agent that speaks ACP, one
 * click to connect, no code per agent.
 *
 * Before this, Sequence could drive exactly two agents (Claude Code and Codex),
 * each hand-wired in providerProbe.ts. The Agent Client Protocol now has a
 * public registry (github.com/agentclientprotocol/registry, served at
 * {@link ACP_REGISTRY_URL}) that Zed and JetBrains install agents from: each
 * entry says how to start the agent in ACP mode (`npx <pkg> --acp`,
 * `uvx <pkg>`, or a binary plus args). Sequence already drives any ACP agent
 * through `@sequence/acp`'s AcpClient (agentKindOf → 'other'), so the only
 * missing piece was knowing the launch line. This module reads the registry
 * FORMAT, from three sources merged by id (a later source wins):
 *
 *   1. {@link BUILTIN_CATALOG}: a snapshot of the registry shipped in the app,
 *      so the catalog works offline (local-first: no network at boot);
 *   2. the published registry, fetched only when a person presses Refresh and
 *      cached in the user store ({@link REGISTRY_CACHE_FILE});
 *   3. the person's own entries in `~/.sequence/agent-catalog.json`, in the
 *      same format: a custom or in-house agent plugs in with no code change.
 *
 * HOW AN ENTRY BECOMES A LAUNCH ({@link resolveCatalogLaunch}), in order:
 *   - its CLI is already on this machine (PATH or the vendor dirs): run that,
 *     with the registry's ACP args. The person's own install is the one they
 *     signed in to;
 *   - it ships on npm and `npx` is here: `npx -y <pkg@version> <args>`, so the
 *     agent runs with NOTHING to install first;
 *   - it ships on PyPI and `uvx` is here: `uvx <pkg> <args>`;
 *   - otherwise it is not runnable here, and the answer says how to get it.
 *
 * SAFETY. The browser only ever names a catalog id; the command line comes
 * from the catalog, never from the request (the rule acpRoutes' connect
 * already keeps). The catalog file is the person's own, under their home.
 * Nothing here reads a credential: an agent that needs a sign-in asks for it
 * through its own CLI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { launchForResolved, nodeForShim, pathKey, resolveBinary, searchDirs } from './binResolve.js';
import { readUserJson, writeUserJson } from './store.js';
import { SNAPSHOT_BINARIES } from './agentCatalogSnapshot.js';

/** The published ACP registry (README of agentclientprotocol/registry). */
export const ACP_REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
/** The person's own catalog entries, registry format: `{ "agents": [ ... ] }`. */
export const USER_CATALOG_FILE = 'agent-catalog.json';
/** The last registry a Refresh fetched. */
export const REGISTRY_CACHE_FILE = 'agent-registry-cache.json';

/** One platform's binary in a registry entry. */
export interface RegistryBinary {
  archive?: string;
  /** The archive's sha256 (hex). An install refuses an archive without one, or one that does not match. */
  sha256?: string;
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
}

/** An entry in the ACP registry format (registry FORMAT.md), plus Sequence's optional `bins` hint. */
export interface CatalogAgent {
  id: string;
  name: string;
  description?: string;
  version?: string;
  website?: string;
  repository?: string;
  distribution: {
    npx?: { package: string; args?: string[]; env?: Record<string, string> };
    uvx?: { package: string; args?: string[]; env?: Record<string, string> };
    binary?: Record<string, RegistryBinary>;
  };
  /**
   * Sequence's extension: the CLI names to look for on this machine, with the
   * args that start ACP mode. Derived when absent (see {@link localCandidates}).
   */
  bins?: { name: string; args: string[] }[];
}

export type CatalogSource = 'builtin' | 'registry' | 'user';

/**
 * Ids the registry carries for agents providerProbe.ts already drives with
 * their own sign-in flow (Claude Code's bridge, Codex's app-server). The
 * catalog leaves them to that flow instead of offering a second Claude.
 */
const HANDLED_ELSEWHERE = new Set(['claude-acp', 'codex-acp', 'claude', 'codex']);

/** The CLI an npm package installs, where it is not the package's own name. */
const NPM_BIN: Record<string, string> = {
  '@google/gemini-cli': 'gemini',
  '@qwen-code/qwen-code': 'qwen',
  '@github/copilot': 'copilot',
  '@augmentcode/auggie': 'auggie',
  '@kilocode/cli': 'kilo',
  '@ibm/bob': 'bob',
  '@tencent-ai/codebuddy-code': 'codebuddy',
  '@qoder-ai/qodercli': 'qodercli',
  '@xai-official/grok': 'grok',
  '@minimax-ai/code': 'minimax',
  'dirac-cli': 'dirac',
};

/**
 * A snapshot of the ACP registry (v1.0.0, read 2026-10-16), trimmed to the
 * agents people most often have, plus Hermes Agent, which speaks ACP
 * (`hermes acp`, verified on this machine) but is not in the registry. A
 * Refresh replaces these with the live registry; nothing else depends on the
 * versions pinned here.
 */
export const BUILTIN_CATALOG: readonly CatalogAgent[] = [
  { id: 'gemini', name: 'Gemini CLI', description: "Google's official CLI for Gemini", version: '0.64.0', website: 'https://geminicli.com', distribution: { npx: { package: '@google/gemini-cli@0.64.0', args: ['--acp'] } } },
  { id: 'opencode', name: 'OpenCode', description: 'The open source coding agent', version: SNAPSHOT_BINARIES.opencode!.version, website: 'https://opencode.ai', distribution: { binary: SNAPSHOT_BINARIES.opencode!.binary } },
  { id: 'github-copilot-cli', name: 'Copilot', description: "GitHub's AI pair programmer", version: '1.0.98', website: 'https://github.com/features/copilot/cli/', distribution: { npx: { package: '@github/copilot@1.0.98', args: ['--acp'] } } },
  { id: 'cursor', name: 'Cursor', description: "Cursor's coding agent", website: 'https://cursor.com/docs/cli/acp', distribution: { binary: { any: { cmd: './cursor-agent', args: ['acp'] } } } },
  { id: 'goose', name: 'goose', description: 'A local, extensible, open source AI agent', version: SNAPSHOT_BINARIES.goose!.version, website: 'https://block.github.io/goose/', distribution: { binary: SNAPSHOT_BINARIES.goose!.binary } },
  { id: 'qwen-code', name: 'Qwen Code', description: "Alibaba's Qwen coding assistant", version: '0.25.2', website: 'https://qwenlm.github.io/qwen-code-docs/en/users/overview', distribution: { npx: { package: '@qwen-code/qwen-code@0.25.2', args: ['--acp', '--experimental-skills'] } } },
  { id: 'cline', name: 'Cline', description: 'Autonomous coding agent CLI', version: '3.0.71', website: 'https://cline.bot/cli', distribution: { npx: { package: 'cline@3.0.71', args: ['--acp'] } } },
  { id: 'kimi', name: 'Kimi CLI', description: "Moonshot AI's coding assistant", version: SNAPSHOT_BINARIES.kimi!.version, website: 'https://moonshotai.github.io/kimi-cli/', distribution: { binary: SNAPSHOT_BINARIES.kimi!.binary } },
  { id: 'auggie', name: 'Auggie', description: "Augment Code's coding agent", version: '0.36.0', distribution: { npx: { package: '@augmentcode/auggie@0.36.0', args: ['--acp'] } } },
  { id: 'factory-droid', name: 'Factory Droid', description: "Factory's coding agent", version: '0.242.1', distribution: { npx: { package: 'droid@0.242.1', args: ['exec', '--output-format', 'acp-daemon'] } } },
  { id: 'kilo', name: 'Kilo Code', description: 'Kilo Code CLI', version: '7.8.12', distribution: { npx: { package: '@kilocode/cli@7.8.12', args: ['acp'] } } },
  { id: 'mistral-vibe', name: 'Mistral Vibe', description: "Mistral's coding agent", version: SNAPSHOT_BINARIES['mistral-vibe']!.version, distribution: { binary: SNAPSHOT_BINARIES['mistral-vibe']!.binary } },
  { id: 'hermes', name: 'Hermes Agent', description: "Nous Research's self-improving agent", distribution: {}, bins: [{ name: 'hermes', args: ['acp'] }] },
];

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/* No catalog arg may carry a launch token ({cwd}, {run}): those belong to Sequence's own sandbox launch only. */
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && !/[{}]/.test(x));

/** The first arg of a list that carries a launch token, or null. */
const tokenArg = (v: unknown): string | null => (Array.isArray(v) ? (v.find((x): x is string => typeof x === 'string' && /[{}]/.test(x)) ?? null) : null);

/**
 * Why a raw record is refused for carrying a launch token in an argument, or null. The entry is refused whole:
 * dropping only the token would start a different command, and dropping the whole list would lose `--acp`.
 */
export function catalogRefusal(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const d = (r.distribution && typeof r.distribution === 'object' ? r.distribution : {}) as Record<string, unknown>;
  const lists: unknown[] = [];
  for (const k of ['npx', 'uvx'] as const) lists.push((d[k] as Record<string, unknown> | undefined)?.args);
  if (d.binary && typeof d.binary === 'object') for (const b of Object.values(d.binary as Record<string, unknown>)) lists.push((b as Record<string, unknown> | null)?.args);
  if (Array.isArray(r.bins)) for (const b of r.bins) lists.push((b as Record<string, unknown> | null)?.args);
  for (const l of lists) {
    const bad = tokenArg(l);
    if (bad !== null) return `'${String(r.id)}' is not allowed: the argument '${bad}' contains { or }, which are reserved for Sequence's own sandbox launch`;
  }
  return null;
}

/**
 * One raw registry record to a clean {@link CatalogAgent}, or null when it is
 * not usable. Total: a hand-edited or hostile file yields only the valid
 * entries, and never a non-string reaching a command line.
 */
export function sanitizeCatalogAgent(raw: unknown): CatalogAgent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!ID_RE.test(id) || name === '') return null;
  /* `<id>-sandbox` is the name of another id's Docker copy in agents.json: an id of that shape could overwrite it. */
  if (/-sandbox$/.test(id)) return null;
  if (catalogRefusal(raw) !== null) return null;
  const d = (r.distribution && typeof r.distribution === 'object' ? r.distribution : {}) as Record<string, unknown>;
  const dist: CatalogAgent['distribution'] = {};
  for (const k of ['npx', 'uvx'] as const) {
    const p = d[k] as Record<string, unknown> | undefined;
    if (p && typeof p.package === 'string' && /^[@A-Za-z0-9][@\w./=<>~^-]*$/.test(p.package)) {
      dist[k] = { package: p.package, ...(isStrList(p.args) ? { args: p.args } : {}) };
    }
  }
  if (d.binary && typeof d.binary === 'object') {
    const bins: Record<string, RegistryBinary> = {};
    for (const [plat, b] of Object.entries(d.binary as Record<string, unknown>)) {
      const bb = b as Record<string, unknown> | null;
      if (bb && typeof bb.cmd === 'string' && bb.cmd.trim() !== '') bins[plat] = {
          cmd: bb.cmd,
          ...(isStrList(bb.args) ? { args: bb.args } : {}),
          ...(typeof bb.archive === 'string' && /^https:[/][/]/.test(bb.archive) ? { archive: bb.archive } : {}),
          ...(typeof bb.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(bb.sha256) ? { sha256: bb.sha256.toLowerCase() } : {}),
        };
    }
    if (Object.keys(bins).length) dist.binary = bins;
  }
  const out: CatalogAgent = { id, name, distribution: dist };
  if (typeof r.description === 'string') out.description = r.description.slice(0, 200);
  if (typeof r.version === 'string') out.version = r.version.slice(0, 40);
  for (const k of ['website', 'repository'] as const) {
    if (typeof r[k] === 'string' && /^https:\/\//.test(r[k] as string)) out[k] = r[k] as string;
  }
  if (Array.isArray(r.bins)) {
    const bins = (r.bins as unknown[])
      .map((b) => b as Record<string, unknown>)
      .filter((b) => b && typeof b.name === 'string' && /^[\w.-]+$/.test(b.name as string))
      .map((b) => ({ name: b.name as string, args: isStrList(b.args) ? b.args : [] }));
    if (bins.length) out.bins = bins;
  }
  if (!out.distribution.npx && !out.distribution.uvx && !out.distribution.binary && !out.bins) return null;
  return out;
}

/** A registry document (`{ agents: [...] }`) to its clean entries. */
export function registryRefusals(doc: unknown): { id: string; reason: string }[] {
  const list = doc && typeof doc === 'object' && Array.isArray((doc as { agents?: unknown }).agents) ? (doc as { agents: unknown[] }).agents : [];
  return list.flatMap((raw) => {
    const reason = catalogRefusal(raw);
    const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined;
    return reason !== null && typeof id === 'string' ? [{ id, reason }] : [];
  });
}

export function parseRegistry(doc: unknown): CatalogAgent[] {
  const list = doc && typeof doc === 'object' && Array.isArray((doc as { agents?: unknown }).agents) ? (doc as { agents: unknown[] }).agents : [];
  return list.map(sanitizeCatalogAgent).filter((a): a is CatalogAgent => a !== null);
}

/** The registry's platform key for this machine (`windows-x86_64`, `darwin-aarch64`, ...). */
export function platformKey(platform = process.platform, arch = process.arch): string {
  const os = platform === 'win32' ? 'windows' : platform;
  const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : arch;
  return `${os}-${cpu}`;
}

/** `./dist-package\\cursor-agent.cmd` -> `cursor-agent`. */
function cmdBase(cmd: string): string {
  return (cmd.split(/[\\/]/).pop() ?? '').replace(/\.(exe|cmd|bat|par)$/i, '');
}

/** The npm package name without its version: `@google/gemini-cli@0.64.0` -> `@google/gemini-cli`. */
export function npmName(spec: string): string {
  const at = spec.lastIndexOf('@');
  return at > 0 ? spec.slice(0, at) : spec;
}

/** A registry `cmd` of `./cmd` would match Windows' own cmd.exe by name: no shell or interpreter is ever an agent's CLI. */
const SHELLS = new Set(['cmd', 'powershell', 'pwsh', 'sh', 'bash', 'zsh', 'node', 'python', 'python3', 'py', 'wscript', 'cscript', 'mshta', 'rundll32', 'npx', 'uvx', 'npm']);

/** The CLIs an entry may already have on this machine, with the args that start ACP mode. */
export function localCandidates(a: CatalogAgent, plat = platformKey()): { name: string; args: string[] }[] {
  const all = rawCandidates(a, plat);
  if ((a as { source?: CatalogSource }).source !== 'registry') return all;
  /* A FETCHED entry names its own cmd and package, so it could name any program on PATH with its own args. Only
     a name vetted for this id (the shipped snapshot's, or the npm bin of a package we know) is a local candidate. */
  const vetted = new Set<string>();
  const shipped = BUILTIN_CATALOG.find((b) => b.id === a.id);
  if (shipped) for (const c of rawCandidates(shipped, plat)) vetted.add(c.name);
  const pkg = a.distribution.npx ? NPM_BIN[npmName(a.distribution.npx.package)] : undefined;
  if (pkg) vetted.add(pkg);
  return all.filter((c) => vetted.has(c.name));
}

function rawCandidates(a: CatalogAgent, plat: string): { name: string; args: string[] }[] {
  const out: { name: string; args: string[] }[] = [...(a.bins ?? [])];
  const bin = a.distribution.binary;
  if (bin) {
    const b = bin[plat] ?? bin.any ?? Object.values(bin)[0];
    if (b) out.push({ name: cmdBase(b.cmd), args: b.args ?? [] });
  }
  const npx = a.distribution.npx;
  if (npx) {
    const n = npmName(npx.package);
    out.push({ name: NPM_BIN[n] ?? n.split('/').pop()!, args: npx.args ?? [] });
  }
  const seen = new Set<string>();
  return out.filter((c) => c.name !== '' && !SHELLS.has(c.name.toLowerCase()) && !seen.has(c.name) && seen.add(c.name));
}

export type CatalogLaunch =
  | { ok: true; via: 'local' | 'installed' | 'npx' | 'uvx'; command: string; args: string[]; shown: string }
  | { ok: false; via: null; reason: 'install'; message: string };

export interface ResolveOptions {
  /** PATH to search (defaults to the process PATH). */
  pathValue?: string;
  extraDirs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  plat?: string;
  /** Where one-click installs live (agentBinaryInstall.ts): `<user store>/agents-bin`. Absent: none are looked for. */
  installRoot?: string;
}

/**
 * A Windows `.cmd` that is not an npm shim (cursor-agent's own launcher) has no
 * script to run with node. Run it through cmd.exe, but only when nothing on the
 * line needs quoting: the registry entry is plain argv, with no verbatim flag.
 */
const CMD_SAFE = /^[\w:\\/.@=-]+$/;
/** The resolved .cmd itself may sit under a folder with a space (a profile like "John Smith"): plain path characters only. */
const CMD_PATH_SAFE = /^[\w:\\/.@=() -]+$/;

function launchLine(resolved: string, args: string[], dirs: readonly string[], env: NodeJS.ProcessEnv): { command: string; args: string[] } | null {
  /* Node's own npx.cmd (C:\Program Files\nodejs) is not an npm shim template and its path has a
     space, so neither route below takes it (measured on the owner's machine: every npx agent read
     "install"). It is node plus npm's npx-cli.js, which sits beside it. */
  if (/[\\/]npx\.cmd$/i.test(resolved)) {
    const cli = path.join(path.dirname(resolved), 'node_modules', 'npm', 'bin', 'npx-cli.js');
    if (fs.existsSync(cli)) return { command: nodeForShim(resolved, dirs, env), args: [cli, ...args] };
  }
  const l = launchForResolved(resolved, args, dirs, env);
  if (!l.verbatim) return { command: l.command, args: l.args };
  /* Node quotes an argument with a space, and cmd /c keeps one quoted existing file as it is, so a spaced
     path works; the args stay plain words. */
  if (!CMD_PATH_SAFE.test(resolved) || !args.every((w) => CMD_SAFE.test(w))) return null;
  return { command: env.ComSpec ?? process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/c', resolved, ...args] };
}

/** How to start catalog agent `a` on this machine, or how to get it. */
export function resolveCatalogLaunch(a: CatalogAgent, opts: ResolveOptions = {}): CatalogLaunch {
  const env = { ...(opts.env ?? process.env) };
  const key = pathKey(env);
  const dirs = searchDirs(opts.pathValue ?? env[key] ?? '', opts.extraDirs ?? []);
  env[key] = dirs.join(path.delimiter);
  for (const c of localCandidates(a, opts.plat)) {
    const resolved = resolveBinary(c.name, dirs, env);
    if (!resolved) continue;
    const l = launchLine(resolved, c.args, dirs, env);
    if (l) return { ok: true, via: 'local', ...l, shown: [c.name, ...c.args].join(' ') };
  }
  /* Installed by Sequence from the registry's checksummed archive (agentBinaryInstall.ts). */
  const installed = opts.installRoot ? readInstalled(opts.installRoot, a.id) : null;
  if (installed) {
    const l = launchLine(installed.command, installed.args, dirs, env);
    if (l) return { ok: true, via: 'installed', ...l, shown: [path.basename(installed.command), ...installed.args].join(' ') };
  }
  for (const via of ['npx', 'uvx'] as const) {
    const p = a.distribution[via];
    if (!p) continue;
    const resolved = resolveBinary(via, dirs, env);
    if (!resolved) continue;
    const args = via === 'npx' ? ['-y', p.package, ...(p.args ?? [])] : [p.package, ...(p.args ?? [])];
    const l = launchLine(resolved, args, dirs, env);
    if (l) return { ok: true, via, ...l, shown: [via, ...args].join(' ') };
  }
  return { ok: false, via: null, reason: 'install', message: installHint(a) };
}

/** The record an install leaves: `<installRoot>/<id>/installed.json`. */
export interface InstalledAgent {
  id: string;
  version: string;
  /** Absolute path of the agent's executable inside its install folder. */
  command: string;
  args: string[];
  sha256: string;
}

/** The install of `id`, when its record is whole and its executable is still there. */
export function readInstalled(installRoot: string, id: string): InstalledAgent | null {
  if (!ID_RE.test(id)) return null;
  const dir = path.join(installRoot, id);
  const rec = readUserJson<Partial<InstalledAgent>>(dir, 'installed.json');
  if (!rec || typeof rec.command !== 'string' || !isStrList(rec.args) || typeof rec.version !== 'string' || typeof rec.sha256 !== 'string') return null;
  /* The record cannot point outside its own folder, by its text or through a link. */
  const rel = path.relative(dir, rec.command);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try {
    if (!fs.lstatSync(rec.command).isFile()) return null;
    const real = path.relative(fs.realpathSync(dir), fs.realpathSync(rec.command));
    if (real.startsWith('..') || path.isAbsolute(real)) return null;
  } catch {
    return null;
  }
  return { id, version: rec.version, command: rec.command, args: rec.args, sha256: rec.sha256 };
}

/** The archive this machine would install for `a`: only one the registry gives a checksum for. */
export function installableBinary(a: CatalogAgent, plat = platformKey()): (RegistryBinary & { archive: string; sha256: string }) | null {
  const b = a.distribution.binary?.[plat];
  return b && b.archive && b.sha256 ? (b as RegistryBinary & { archive: string; sha256: string }) : null;
}

/** What to tell a person who does not have the agent yet. */
export function installHint(a: CatalogAgent): string {
  if (a.distribution.npx) return `Install Node.js (for npx), or: npm install -g ${npmName(a.distribution.npx.package)}`;
  if (a.distribution.uvx) return `Install uv (for uvx), or: pip install ${a.distribution.uvx.package.split(/[=<>~]/)[0]}`;
  const site = a.website ?? a.repository;
  return site ? `Install ${a.name} from ${site}` : `Install ${a.name} and put it on PATH`;
}

/**
 * The catalog: built-in snapshot, then the cached registry, then the person's
 * own file, merged by id (later wins), minus the agents the dedicated flows own.
 */
export function readCatalog(storeDir: string): { agents: (CatalogAgent & { source: CatalogSource })[]; registryFetchedAt: number | null; refused: { id: string; reason: string }[] } {
  const byId = new Map<string, CatalogAgent & { source: CatalogSource }>();
  for (const a of BUILTIN_CATALOG) byId.set(a.id, { ...a, source: 'builtin' });
  const cache = readUserJson<{ fetchedAt?: unknown; registry?: unknown }>(storeDir, REGISTRY_CACHE_FILE);
  for (const fetched of parseRegistry(cache?.registry)) {
    /* `bins` is Sequence's own hint, trusted only from the snapshot and the person's file: from a fetched
       registry it would name any program on this machine (`powershell -c ...`) with no download between. */
    const { bins: _untrusted, ...a } = fetched;
    const prior = byId.get(a.id);
    /* The live registry knows the version; the snapshot may know the local bin (Hermes). Keep both. */
    byId.set(a.id, { ...a, ...(prior?.bins ? { bins: prior.bins } : {}), source: 'registry' });
  }
  const userDoc = readUserJson(storeDir, USER_CATALOG_FILE);
  for (const a of parseRegistry(userDoc)) byId.set(a.id, { ...a, source: 'user' });
  for (const id of HANDLED_ELSEWHERE) byId.delete(id);
  const fetchedAt = typeof cache?.fetchedAt === 'number' ? cache.fetchedAt : null;
  return { agents: [...byId.values()], registryFetchedAt: fetchedAt, refused: [...registryRefusals(cache?.registry), ...registryRefusals(userDoc)] };
}

/** Store a fetched registry document for {@link readCatalog}. Refuses a document with no usable agent. */
export function cacheRegistry(storeDir: string, doc: unknown, now = Date.now()): number {
  const n = parseRegistry(doc).length;
  if (n === 0) throw new Error('the registry answered with no usable agents');
  writeUserJson(storeDir, REGISTRY_CACHE_FILE, { fetchedAt: now, registry: doc });
  return n;
}

/* ── RUN IN A SANDBOX (Docker) ─────────────────────────────────────────────
   The same agent, started inside a throwaway container with only the project folder mounted at
   /workspace (the {cwd} contract in @sequence/acp). It cannot read or write anything else on the
   machine; it keeps network access for its model API. npx agents only for now: the container is
   Node's official slim image, and npm's cache lives in a named volume so the second start is quick.
   An agent signs in there with an API key from the environment (passed by NAME, so the value
   never appears on a command line); a login stored in the person's home is not visible inside. */

export const SANDBOX_IMAGE = 'node:22-bookworm-slim';
/** The keys an agent may need, passed through by name when the person has them set. */
/**
 * The keys each agent signs in with, passed by NAME when set. Only that agent's own: a sandbox that handed
 * every provider's key and a GitHub token to any npm package would undo the containment (review, round two).
 * An agent not listed gets none.
 */
export const SANDBOX_ENV_KEYS: Readonly<Record<string, readonly string[]>> = {
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_CLOUD_PROJECT'],
  'qwen-code': ['DASHSCOPE_API_KEY'],
  'github-copilot-cli': ['COPILOT_GITHUB_TOKEN'],
  auggie: ['AUGMENT_SESSION_AUTH'],
  'factory-droid': ['FACTORY_API_KEY'],
};
/** Where Docker Desktop puts its CLI when it is not on PATH. */
export const DOCKER_DIRS = process.platform === 'win32' ? [path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Docker', 'Docker', 'resources', 'bin')] : ['/usr/local/bin', '/opt/homebrew/bin'];

export type SandboxLaunch = { ok: true; command: string; args: string[]; shown: string } | { ok: false; reason: 'no-docker' | 'unsupported'; message: string };

/** The Docker launch for catalog agent `a`, or why there is none. Pure: whether the engine runs is checked separately. */
export function sandboxLaunch(a: CatalogAgent, opts: ResolveOptions & { image?: string; dockerDirs?: readonly string[]; platform?: NodeJS.Platform; uid?: number; gid?: number } = {}): SandboxLaunch {
  const npx = a.distribution.npx;
  if (!npx) return { ok: false, reason: 'unsupported', message: `${a.name} does not ship on npm, so it cannot run in the sandbox yet` };
  const env = { ...(opts.env ?? process.env) };
  const key = pathKey(env);
  const dirs = searchDirs(opts.pathValue ?? env[key] ?? '', [...(opts.extraDirs ?? []), ...(opts.dockerDirs ?? DOCKER_DIRS)]);
  const docker = resolveBinary('docker', dirs, env);
  if (!docker) return { ok: false, reason: 'no-docker', message: 'Docker is not installed (docker.com/products/docker-desktop)' };
  const pass = (SANDBOX_ENV_KEYS[a.id] ?? []).filter((k) => (env[k] ?? '').trim() !== '').flatMap((k) => ['-e', k]);
  const image = opts.image ?? SANDBOX_IMAGE;
  const inner = ['npx', '-y', npx.package, ...(npx.args ?? [])];
  /* Named per run ({run}), so Stop can remove the container itself (killing the docker CLI does not); no new
     privileges and no raw sockets inside. On Linux it runs as the person, so files it writes are theirs, with
     HOME and npm's cache where that user can write. */
  const platform = opts.platform ?? process.platform;
  const uid = opts.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined);
  const gid = opts.gid ?? (typeof process.getgid === 'function' ? process.getgid() : undefined) ?? uid;
  /* A new named volume is root:root 0755 unless the image already has the mount point, and a non-root uid then gets
     EACCES from npx. /tmp is 1777 in the image, so the volume is mounted over /tmp and HOME and npm's cache sit inside
     it. The volume name is new (-user) so an older root-owned volume is never reused. */
  const asUser = platform === 'linux' && uid !== undefined;
  const user = asUser ? ['--user', `${uid}:${gid}`, '-e', 'HOME=/tmp/home', '-e', 'npm_config_cache=/tmp/home/.npm'] : [];
  const cache = asUser ? 'sequence-npm-cache-user:/tmp' : 'sequence-npm-cache:/root/.npm';
  /* --mount, not -v: a colon in the project path (POSIX allows it) would split a -v value. {cwd} is filled at spawn (a comma is refused there). */
  const args = ['run', '-i', '--rm', '--init', '--name', `seq-${a.id}-{run}`, '--security-opt', 'no-new-privileges', '--cap-drop', 'NET_RAW', '--mount', 'type=bind,src={cwd},dst=/workspace', '-w', '/workspace', '-v', cache, ...user, ...pass, image, ...inner];
  return { ok: true, command: docker, args, shown: `docker run … ${image} ${inner.join(' ')}` };
}
