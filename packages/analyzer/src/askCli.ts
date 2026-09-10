/**
 * P14 — THE HEADLESS ENTRY POINT (`sequence ask`).
 *
 * `claude -p` composes with Unix pipes; Codex has a non-interactive mode. This
 * CLI had twelve verbs and **none of them asked anything** — every path to the
 * grounded assistant went through the browser, so there was no unattended way
 * to use the one capability this product claims is structural (a coverage
 * number on every answer). A cron job, a pre-commit hook, a CI step and a shell
 * pipeline all had the same answer: not possible.
 *
 * WHAT THIS IS NOT. It is not a second ask implementation. It calls the SAME
 * {@link runAskPipeline} the HTTP routes call, against the same scan, the same
 * digest, the same jail, the same permission policy and the same provider
 * adapter. If a headless answer ever differs from the one the app gives, that
 * is a bug here and not a difference of feature — which is exactly why nothing
 * in this file re-derives prompt content.
 *
 * THE TWO PROPERTIES A PIPE NEEDS, and both are load-bearing:
 *
 *   1. **Only the answer is on stdout.** The scan line, the model, the coverage
 *      note, every warning — all of it goes to stderr. `sequence ask … > out.md`
 *      must produce an answer file, not a transcript. This is why nothing in
 *      this file uses `console.log` except the single write of the result.
 *   2. **The exit code is honest.** 0 only when an answer was produced. A
 *      question that could not be answered exits non-zero AND writes nothing to
 *      stdout, so `sequence ask … | tee` downstream never mistakes an error for
 *      content. The codes are stable and documented in {@link ASK_EXIT}.
 *
 * WHY IT SCANS RATHER THAN TALKING TO A RUNNING SERVER. Local-first: the
 * headless path must work with nothing else running. `scanRepoCached` means the
 * second invocation on an unchanged repo pays a cache read rather than a full
 * parse, so a pipeline that asks three questions scans once.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { scanRepoCached } from './server/graphCache.js';
import { beginTeachTurn } from './server/teachTurn.js';
import { buildDigest } from './explain/explain.js';
import { buildTree } from './server/tree.js';
import { canonicalRoot, realpathContained, resolveInRepo } from './server/jail.js';
import {
  computeAskInstructionHash,
  runAskPipeline,
  type AskPipelineResult,
  type AskStreamEvent,
} from './server/askPipeline.js';
import { buildRunReceipt, writeRunReceipt, type RunReceipt } from './server/runReceipt.js';
import { parseAskDoneWhen, type AskDoneWhen } from './harness/verifyGate.js';
import { applyAskFileWrites } from './server/applyAskFileWrites.js';
import {
  ASK_TURN_DEADLINE_MS,
  askToolsForJobMode,
  openaiAskToolDefinitions,
} from './server/askTools.js';
import {
  aiConfigFromEnv,
  deepSeekConfigured,
  generateTextWithUsage,
  preferEnvOverUnservableDefault,
  validateAiConfig,
  ProviderError,
  type AiConfig,
} from './server/provider.js';
import { AI_FILE, readJson, readUserJson, userStoreDir } from './server/store.js';
import { approxTokens } from './llm/tokenBudget.js';

/**
 * The exit codes, fixed so a script can branch on them.
 *
 * They are deliberately NOT all 1. A shell wrapper that retries on a transient
 * provider failure but must not retry a typo needs to tell the two apart, and
 * parsing stderr for that is the thing an exit code exists to avoid.
 */
export const ASK_EXIT = {
  /** An answer was produced and written to stdout. */
  OK: 0,
  /** The command line was wrong (no question, bad flag, bad `--timeout`). */
  USAGE: 2,
  /** No AI provider is configured anywhere — repo, user config, or environment. */
  NO_PROVIDER: 3,
  /** The provider or the pipeline failed. Retryable in principle. */
  PROVIDER: 4,
  /** The repo path is missing, is not a directory, or could not be scanned. */
  REPO: 5,
  /** The turn was cancelled (Ctrl-C) or ran past `--timeout`. */
  CANCELLED: 6,
  /**
   * An answer WAS produced and written to stdout — but the turn wrote files and
   * its `--done-when` gate FAILED or was REFUSED, so the write is unverified.
   * Distinct from OK because a script that named a done-when is asking exactly
   * this question; distinct from PROVIDER because nothing broke. A gate the
   * caller skipped on the record (`--done-when-skip`) is OK: that was a choice.
   */
  UNVERIFIED: 7,
} as const;

/** Where output goes. Injected so a test can capture it; defaults to the process. */
export interface AskCliIo {
  /** THE ANSWER, and nothing else, ever. */
  out: (text: string) => void;
  /** Progress, diagnostics, failures. Everything a pipe must not see. */
  err: (text: string) => void;
  /** Reads the question when `--stdin` is passed. */
  readStdin: () => Promise<string>;
}

