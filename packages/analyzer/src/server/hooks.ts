/**
 * LIFECYCLE HOOKS — the mechanism, deliberately not the breadth.
 *
 * CANON names this as the last gap holding the agent-workflow claim at ◐, and
 * in the same sentence rules the obvious version out: "29 events with
 * exit-code-2 blocking on 15 of them — which is BREADTH, and breadth is
 * deliberately out of scope."
 *
 * So this is not a copy of somebody's event surface. What CANON actually
 * reports as broken is one line up: this repository's own three gates are
 * "enforced by prose". A rule nothing can enforce is a rule that holds until
 * the round nobody has time to read it. The events below are the points where
 * THIS product does something a rule would want to stop — six, not
 * twenty-nine — and the set is small on purpose, because every event is a
 * promise to keep firing it.
 *
 * ── EXIT CODE 2 BLOCKS. EVERYTHING ELSE DOES NOT. ────────────────────────
 *
 * A hook that fails because `jq` is not installed must not silently prevent a
 * write; a hook that means "no" must be unmistakable. So 2 is the only blocking
 * code, 0 is approval, and any other non-zero is reported as a hook that broke
 * — which is a fact about the hook, not a verdict about the action.
 *
 * ── THEY DO NOT RUN WITHOUT CONSENT, AND THAT IS THE WHOLE POSTURE ───────
 *
 * A hook file is COMMITTED TO THE REPOSITORY. Running it on attach would mean
 * that opening someone's project executes their code — cloning a repo to look
 * at its architecture would be enough to be compromised. There is no version of
 * that which is acceptable, and "we only run it when you ask a question" is not
 * a mitigation.
 *
 * So: hooks are disabled unless the USER has enabled them for that exact repo
 * path, in USER-level config the repo cannot write. `.sequence/hooks.json`
 * declares what would run; `~/.sequence/hook-trust.json` decides whether it
 * does. A repo can propose. Only the person can consent.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * The points where this product does something a rule would want to stop.
 *
 * SIX, and each earns its place by being a real moment in this codebase rather
 * than a slot in someone else's table. Adding a seventh means committing to
 * fire it forever, which is why the list is short and each has a reason:
 *
 *   session-start   before the first turn — where a repo states its rules.
 *   pre-tool        before an ask tool runs. The broadest guard.
 *   post-tool       after one, for recording rather than stopping.
 *   pre-write       before `PUT /api/file` replaces a file. The one that
 *                   matters most: it is the only moment disk changes.
 *   pre-commit      before `git commit`. Where a project's own gate lives.
 *   run-finished    after a program run ends, for notification and cleanup.
 */
