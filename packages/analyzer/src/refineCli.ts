/**
 * `sequence harness <refine|distill|list>` — the by-hand entry to the learning loop.
 *
 * The harness routes (`/api/harness/*` in server/repoServer.ts) had no caller:
 * no web2 surface, no CLI verb, no CI job. This file is the cheapest REAL
 * caller — the same store, the same planner, the same distill, run against a
 * repo directory with nothing else running (local-first: no server, no key).
 *
 * WHAT IS DELIBERATELY NOT HERE: accept / deny / rollback. Accept is the one
 * step that writes the target, and the route verify-gates it (schema-validate
 * on a SKILL.md, then the schema test) before the edit lands. A CLI accept that
 * skipped that gate would be a second, weaker write path; one that copied it
 * would be a second implementation of it. Neither is worth having yet, so the
 * CLI plans, distils and lists, and the ruling stays on the route.
 *
 * Same two properties as `sequence ask` (askCli.ts): the report is the only
 * thing on stdout (`--json` makes it one object), and the exit code is honest —
 * "no repeated failure pattern" is an ANSWER and exits 0; a loop that could not
 * run does not.
 */

import fs from 'node:fs';
import path from 'node:path';
import { runLearningLoop, type LearningLoopOutcome } from './harness/learningLoop.js';
import { listRefineProposals, type RefineProposal } from './harness/refineProposal.js';
import { distillSkillsFromTrajectories } from './harness/skillDistill.js';

/**
 * Exit codes, fixed so a script can branch on them. `REPO` matches
 * `ASK_EXIT.REPO` so a wrapper that already handles "repo unusable" for
 * `sequence ask` handles it here for free.
 */
export const HARNESS_EXIT = {
  OK: 0,
  USAGE: 2,
  /** The loop / distill ran and reported a failure (store write, planner throw, refused cluster). */
  FAILED: 3,
  REPO: 5,
} as const;

export interface HarnessCliIo {
  /** The report — the only thing on stdout. */
  out: (text: string) => void;
  /** Usage errors and diagnostics. */
  err: (text: string) => void;
}

const defaultIo: HarnessCliIo = {
  out: (t) => process.stdout.write(t),
  err: (t) => process.stderr.write(t),
};

export const HARNESS_USAGE = `usage: sequence harness <refine|distill|list> [--repo <dir>] [--json]

  The learning loop, by hand. Reads <dir>/.sequence/trajectory/ (the persisted
  ask runs) and writes only under <dir>/.sequence/. No model, no key, no server.

  refine            find a repeated FAILURE pattern (>=2 failed asks sharing an
                    intent, or a file read across failed runs) and persist the
                    smallest evidence-backed edit as a PENDING proposal under
                    .sequence/refinements/<id>/. Never applies it: accept, deny
                    and rollback stay on the app's verify-gated route.
  distill           write .sequence/skills/<slug>/SKILL.md for every cluster of
                    >=3 SUCCESSFUL asks sharing an intent (template body).
  list              print pending proposals. --all includes accepted, denied
                    and rolled-back ones.
  --repo <dir>      the repository (default: the current directory).
  --json            emit the same report as one JSON object.

exit codes:
  ${HARNESS_EXIT.OK}  done (including "no repeated failure pattern")
  ${HARNESS_EXIT.USAGE}  bad usage
  ${HARNESS_EXIT.FAILED}  the loop or distill reported a failure
  ${HARNESS_EXIT.REPO}  --repo is not a directory
`;

interface ParsedHarnessArgs {
  sub?: string;
  repo: string;
  json: boolean;
  all: boolean;
  error?: string;
}