const USAGE = `usage: sequence ask <question> [--repo <dir>] [--json] [--stdin]
                   [--mode implementation|research|design] [--permission <p>]
                   [--timeout <ms>] [--turn-deadline <ms>] [--rounds <n>] [--quiet]
                   [--done-when "<cmd>" | --done-when-skip "<reason>"]

  Answer a question about a repository and write the answer to stdout, so it
  pipes. Runs the same grounded ask pipeline the app runs.

  <question>        the question. Omit it and pass --stdin to read it from a pipe.
  --repo <dir>      the repository to ask about (default: the current directory).
  --stdin           read the question from stdin instead of the command line.
  --output-format stream-json
                    NDJSON progress on stdout, one event per line, AS THE
                    turn happens - step boundaries, tool calls, the result.
                    For CI. --json emits one object only at the end.
  --json            emit {"text","coverage","usage","receipt"} as one JSON
                    object instead of bare text. Still the only thing on
                    stdout. "receipt" is the turn's change receipt — model,
                    provider host, permission mode, tools called, commands
                    and exit codes, files written, rounds/tokens/retries,
                    the done-when verdict — and is also written to
                    .sequence/receipts/<runId>.json in the repo.
  --mode <m>        implementation (default), research, or design.
                    design: propose an architecture for a system that does NOT
                    exist yet. The turn is not grounded in the scanned repo and
                    says so; use it for greenfield system design.
  --permission <p>  what the turn may DO. Omit it and the turn is words only —
                    no tools are offered and nothing is written, which is what
                    this command did before the flag existed.
                      plan      reading tools only
                      propose   full belt; changes are staged, never written
                      autoEdit  staged changes ARE written, no shell
                      full      autoEdit plus run_command
                    Writing modes edit the repo in place. There is no undo here;
                    run them on a checkout you can throw away.
  --timeout <ms>    give up after <ms> and exit ${ASK_EXIT.CANCELLED}.
  --turn-deadline <ms>
                    the TURN's own soft budget (default ${ASK_TURN_DEADLINE_MS},
                    0 = none). Unlike --timeout this does not kill the turn: it
                    stops the loop starting NEW tool rounds and lets the turn
                    write the answer it already has.
  --rounds <n>      tool-round budget for the turn (default 8, ceiling 32).
                    Every round is a metered provider call; agentic/benchmark
                    runs want the ceiling, chat wants the default.
  --done-when <cmd> what "done" means for a writing turn. If the turn writes a
                    file, the harness runs <cmd> at the repo root after the
                    last write and ends the answer with the outcome:
                    passed / FAILED (exit n) / was refused: <reason>. A
                    failure does not revert the edit. Only build/test runners
                    are accepted (pytest, pnpm, node, go, cargo, ...); a bare
                    command with no pipes or redirects. --json adds "verify".
  --done-when-skip <reason>
                    decline the gate on the record; the reason is required.
  --quiet           suppress the progress lines on stderr.

exit codes:
  ${ASK_EXIT.OK}  answered            ${ASK_EXIT.USAGE}  bad usage
  ${ASK_EXIT.NO_PROVIDER}  no provider configured   ${ASK_EXIT.PROVIDER}  provider or pipeline failed
  ${ASK_EXIT.REPO}  repo unusable            ${ASK_EXIT.CANCELLED}  cancelled or timed out
  ${ASK_EXIT.UNVERIFIED}  answered, but the turn wrote files and --done-when FAILED or was refused
`;

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

const defaultIo: AskCliIo = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
  readStdin: readAllStdin,
};

/**
 * The SAME precedence the server uses (`repoServer.ts`'s `loadAiConfig`):
 * per-repo `.sequence/ai.json`, then the user-level `~/.sequence/ai.json`, then
 * the environment. Restated here rather than imported because `loadAiConfig` is
 * a closure inside `createRepoServer` and there is no server in this path — but
 * the ORDER is the contract, and a headless answer that used a different key
 * from the app's would be a genuinely confusing bug.
 *
 * The key is never printed, never logged, and never leaves `provider.ts`.
 */
export function loadAskAiConfig(repoRoot: string | null): AiConfig | undefined {
  let cfg: AiConfig | undefined;
  if (repoRoot !== null) {
    const raw = readJson(repoRoot, AI_FILE);
    cfg = raw === undefined ? undefined : validateAiConfig(raw).config;
  }
  if (!cfg) {
    const userRaw = readUserJson(userStoreDir(), AI_FILE);
    cfg = userRaw === undefined ? undefined : validateAiConfig(userRaw).config;
  }
  /*
   * The env is not merely a last resort: a default-mode config that cannot be
   * served does not outrank a key the user supplied. The CLI has no gateway
   * seam, so "servable" here is exactly "DeepSeek is configured". Shared with
   * the server so the two cannot drift — which they did, for one commit.
   */
  return preferEnvOverUnservableDefault(cfg, { defaultIsServable: deepSeekConfigured() });
}

/**
 * The read jail for the tool loop, identical in effect to the server's
 * `resolveReadablePath`: inside the repo (no `..`, no absolute, no symlink
 * escape) and never inside a reserved directory.
 *
 * The reserved list is the server's, MINUS its three narrow write holes — a
 * headless read has no reason to reach `.sequence/` at all, and the narrower
 * rule is the safe direction to differ in.
 */