export const HOOK_EVENTS = [
  'session-start',
  'pre-tool',
  'post-tool',
  'pre-write',
  'pre-commit',
  'run-finished',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/**
 * The events that ACTUALLY FIRE today.
 *
 * `HOOK_EVENTS` is the design — six events, and the shape is right. Only two
 * of them have a call site: `pre-write` (repoServer's file write) and
 * `pre-commit` (its commit path). The other four are declared, documented,
 * accepted by the hooks file reader, and invoked by nothing.
 *
 * A user who writes a `pre-tool` hook gets SILENCE. Their script never runs,
 * nothing says why, and the most likely conclusion is that their script is
 * broken — so they debug the wrong thing. Advertising a lifecycle event that
 * cannot fire is worse than not offering it, because the failure is invisible
 * and looks like theirs.
 *
 * Kept as a separate set rather than by trimming `HOOK_EVENTS`, because the
 * six are the intended surface and deleting four would lose the design. What
 * was missing is the honesty, not the ambition.
 */
export const HOOK_EVENTS_LIVE: ReadonlySet<HookEvent> = new Set(['pre-write', 'pre-commit']);

/** Whether a configured hook for this event can ever run. */
export function hookEventFires(event: string): boolean {
  return HOOK_EVENTS_LIVE.has(event as HookEvent);
}

/**
 * One sentence naming every configured hook that cannot fire, or null.
 *
 * Null when everything configured is live — and null rather than "all good",
 * because a surface that congratulates the reader on every render is a surface
 * they stop reading.
 */
export function unfiredHookWarning(configured: readonly string[]): string | null {
  const dead = [...new Set(configured.filter((e) => !hookEventFires(e)))].sort();
  if (dead.length === 0) return null;
  return (
    `${dead.join(', ')} ${dead.length === 1 ? 'is' : 'are'} configured but never fires yet — ` +
    `nothing in Sequence invokes ${dead.length === 1 ? 'it' : 'them'}, so ${dead.length === 1 ? 'that hook' : 'those hooks'} will not run.`
  );
}

/** Events at which exit code 2 stops the action. */
export const BLOCKING_EVENTS: ReadonlySet<HookEvent> = new Set([
  'session-start',
  'pre-tool',
  'pre-write',
  'pre-commit',
]);

export interface HookSpec {
  /** The command, as argv. NEVER a shell string — see `runHook`. */
  command: string[];
  /** Milliseconds before the hook is killed. Default 10_000. */
  timeoutMs?: number;
}

export interface HookFile {
  version: 1;
  hooks: Partial<Record<HookEvent, HookSpec[]>>;
}

export type HookOutcome =
  /** Exit 0 — the hook approved, or had no opinion. */
  | { kind: 'ok'; command: string; stdout: string }
  /** Exit 2 at a blocking event — the action must not happen. */
  | { kind: 'blocked'; command: string; reason: string }
  /** Any other failure — the HOOK broke, which is not a verdict on the action. */
  | { kind: 'broke'; command: string; reason: string };

export interface HookRunResult {
  /** True when nothing blocked. A hook that broke does NOT block. */
  allowed: boolean;
  outcomes: HookOutcome[];
  /** Why hooks did not run at all, when they did not. */
  skipped?: 'not-trusted' | 'no-hooks';
}

/** The user-level file that decides which repos may run their own hooks. */
export interface HookTrust {
  version: 1;
  /** Absolute repo paths the user has explicitly enabled. */
  trusted: string[];
}

/**
 * Whether this repo may run its committed hooks.
 *
 * Compared on a NORMALISED absolute path, so `C:\repo` and `C:/repo/` are one
 * entry and a trailing slash is not a way to be a different repository. The
 * comparison is case-insensitive only on Windows, where the filesystem is.
 */
export function isTrusted(repoRoot: string, trust: HookTrust | undefined): boolean {
  if (!trust || !Array.isArray(trust.trusted)) return false;
  const norm = (p: string): string => {
    const abs = path.resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  };
  const target = norm(repoRoot);
  return trust.trusted.some((t) => typeof t === 'string' && norm(t) === target);
}

/**
 * Validate a hook file. A malformed entry is DROPPED with a reason, never
 * guessed at — a hook we half understand is one we must not run.
 */
export function parseHookFile(raw: unknown): { file: HookFile; warnings: string[] } {
  const warnings: string[] = [];
  const hooks: Partial<Record<HookEvent, HookSpec[]>> = {};
  const obj = raw as { version?: unknown; hooks?: unknown } | null;

  if (!obj || typeof obj !== 'object' || obj.version !== 1) {
    return { file: { version: 1, hooks: {} }, warnings: ['hooks file must be {"version":1,...}'] };
  }
  const table = (obj.hooks ?? {}) as Record<string, unknown>;
  for (const [event, value] of Object.entries(table)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) {
      warnings.push(`unknown hook event ${JSON.stringify(event)} — ignored`);
      continue;
    }
    if (!Array.isArray(value)) {
      warnings.push(`hooks.${event} must be an array — ignored`);
      continue;
    }
    const specs: HookSpec[] = [];
    value.forEach((entry, i) => {
      const e = entry as { command?: unknown; timeoutMs?: unknown };
      if (!e || !Array.isArray(e.command) || e.command.length === 0) {
        /* ARGV, NEVER A SHELL STRING. A string would have to be split by
           something, and every splitter is a place where a repo-committed
           `; rm -rf ~` becomes a second command. */
        warnings.push(`hooks.${event}[${i}].command must be a non-empty argv array — ignored`);
        return;
      }
      if (!e.command.every((c) => typeof c === 'string')) {
        warnings.push(`hooks.${event}[${i}].command must be strings — ignored`);
        return;
      }
      const timeoutMs =
        typeof e.timeoutMs === 'number' && e.timeoutMs > 0 ? Math.min(e.timeoutMs, 120_000) : 10_000;
      specs.push({ command: e.command as string[], timeoutMs });
    });
    if (specs.length > 0) hooks[event as HookEvent] = specs;
  }
  return { file: { version: 1, hooks }, warnings };
}

