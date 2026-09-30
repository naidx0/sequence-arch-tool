import fs from 'node:fs';
import path from 'node:path';

/**
 * ══ `/plan` — A PLANNING TURN ══════════════════════════════════════════════
 *
 * Owner, 2026-09-22: "in default we should be running in slash build, but once
 * people have something difficult to do, like in cursor, they can use slash
 * plan to invoke a certain set of tools which helps the model create number
 * one a goal, number two a to-do list, and number three an in-depth plan …
 * not a select guide rail that it has to absolutely follow or cancel or fall
 * out … this guidance framework to just hint at the model to create these
 * things. And if it doesn't create these things, it's okay."
 *
 * So this module is two things and no more:
 *
 *   `parsePlanCommand` — `/plan <task>` arrives as the question. The prefix is
 *   the person choosing to plan; it is taken off so the model reads the task,
 *   and the turn is marked a planning turn.
 *
 *   `PLANNING_GUIDANCE` — what a good plan usually holds, written as an offer.
 *   No refusal, no forced round, no "EXACTLY", no count the turn must reach. A
 *   plan that leaves a part out is still a plan; what we learn from is how
 *   often each part appears across the live battery
 *   (docs/OWNER-WALK-2026-09-22.md, "Guidance, not gates").
 *
 * The goal and the steps need nothing new: a Plan-mode turn is already offered
 * `write_plan`, and writing a plan makes the request the goal
 * (`sessionsStore.planTurnGoalCandidate`).
 */

const PLAN_PREFIX = /^\s*\/plan\b[\s:]*/i;

/** How many canvas blocks a planning turn may write; an ordinary turn writes one. */
export const PLANNING_CANVAS_WRITES = 6;

/** The Plan tab of the AI Canvas (web2 `app/canvasSurfaces.ts`). */
export const PLAN_SURFACE = 'plan';

export function parsePlanCommand<T>(question: T): { question: T; planning: boolean } {
  if (typeof question !== 'string') return { question, planning: false };
  if (!PLAN_PREFIX.test(question)) return { question, planning: false };
  const task = question.replace(PLAN_PREFIX, '').trim();
  /* A bare "/plan" names no task; the composer switches the mode for that. */
  if (task === '') return { question, planning: false };
  return { question: task as T, planning: true };
}

export const PLANNING_GUIDANCE: readonly string[] = [
  '--- PLANNING THIS TASK ---',
  'The person asked for a plan before anything is built, so the scope is theirs and already ' +
    'given: plan it rather than asking about it. Where you had to assume something, say so in ' +
    'one line in the plan; they can correct the plan afterwards.',
  'A useful plan usually has three parts:',
  '1. The goal and the steps: call `write_plan` with steps small enough to do one per turn. ' +
    'The first plan also becomes the session goal, and "Work on goal" later runs the steps in Build.',
  '2. The plan document on the Plan tab: `canvas.write_markdown` with `"surface": "plan"`. Say ' +
    'why, what changes, where it sits in the system, and the risks.',
  '3. Optional, when they help the reader: pictures on the same tab — a before-and-after pair of Mermaid flowcharts ' +
    '(`canvas.write_mermaid`, surface "plan") showing the system loop without the change and ' +
    'with it; a decision record for each real choice (context, options, decision, ' +
    'consequences); and the expected effect of the change, such as accuracy up or latency down, ' +
    'marked as an estimate with what it is based on (`propose_chart` kind "before-and-after" ' +
    'or "scorecard", surface "plan").',
  'Read what you need first (read_topology and read_file show the real system, and the plan ' +
    'can point at real parts of it). None of this is required: include what fits this task and ' +
    'leave out what does not. If a tool refuses something, carry on with the rest of the plan.',
];

/**
 * THE PLAN DOCUMENT IS A FILE TOO. Every Markdown block written to the Plan tab
 * this turn, in order, at `.sequence/plans/<thread>.md`, so the plan opens in
 * Files beside chat and outlives the canvas. Returns the path written, or null
 * when nothing could be (the canvas still holds the plan; a turn is never
 * failed for this).
 */
export function writePlanDocument(
  repoRoot: string,
  threadId: string | undefined,
  blocks: ReadonlyMap<string, string>,
): string | null {
  if (blocks.size === 0) return null;
  try {
    const dir = path.join(repoRoot, '.sequence', 'plans');
    fs.mkdirSync(dir, { recursive: true });
    const name = (threadId ?? 'plan').replace(/[^A-Za-z0-9_-]+/g, '-') || 'plan';
    const file = path.join(dir, `${name}.md`);
    fs.writeFileSync(file, [...blocks.values()].join('\n\n'), 'utf8');
    return file;
  } catch {
    return null;
  }
}

/** How much of the plan document a build turn carries. */
export const PLAN_DOCUMENT_PROMPT_CHARS = 4000;

/** The plan document for a thread, or undefined when none was written. */
export function readPlanDocument(repoRoot: string, threadId: string | undefined): string | undefined {
  try {
    const name = (threadId ?? 'plan').replace(/[^A-Za-z0-9_-]+/g, '-') || 'plan';
    const text = fs.readFileSync(path.join(repoRoot, '.sequence', 'plans', `${name}.md`), 'utf8').trim();
    return text === '' ? undefined : text;
  } catch {
    return undefined;
  }
}