function makeResolveReadable(repoRoot: string): (rel: string) => string | null {
  const reserved: string[] = [];
  for (const name of ['.sequence', '.git', '.ssh', '.aws', '.gnupg']) {
    const lex = path.join(repoRoot, name);
    reserved.push(lex);
    try {
      const real = fs.realpathSync(lex);
      if (real !== lex) reserved.push(real);
    } catch {
      /* absent — the lexical path still guards it */
    }
  }
  return (rel: string): string | null => {
    const abs = resolveInRepo(repoRoot, rel);
    if (abs === null) return null;
    const canonical = realpathContained(abs);
    if (reserved.some((r) => canonical === r || canonical.startsWith(r + path.sep))) return null;
    return abs;
  };
}

interface ParsedAskArgs {
  /** Teach Mode: one concept, one visual, one check-in per turn (docs/teach-mode.md). */
  teach?: boolean;
  question?: string;
  repo: string;
  json: boolean;
  /**
   * `--output-format=stream-json` — NDJSON progress on stdout, one event per
   * line, as the turn happens.
   *
   * Distinct from `--json`, which emits ONE object at the end. A CI consumer
   * needs the boundaries: which step is running, which tool was called, when
   * to fail fast. Same event union the SSE route serves.
   */
  outputFormat: 'text' | 'stream-json';
  stdin: boolean;
  quiet: boolean;
  mode: 'implementation' | 'research' | 'design';
  /**
   * `--rounds N` — the tool-round budget for this turn, clamped by the
   * pipeline's own ASK_ROUNDS_CEILING (32). The interactive default (8) is
   * a chat-UX number: measured on SWE-bench with a competent model, the turn
   * was cut off mid-investigation at round 8 — 195k input tokens of real
   * reading, the right fix identified in prose, and no round left to make it.
   * A benchmark or agentic run passes the ceiling explicitly; every round is
   * still a metered provider call, so this raises a limit, never removes one.
   */
  rounds?: number;
  /**
   * `--turn-deadline <ms>` — the PIPELINE's own soft budget for the turn,
   * `ASK_TURN_DEADLINE_MS` when absent. `0` means no deadline. The number is
   * deliberately not repeated here: `askTools.ts` owns it, the usage text
   * interpolates it, and a third copy in a comment is a copy that drifts.
   *
   * NOT `--timeout`, and the two are easy to confuse because both are
   * milliseconds. `--timeout` aborts this PROCESS and exits CANCELLED, killing a
   * turn in flight. This one is soft: it stops the loop starting NEW tool
   * rounds and lets the turn write the answer it already has.
   *
   * It exists because the parameter had no caller. `resolveTurnDeadlineMs` has
   * accepted an override all along and the only thing in the repository that
   * ever passed one was a test — so `docs/research/teach-mode-driven-end-to-end.md`
   * §6 could measure that two of three teach turns on this repo produce NO
   * LESSON at 180 seconds, and could not run the experiment that would say
   * whether more time finishes one.
   *
   * RAISING THE BUDGET A LEARNER GETS IS A PRODUCT CALL and is deliberately not
   * taken here: this changes no default, no app behaviour and no answer. It
   * makes the headless path able to ask the question.
   */
  turnDeadlineMs?: number;
  /**
   * What the headless turn is allowed to DO — the same vocabulary the composer offers.
   *
   * Absent means the historical behaviour, which was words only: this CLI attached no
   * tools and applied no writes, so `sequence ask` could describe a change and never make
   * one. That is fine for a question and useless for a coding agent, and it is why
   * Sequence could not be measured against other harnesses at all — every benchmark of
   * this kind collects a `git diff`, and an agent that cannot write produces an empty one.
   *
   *   plan     — reading tools only
   *   propose  — full belt; proposals are staged, never written
   *   autoEdit — proposals are WRITTEN through the jail and pre-write hooks
   *   full     — autoEdit plus run_command, under the same permission rules
   */
  permission?: 'plan' | 'propose' | 'autoEdit' | 'full';
  timeoutMs?: number;
  /**
   * The acceptance gate for a writing turn — `--done-when "<cmd>"` or
   * `--done-when-skip "<reason>"`. The pipeline runs the command after the
   * turn's last write and names the outcome; see `AskPipelineInput.doneWhen`.
   * Parsed through `parseAskDoneWhen`, the same narrowing the server applies,
   * so a skip without a reason is refused here too.
   */
  doneWhen?: AskDoneWhen;
  error?: string;
}

/**
 * Parse `ask`'s argv. Flags are removed in place (the same `opt`/`flag` shape
 * the rest of `cli.ts` uses); whatever is left, joined, is the question — so
 * `sequence ask what does quote do` works without quoting, which is what a
 * person types before they read the usage line.
 */