/** Run one hook. `spawn` without a shell, so argv stays argv. */
async function runHook(
  spec: HookSpec,
  event: HookEvent,
  repoRoot: string,
  payload: unknown,
): Promise<HookOutcome> {
  const [cmd, ...args] = spec.command;
  const shown = spec.command.join(' ');
  return await new Promise<HookOutcome>((resolve) => {
    let settled = false;
    const done = (o: HookOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd!, args, {
        cwd: repoRoot,
        /* NO SHELL. `shell: true` would make every argument a shell fragment and
           turn a repo-committed hook into arbitrary command injection. */
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SEQUENCE_HOOK_EVENT: event,
          SEQUENCE_REPO_ROOT: repoRoot,
        },
      });
    } catch (e) {
      done({ kind: 'broke', command: shown, reason: (e as Error).message });
      return;
    }

    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => {
      /* Bounded: a hook that prints a megabyte must not become the reason the
         server runs out of memory. */
      if (out.length < 64_000) out += String(d);
    });
    child.stderr?.on('data', (d) => {
      if (err.length < 64_000) err += String(d);
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done({
        kind: 'broke',
        command: shown,
        reason: `hook timed out after ${spec.timeoutMs}ms`,
      });
    }, spec.timeoutMs ?? 10_000);

    child.on('error', (e) => {
      clearTimeout(timer);
      done({ kind: 'broke', command: shown, reason: e.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        done({ kind: 'ok', command: shown, stdout: out.trim() });
        return;
      }
      if (code === 2 && BLOCKING_EVENTS.has(event)) {
        /*
         * TWO IS THE ONLY "NO". The hook's own stderr is the reason, verbatim —
         * a blocked action the user cannot get an explanation for is a wall.
         */
        done({
          kind: 'blocked',
          command: shown,
          reason: (err.trim() || out.trim()) || `hook exited 2 with no message`,
        });
        return;
      }
      /* Any other code: the hook BROKE. It does not block, because a hook that
         cannot run is not a rule that says no — `jq: command not found` must
         never silently prevent a write. */
      done({
        kind: 'broke',
        command: shown,
        reason: (err.trim() || `hook exited ${code}`).slice(0, 2_000),
      });
    });

    try {
      child.stdin?.end(JSON.stringify({ event, repoRoot, payload }));
    } catch {
      /* A hook that closed stdin early is not an error. */
    }
  });
}

/**
 * Fire every hook registered for `event`, in file order.
 *
 * SEQUENTIAL, and it STOPS AT THE FIRST BLOCK. Running the rest would spend the
 * user's time on hooks whose answer cannot change the outcome, and — worse —
 * a `post`-style hook that assumed the action happened would run for an action
 * that did not.
 */
export async function runHooks(
  event: HookEvent,
  ctx: { repoRoot: string; file: HookFile | undefined; trusted: boolean; payload?: unknown },
): Promise<HookRunResult> {
  if (!ctx.trusted) {
    /* The repo may declare hooks; only the person can consent to them running.
       Reported rather than silent, so a user who wrote a hook and sees nothing
       happen learns why. */
    return { allowed: true, outcomes: [], skipped: 'not-trusted' };
  }
  const specs = ctx.file?.hooks?.[event] ?? [];
  if (specs.length === 0) return { allowed: true, outcomes: [], skipped: 'no-hooks' };

  const outcomes: HookOutcome[] = [];
  for (const spec of specs) {
    const outcome = await runHook(spec, event, ctx.repoRoot, ctx.payload);
    outcomes.push(outcome);
    if (outcome.kind === 'blocked') return { allowed: false, outcomes };
  }
  return { allowed: true, outcomes };
}