function parseHarnessArgs(argv: string[]): ParsedHarnessArgs {
  const args = [...argv];
  const take = (name: string): string | undefined => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const has = (name: string): boolean => {
    const i = args.indexOf(name);
    if (i < 0) return false;
    args.splice(i, 1);
    return true;
  };
  const repoFlag = args.includes('--repo');
  const repoArg = take('--repo');
  const base: ParsedHarnessArgs = {
    repo: repoArg && repoArg !== '' ? repoArg : process.cwd(),
    json: has('--json'),
    all: has('--all'),
  };
  // `--repo` with nothing after it (or the next flag after it) must not fall
  // back to the cwd: this verb WRITES under <repo>/.sequence/, and "wherever
  // the shell happens to be" is the wrong place to learn that the value was missing.
  if (repoFlag && (repoArg === undefined || repoArg === '' || repoArg.startsWith('--'))) {
    return { ...base, error: '--repo needs a directory' };
  }
  // An unconsumed `--flag` is a typo, not a subcommand (same rule as askCli).
  const stray = args.find((a) => a.startsWith('--'));
  if (stray) return { ...base, error: `unknown flag '${stray}'` };
  base.sub = args.shift();
  if (args.length > 0) return { ...base, error: `unexpected argument '${args[0]}'` };
  return base;
}

/** Run one `sequence harness …` invocation. Returns the process exit code. */
export async function runHarnessCli(argv: string[], io: HarnessCliIo = defaultIo): Promise<number> {
  const parsed = parseHarnessArgs(argv);
  if (parsed.error) {
    io.err(`sequence harness: ${parsed.error}\n\n${HARNESS_USAGE}`);
    return HARNESS_EXIT.USAGE;
  }
  if (parsed.sub !== 'refine' && parsed.sub !== 'distill' && parsed.sub !== 'list') {
    io.err(
      `sequence harness: ${parsed.sub ? `unknown subcommand '${parsed.sub}'` : 'missing subcommand'}\n\n${HARNESS_USAGE}`,
    );
    return HARNESS_EXIT.USAGE;
  }
  let repoRoot: string;
  try {
    repoRoot = path.resolve(parsed.repo);
    if (!fs.statSync(repoRoot).isDirectory()) throw new Error('not a directory');
  } catch {
    io.err(`sequence harness: --repo is not a directory: ${parsed.repo}\n`);
    return HARNESS_EXIT.REPO;
  }

  if (parsed.sub === 'refine') return runRefine(repoRoot, parsed.json, io);
  if (parsed.sub === 'distill') return runDistill(repoRoot, parsed.json, io);
  return runList(repoRoot, parsed.json, parsed.all, io);
}

/** The stdout line for a run that found nothing — a sentence tests match on. */
export const NO_PATTERN_LINE = 'no repeated failure pattern';

async function runRefine(repoRoot: string, json: boolean, io: HarnessCliIo): Promise<number> {
  const outcome = await runLearningLoop(repoRoot);
  if (json) {
    io.out(`${JSON.stringify(outcome)}\n`);
  } else {
    io.out(`${formatOutcome(outcome, repoRoot)}\n`);
  }
  return outcome.disposition === 'error' || outcome.disposition === 'write-failed'
    ? HARNESS_EXIT.FAILED
    : HARNESS_EXIT.OK;
}

function formatOutcome(outcome: LearningLoopOutcome, repoRoot: string): string {
  if (outcome.disposition === 'error' || outcome.disposition === 'write-failed') {
    return `refine failed: ${outcome.error ?? outcome.disposition}`;
  }
  if (!outcome.proposal) {
    return noPatternReport(repoRoot);
  }
  const lines = [
    `${dispositionLabel(outcome.disposition)} ${outcome.proposal.id}`,
    ...formatProposalBody(outcome.proposal),
    ...nextStep(outcome),
  ];
  return lines.join('\n');
}

/**
 * "Nothing found" has to say what was looked at, or the reader cannot tell
 * "no failures yet" from "the planner never read a thing". The count is the
 * trajectory files on disk — the planner's input — not a claim about how many
 * it accepted.
 */
function noPatternReport(repoRoot: string): string {
  const dir = path.join(repoRoot, '.sequence', 'trajectory');
  let runs: number | undefined;
  try {
    runs = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
  } catch {
    runs = undefined;
  }
  const seen =
    runs === undefined
      ? 'no persisted runs yet — the directory does not exist'
      : `${runs} persisted run${runs === 1 ? '' : 's'} read`;
  return (
    `${NO_PATTERN_LINE} in ${dir} (${seen}; a pattern is >=2 FAILED asks sharing ` +
    'an intent, or one file read across failed runs)'
  );
}