export function parseAskArgs(argv: string[]): ParsedAskArgs {
  const args = [...argv];
  const take = (name: string): string | undefined => {
    const i = args.indexOf(name);
    if (i >= 0 && i + 1 < args.length) {
      const v = args[i + 1];
      args.splice(i, 2);
      return v;
    }
    if (i >= 0) {
      args.splice(i, 1);
      return '';
    }
    return undefined;
  };
  const has = (name: string): boolean => {
    const i = args.indexOf(name);
    if (i < 0) return false;
    args.splice(i, 1);
    return true;
  };

  const json = has('--json');
  /*
   * `--output-format=<v>` AND `--output-format <v>`, because a reader who
   * writes the form this CLI does not accept gets silence otherwise.
   *
   * Both forms must be SPLICED OUT of `args`, not merely read: everything left
   * in `args` becomes the question, so a value read in place would be answered
   * as if the user had asked "stream-json". `take` already does that for the
   * space form; the `=` form is one arg and is removed here.
   */
  const eqAt = args.findIndex((a) => a.startsWith('--output-format='));
  const ofEq = eqAt === -1 ? undefined : args.splice(eqAt, 1)[0]!.split('=').slice(1).join('=');
  const ofSpace = take('--output-format');
  const outputFormat: 'text' | 'stream-json' =
    (ofEq ?? ofSpace) === 'stream-json' ? 'stream-json' : 'text';
  const stdin = has('--stdin');
  const quiet = has('--quiet');
  const repoArg = take('--repo');
  const modeArg = take('--mode');
  const permissionArg = take('--permission');
  const timeoutArg = take('--timeout');
  const turnDeadlineArg = take('--turn-deadline');
  const roundsArg = take('--rounds');
  const doneWhenArg = take('--done-when');
  const doneWhenSkipArg = take('--done-when-skip');
  const teach = has('--teach');

  const base: ParsedAskArgs = {
    repo: repoArg && repoArg !== '' ? repoArg : process.cwd(),
    json,
    teach,
    outputFormat,
    stdin,
    quiet,
    mode: 'implementation',
  };

  if (roundsArg !== undefined) {
    const n = Number.parseInt(roundsArg, 10);
    if (!Number.isInteger(n) || n < 1) {
      process.stderr.write(`sequence ask: --rounds must be a positive integer, got "${roundsArg}"
`);
      process.exit(2);
    }
    base.rounds = n;
  }

  if (permissionArg !== undefined) {
    /* Named, never coerced. Silently downgrading an unrecognised permission would hand
       the caller a read-only turn that looks like a writing one — the exact confusion
       the composer's own permission control was built to remove. */
    if (
      permissionArg !== 'plan' &&
      permissionArg !== 'propose' &&
      permissionArg !== 'autoEdit' &&
      permissionArg !== 'full'
    ) {
      return {
        ...base,
        error: `--permission must be plan, propose, autoEdit or full (got '${permissionArg}')`,
      };
    }
    base.permission = permissionArg;
  }

  if (doneWhenArg !== undefined && doneWhenSkipArg !== undefined) {
    return { ...base, error: '--done-when and --done-when-skip are mutually exclusive' };
  }
  if (doneWhenArg !== undefined || doneWhenSkipArg !== undefined) {
    /* One narrowing, shared with the server: an empty command or an empty skip
       reason is a usage error, never a silent no-gate. */
    const parsedDoneWhen = parseAskDoneWhen(
      doneWhenArg !== undefined
        ? { kind: 'command', cmd: doneWhenArg }
        : { kind: 'skip', reason: doneWhenSkipArg },
    );
    if ('error' in parsedDoneWhen) {
      return {
        ...base,
        error:
          doneWhenArg !== undefined
            ? '--done-when needs a non-empty command, e.g. --done-when "pytest -q"'
            : '--done-when-skip needs a non-empty reason — declining the gate is a recorded choice, not a default',
      };
    }
    if (parsedDoneWhen.doneWhen) base.doneWhen = parsedDoneWhen.doneWhen;
  }

  if (modeArg !== undefined) {
    if (modeArg !== 'implementation' && modeArg !== 'research' && modeArg !== 'design') {
      return {
        ...base,
        error: `--mode must be implementation, research or design (got '${modeArg}')`,
      };
    }
    base.mode = modeArg;
  }
  if (timeoutArg !== undefined) {
    const n = Number(timeoutArg);
    if (!Number.isFinite(n) || n <= 0) {
      return { ...base, error: `--timeout must be a positive number of milliseconds (got '${timeoutArg}')` };
    }
    base.timeoutMs = n;
  }
  if (turnDeadlineArg !== undefined) {
    const n = Number(turnDeadlineArg);
    /*
     * `>= 0`, NOT `> 0` — unlike `--timeout` above. `resolveTurnDeadlineMs`
     * documents `<= 0` as "no deadline" and that is a value the pipeline gives a
     * meaning to, so rejecting it by copying the neighbouring validator would
     * refuse the one setting an unattended bench run wants.
     */
    if (!Number.isFinite(n) || n < 0) {
      return {
        ...base,
        error: `--turn-deadline must be a non-negative number of milliseconds, or 0 for no deadline (got '${turnDeadlineArg}')`,
      };
    }
    base.turnDeadlineMs = n;
  }
  // An unconsumed `--flag` is a typo, not a question. Answering it would send
  // the user's mistake to a paid provider and return something plausible.
  const stray = args.find((a) => a.startsWith('--'));
  if (stray) return { ...base, error: `unknown flag '${stray}'` };

  const question = args.join(' ').trim();
  if (question !== '') base.question = question;
  return base;
}

/**
 * Run one headless ask. Returns the process exit code; writes the answer (and
 * nothing else) through `io.out`.
 *
 * Every failure path writes to `io.err` and returns non-zero WITHOUT having
 * written to `io.out`. That ordering is the property the test locks: the single
 * `io.out` call is the last thing that happens, after the pipeline resolved.
 */
export async function runAskCli(argv: string[], io: AskCliIo = defaultIo): Promise<number> {
  const parsed = parseAskArgs(argv);
  const note = (line: string): void => {
    if (!parsed.quiet) io.err(`${line}\n`);
  };

  if (parsed.error) {
    io.err(`sequence ask: ${parsed.error}\n\n${USAGE}`);
    return ASK_EXIT.USAGE;
  }
  /*
   * A gate that can never run is a usage error, not a quiet no-op. The gate
   * keys off files written this turn; under no `--permission`, `plan` or
   * `propose` nothing can be written, so `--done-when` would silently do
   * nothing and the caller would read the absence of a verdict as a pass.
   */
  if (parsed.doneWhen && parsed.permission !== 'autoEdit' && parsed.permission !== 'full') {
    io.err(
      `sequence ask: --done-when needs a writing mode (--permission autoEdit or full); ` +
        `under ${parsed.permission ? `--permission ${parsed.permission}` : 'no --permission'} nothing can be written, so the gate could never run\n\n${USAGE}`,
    );
    return ASK_EXIT.USAGE;
  }

  let question = parsed.question ?? '';
  if (parsed.stdin) {
    try {
      const piped = (await io.readStdin()).trim();
      // An explicit --stdin means the pipe is the question; a positional word
      // alongside it would make the source ambiguous, so the pipe wins and the
      // ambiguity is named rather than silently resolved.
      if (question !== '' && piped !== '') {
        note('sequence ask: both a positional question and --stdin were given; using stdin');
      }
      if (piped !== '') question = piped;
    } catch (e) {
      io.err(`sequence ask: could not read stdin: ${(e as Error).message}\n`);
      return ASK_EXIT.USAGE;
    }
  }
  if (question.trim() === '') {
    io.err(`sequence ask: no question given\n\n${USAGE}`);
    return ASK_EXIT.USAGE;
  }

  let repoRoot: string;
  try {
    const stat = fs.statSync(parsed.repo);
    if (!stat.isDirectory()) {
      io.err(`sequence ask: --repo is not a directory: ${parsed.repo}\n`);
      return ASK_EXIT.REPO;
    }
    repoRoot = canonicalRoot(parsed.repo);
  } catch {
    io.err(`sequence ask: no such repository: ${path.resolve(parsed.repo)}\n`);
    return ASK_EXIT.REPO;
  }

  // The provider is resolved BEFORE the scan. A scan of a large repo is seconds
  // of work, and making the user wait for it only to be told there is no key is
  // the sort of ordering that reads as a hang.
  const resolvedCfg = loadAskAiConfig(repoRoot);
  /*
   * A TRANSIENT PROVIDER FAILURE SHOULD NOT END A TURN THAT HAS ALREADY WORKED.
   *
   * Practical ML's replay, 2026-09-05: a teach turn taught its concept, then its
   * third provider call died with "provider request failed: fetch failed" on an
   * UNCONTENDED card with the model resident, and the turn ended — "the model
   * provider failed after 2 completed round(s)". The sentence is honest and it
   * was masking a retryable condition.
   *
   * `isTransientProviderFailure` already classifies `provider request failed:` as
   * transient. The retry is then never taken, because `maxRetries` defaults to 0
   * and provider.ts states deliberately that "retrying is only ever taken under
   * the caller's explicit maxRetries budget" — the CALLER decides. This CLI is a
   * caller and had never decided.
   *
   * Two, not more: a retry is only ever taken when NOT ONE DELTA has reached the
   * caller, so it cannot duplicate text a reader has seen, and a genuinely dead
   * endpoint still fails in about a second per attempt. An explicit `params`
   * from the config wins — a reader who set 0 gets 0.
   */
  const cfg =
    resolvedCfg === undefined
      ? undefined
      : {
          ...resolvedCfg,
          params: { maxRetries: 2, ...(resolvedCfg.params ?? {}) },
        };
  if (!cfg) {
    io.err(
      'sequence ask: no AI provider configured — set SEQUENCE_AI_KEY (with ' +
        'SEQUENCE_AI_PROVIDER / SEQUENCE_AI_BASE_URL / SEQUENCE_AI_MODEL), or ' +
        'connect a key in the app so it is written to .sequence/ai.json\n',
    );
    return ASK_EXIT.NO_PROVIDER;
  }

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.on('SIGINT', onSigint);
  let timer: NodeJS.Timeout | undefined;
  if (parsed.timeoutMs !== undefined) {
    timer = setTimeout(() => controller.abort(), parsed.timeoutMs);
    // Do not hold the event loop open for the timeout's sake.
    timer.unref?.();
  }

  try {
    const t0 = Date.now();
    note(`sequence ask: scanning ${repoRoot}…`);
    const graph = await scanRepoCached(repoRoot, { cluster: true });
    note(
      `sequence ask: ${graph.nodes.length} nodes, ${graph.edges.length} edges ` +
        `in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    /*
     * THE LESSON REFUSAL, ON THE HEADLESS PATH TOO.
     *
     * `docs/research/teach-mode-driven-end-to-end.md` §3: only `repoServer.ts`
     * called `beginTeachTurn`, so `--teach` passed one boolean into the pipeline
     * and got NOTHING else — no thread, no lesson, and no refusal. The §1 fix
     * (the owner's "I want to learn about X" reaching a repo grep instead of an
     * honest "no subject here") therefore helped the app and did nothing for a
     * headless demo, which still answered with a paraphrase of the digest.
     *
     * ONLY THE REFUSAL, and that is a deliberate stopping point rather than half
     * a job. The rest of a teach turn — the lesson file, the queue, the concept,
     * the derived chart — is keyed on a THREAD, and `beginTeachTurn` refuses to
     * file a lesson under a thread the caller did not name (a180b036: a guessed
     * thread files a lesson against the wrong conversation, which is a false
     * record of what somebody was taught). A one-shot CLI ask has no
     * conversation to name, so inventing one here would be exactly that guess.
     * `refusal()` is the part that needs no thread: it is computed from the ASK
     * and the GRAPH, on purpose, for this reason.
     *
     * BEFORE the digest and before the provider, matching the server, where the
     * refusal is returned ahead of any model call — "a refusal that cost a model
     * call would be a worse answer that also spent money."
     *
     * CALLED, not restated: `subjectlessRefusal` is deliberately NOT imported
     * here. A rule in two handlers is one rule until measured, and this exact
     * rule has already been two copies once — the server had it and the browser
     * bundle did not, and a subject-less ask went to a model call anyway.
     */
    if (parsed.teach) {
      const teachRefusal = beginTeachTurn({
        teach: true,
        question,
        threadIdFromRequest: undefined,
        sessionsRoot: null,
        graph,
      }).refusal();
      if (teachRefusal !== undefined) {
        /* `source: 'lesson'` is the server's own marker for this answer: nothing
           was metered and nothing was generated. Same shape on both surfaces. */
        if (parsed.json) io.out(`${JSON.stringify({ text: teachRefusal, source: 'lesson' })}\n`);
        else io.out(`${teachRefusal}\n`);
        return ASK_EXIT.OK;
      }
    }

    const digest = buildDigest(graph, buildTree(repoRoot));
    /*
     * THE RECEIPT'S RAW MATERIAL, gathered the same way the server route
     * gathers it — a run id, a start stamp, the events as they stream, the
     * provider layer's retry counts summed per turn — because this CLI runs
     * the pipeline directly and there is no server to assemble one. The
     * instruction hash is the same `computeAskInstructionHash` the stream
     * route stamps into `trajectory:start`, over the same inputs this call
     * passes below, so a headless receipt and an app receipt for the same
     * turn shape carry the same policy-version stamp.
     */
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const trace: AskStreamEvent[] = [];
    let providerRetries: number | undefined;
    /*
     * DESIGN MODE WAS BUILT AND UNREACHABLE, WHICH IS WHY THIS IS A FLAG AND
     * NOT A FEATURE.
     *
     * `buildDesignAskPrompt` has said the right thing since it was written -
     * "you are helping the user DESIGN a software system from scratch ... use
     * ordinary software-design reasoning to propose a concrete architecture" -
     * and `designDrawBaseline` drives it on a blank-design workspace. This CLI
     * hardcoded `designMode: false` in both the hash and the pipeline call, so
     * every ask was a question ABOUT THE SCANNED REPOSITORY.
     *
     * The symptom that sent me looking: asked to design a photo-upload system,
     * the turn scanned 1085 nodes, read 0 of 2900 edges, and answered with a
     * clarifying question whose reason was "doesn't directly match any existing
     * service in the repo". That is correct behaviour for implementation mode
     * and useless for a greenfield design, and the user has no way to say which
     * they meant.
     *
     * The outline is the question itself with `proposeArchitecture: true`,
     * which is exactly the case that flag documents: "the outline is
     * question-derived (no drawn blocks yet); the model may propose a typical
     * architecture as a design proposal - never as a scan." The honesty clause
     * that keeps a proposal from being reported as evidence lives in the prompt
     * builder and is unchanged by this.
     */
    const designMode = parsed.mode === 'design';
    const designContext = designMode
      ? { title: 'Design ask', outline: question, proposeArchitecture: true }
      : undefined;
    const instructionHash = computeAskInstructionHash({
      designMode,
      ...(designMode ? { proposeArchitecture: true } : {}),
      repoRoot,
      jobMode: 'code',
      ...(parsed.teach ? { teach: true } : {}),
      ...(parsed.permission ? { permission: parsed.permission } : {}),
      question,
    });
    const receiptFor = (terminal: 'result' | 'error', pipelineResult?: AskPipelineResult, error?: string): RunReceipt =>
      buildRunReceipt({
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        terminal,
        ...(error !== undefined ? { error } : {}),
        events: trace as unknown as Record<string, unknown>[],
        ...(pipelineResult ? { result: pipelineResult } : {}),
        instructionHash,
        cfg,
        ...(parsed.permission ? { permissionMode: parsed.permission } : {}),
        ...(providerRetries !== undefined ? { providerRetries } : {}),
      });
    /* Best effort, like the server's: a receipt that cannot be written is
       one stderr line, never a failed turn. */
    const persistReceipt = (receipt: RunReceipt): void => {
      try {
        writeRunReceipt(repoRoot, receipt);
      } catch (e) {
        note(`sequence ask: run receipt not written: ${(e as Error).message}`);
      }
    };
    let result: AskPipelineResult;
    try {
      result = await runAskPipeline({
        question,
        intents: [],
        scopeLines: [],
        surface: undefined,
        deictic: false,
        ...(designContext ? { design: designContext } : { design: undefined }),
        designMode,
        /* The pipeline knows two ask modes; `design` is a third CLI-level
           choice that selects the design PROMPT, and the turn still runs as an
           implementation-shaped ask underneath. Passing 'design' through here
           would widen a type two servers also read from. */
        askMode: parsed.mode === 'design' ? 'implementation' : parsed.mode,
        jobMode: 'code',
        ...(parsed.permission ? { permission: parsed.permission } : {}),
        ...(parsed.rounds !== undefined ? { maxRounds: parsed.rounds } : {}),
        ...(parsed.turnDeadlineMs !== undefined
          ? { turnDeadlineMs: parsed.turnDeadlineMs }
          : {}),
        ...(parsed.doneWhen ? { doneWhen: parsed.doneWhen } : {}),
        ...(parsed.teach ? { teach: true } : {}),
        /*
         * THE WRITING HALF. The pipeline stages a proposal and calls this to put it on
         * disk when the permission is autoEdit/full; without it a proposal is staged and
         * dropped, which is what this CLI did for its whole life. Same jail as the server
         * path: a path that escapes the repo root is refused, never silently relocated.
         */
        applyProposedFiles: async (files) =>
          applyAskFileWrites(files, {
            repoRoot,
            resolveWritable: (rel: string) => resolveInRepo(repoRoot, rel),
            /*
             * NO PRE-WRITE HOOKS ON THE HEADLESS PATH, and said out loud rather than
             * left to be discovered. The server route runs the repository's `pre-write`
             * hooks here; wiring them needs the hook config + trust plumbing that lives
             * in repoServer, and half-wiring them would be worse than not — a hook that
             * silently does not run is a guard the reader believes they have.
             *
             * The jail above is NOT skipped: a path escaping the repo root is still
             * refused. And writing at all requires the caller to have passed
             * --permission autoEdit|full explicitly.
             */
            runPreWriteHook: async () => ({ allowed: true }),
          }),
        surfaceAnswer: undefined,
        graph,
        digest,
        cfg,
        resolveReadable: makeResolveReadable(repoRoot),
        repoRoot,
        callProvider: async (c, prompt, _onDelta, opts) => {
          if (controller.signal.aborted) throw new AbortedAsk();
          // RACE, do not pass a signal. `ProviderStreamOptions` has no `signal`
          // field — `server/repoServer.ts` widens it locally (`ProviderCallOptions`)
          // and relies on
          // its own `raceAbort` for cancellation, because the provider adapter
          // does not honour one. Handing `generateTextWithUsage` a signal here
          // would type-check only by lying about what the callee does with it,
          // which is the exact defect class this repo keeps paying for. So the
          // wait is what gets cancelled, honestly, and the in-flight request is
          // left with a catch attached so its rejection is never unhandled.
          /*
           * TOOLS REACH THE MODEL HERE, and until now they did not.
           *
           * `generateTextWithUsage(c, prompt)` was called with no tool argument, so the
           * headless path had the whole belt implemented and offered the model none of
           * it — one provider call, words back, no read_file, no edit, no search. The
           * server route has always attached them; this is the same call, with the same
           * job-mode/permission filter, so the two paths cannot answer differently.
           */
          const tools = openaiAskToolDefinitions(
            askToolsForJobMode('code', parsed.permission),
          );
          const { text, providerUsage, toolRequests, retries } = await raceAbort(
            generateTextWithUsage(c, prompt, {
              tools,
              /* Prompt caching: the pipeline names its invariant prefix; the
                 anthropic wire marks it, openai-compatible wires cache
                 identical prefixes on their own. */
              ...(opts?.cacheBreakpointChars !== undefined
                ? { cacheBreakpointChars: opts.cacheBreakpointChars }
                : {}),
            }),
            controller.signal,
          );
          if (retries !== undefined) providerRetries = (providerRetries ?? 0) + retries;
          return {
            text,
            ...(toolRequests?.length ? { toolRequests } : {}),
            usage: providerUsage
              ? {
                  inputTokens: providerUsage.inputTokens,
                  outputTokens: providerUsage.outputTokens,
                  estimated: false,
                }
              : {
                  inputTokens: approxTokens(prompt),
                  outputTokens: approxTokens(text),
                  estimated: true,
                },
          };
        },
      },
      /*
       * MACHINE-READABLE PROGRESS, for a CI consumer.
       *
       * `--json` has always emitted one object at the END, which tells a
       * pipeline nothing until the turn is over - no step boundaries, no tool
       * calls, no way to show progress or to fail fast. The pipeline has taken
       * an `emit` callback the whole time and this caller passed none, so the
       * events existed and left by no door.
       *
       * NDJSON on stdout, one event per line: the shape every CI log reader
       * and `jq` already handles, and the same event union the SSE route
       * serves - not a second vocabulary that would drift from it.
       */
      /* Collected for the receipt on every run; forwarded to stdout only
         under stream-json, so the text and --json outputs are unchanged. */
      (event) => {
        trace.push(event);
        if (parsed.outputFormat === 'stream-json') io.out(`${JSON.stringify(event)}\n`);
      },
    );
    } catch (e) {
      if (controller.signal.aborted || e instanceof AbortedAsk) {
        io.err('sequence ask: cancelled\n');
        return ASK_EXIT.CANCELLED;
      }
      /* An error terminal still gets its receipt, as on the server: the tools
         and commands that ran before the failure are the part worth reading.
         A call that exhausted its retries pins the count on the error. */
      const failedRetries = (e as { retries?: unknown }).retries;
      if (typeof failedRetries === 'number') providerRetries = (providerRetries ?? 0) + failedRetries;
      persistReceipt(receiptFor('error', undefined, (e as Error).message));
      if (e instanceof ProviderError) {
        io.err(`sequence ask: ${e.message}\n`);
        return ASK_EXIT.PROVIDER;
      }
      io.err(`sequence ask: ${(e as Error).message}\n`);
      return ASK_EXIT.PROVIDER;
    }
    const receipt = receiptFor('result', result);
    persistReceipt(receipt);

    // AN EMPTY ANSWER IS A FAILURE, NOT AN ANSWER. `docs/vision.md`: a turn
    // always ends in words. Exiting 0 with an empty stdout would hand a
    // downstream process silence and call it success.
    if (typeof result.text !== 'string' || result.text.trim() === '') {
      io.err('sequence ask: the pipeline produced no answer\n');
      return ASK_EXIT.PROVIDER;
    }

    // COVERAGE ON STDERR, NOT STDOUT — it is the one claim a terminal agent
    // structurally cannot make, and it belongs in the operator's view; putting
    // it on stdout would corrupt every pipeline that treats stdout as the
    // answer. `--json` is the way to get it machine-readably.
    if (result.coverage) {
      const c = result.coverage;
      note(
        `sequence ask: coverage ${c.edgesSeen}/${c.edgesTotal} edges` +
          (c.packagesMissed && c.packagesMissed.length > 0
            ? `, ${c.packagesMissed.length} component(s) contributed nothing`
            : ''),
      );
    }

    if (parsed.json) {
      io.out(
        JSON.stringify({
          text: result.text,
          ...(result.coverage ? { coverage: result.coverage } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.source ? { source: result.source } : {}),
          /* The done-when receipt, present only when a gate ran. ADDED, not
             restructured, and kept at the top level so no consumer breaks. */
          ...(result.verify ? { verify: result.verify } : {}),
          /* The full change receipt (audit G3), under its own key for the
             same reason: every key above is byte-identical to what shipped. */
          receipt,
        }) + '\n',
      );
    } else {
      io.out(result.text.endsWith('\n') ? result.text : `${result.text}\n`);
    }
    // The answer is out either way; the code says whether the gate the caller
    // named held. A skip is the caller's own recorded choice and is not a failure.
    return result.verify?.status === 'failed' ? ASK_EXIT.UNVERIFIED : ASK_EXIT.OK;
  } catch (e) {
    if (controller.signal.aborted) {
      io.err('sequence ask: cancelled\n');
      return ASK_EXIT.CANCELLED;
    }
    // A scan failure lands here: an unscannable repo is a repo problem, not a
    // provider problem, and the codes must not blur that.
    io.err(`sequence ask: ${(e as Error).message}\n`);
    return ASK_EXIT.REPO;
  } finally {
    if (timer) clearTimeout(timer);
    process.off('SIGINT', onSigint);
  }
}

/** Internal marker so an abort is never mistaken for a provider failure. */
class AbortedAsk extends Error {
  constructor() {
    super('cancelled');
    this.name = 'AbortedAsk';
  }
}

/**
 * Resolve `work`, unless `signal` fires first — in which case reject with
 * {@link AbortedAsk} and leave a `catch` attached to the loser so a later
 * rejection is never an unhandled one. Same shape as `repoServer.ts`'s
 * `raceAbort`, for the same reason: the provider adapter cannot be interrupted,
 * so what is cancelled is the WAIT. Ctrl-C therefore returns control
 * immediately and the exit code says `cancelled`; it does not claim the request
 * was recalled.
 */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {});
    return Promise.reject(new AbortedAsk());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new AbortedAsk());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