/** What the reader does next — a written proposal with no next step is a dead end. */
function nextStep(outcome: LearningLoopOutcome): string[] {
  if (outcome.disposition === 'written' || outcome.disposition === 'unchanged') {
    return [
      `  next      review .sequence/refinements/${outcome.persistedId ?? outcome.proposal?.id ?? '<id>'}/ — accept, deny or roll back on the app's verify-gated route`,
      `            (POST /api/harness/refine/<id>/accept | /deny | /rollback); nothing is applied until then`,
    ];
  }
  if (outcome.disposition === 'already-ruled') {
    return [`  next      nothing — the ruling above stands; the loop will not rewrite it`];
  }
  return [];
}

function dispositionLabel(d: LearningLoopOutcome['disposition']): string {
  switch (d) {
    case 'written':
      return 'proposal written (pending)';
    case 'unchanged':
      return 'proposal already pending, unchanged';
    case 'already-ruled':
      // The body that follows is the ON-DISK proposal, so its `status` line is
      // the ruling (denied / accepted / rolled_back), not a fresh `pending`.
      return 'proposal already ruled on, left alone';
    default:
      return d;
  }
}

function formatProposalBody(p: RefineProposal): string[] {
  return [
    `  status    ${p.status}`,
    `  trigger   ${p.trigger}`,
    `  target    ${p.targetPath}${p.before.length === 0 ? ' (new file)' : ''}`,
    `  evidence  ${p.evidenceRefs.runIds.join(', ')}`,
    ...(p.evidenceRefs.filePaths.length > 0 ? [`  files     ${p.evidenceRefs.filePaths.join(', ')}`] : []),
  ];
}

async function runDistill(repoRoot: string, json: boolean, io: HarnessCliIo): Promise<number> {
  // No `knownServiceIds`: this path scans nothing, so no service grounding is
  // claimed and none is refused on those grounds (see DistillOptions). No LLM:
  // the template body is what a repo with no key gets on the route too.
  let result: { written: Array<{ slug: string; filePath: string }>; errors: string[] };
  try {
    result = await distillSkillsFromTrajectories(repoRoot);
  } catch (e) {
    io.err(`sequence harness: distill failed: ${(e as Error).message}\n`);
    return HARNESS_EXIT.FAILED;
  }
  if (json) {
    io.out(
      `${JSON.stringify({
        written: result.written.map((s) => ({ slug: s.slug, filePath: s.filePath })),
        errors: result.errors,
      })}\n`,
    );
  } else {
    const lines: string[] = [];
    if (result.written.length === 0) lines.push('no cluster of >=3 successful asks to distil');
    for (const s of result.written) lines.push(`wrote ${s.slug}  ${s.filePath}`);
    for (const e of result.errors) lines.push(`refused: ${e}`);
    io.out(`${lines.join('\n')}\n`);
  }
  return result.errors.length > 0 ? HARNESS_EXIT.FAILED : HARNESS_EXIT.OK;
}

function runList(repoRoot: string, json: boolean, all: boolean, io: HarnessCliIo): number {
  const proposals = listRefineProposals(repoRoot).filter((p) => all || p.status === 'pending');
  if (json) {
    io.out(`${JSON.stringify({ proposals })}\n`);
    return HARNESS_EXIT.OK;
  }
  if (proposals.length === 0) {
    io.out(`${all ? 'no proposals' : 'no pending proposals'} under ${path.join(repoRoot, '.sequence', 'refinements')}\n`);
    return HARNESS_EXIT.OK;
  }
  const lines: string[] = [];
  for (const p of proposals) {
    lines.push(p.id);
    lines.push(...formatProposalBody(p));
  }
  io.out(`${lines.join('\n')}\n`);
  return HARNESS_EXIT.OK;
}
