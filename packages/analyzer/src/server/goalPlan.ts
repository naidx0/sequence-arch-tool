/**
 * THE PLAN A GOAL RUN WORKS DOWN — parse, render, tick, park. Pure.
 *
 * ── WHY THIS IS NOT `todoList.ts` ────────────────────────────────────────────
 *
 * `todoList.ts` opens by saying "NOTHING HERE EXECUTES ANYTHING", and it is
 * right: that list belongs to ONE TURN. It is initialised empty at the top of
 * every turn (`askPipeline.ts`, `todosThisTurn`), re-rendered into each round's
 * prompt, and thrown away when the turn ends. It is a progress display for a
 * reader watching sixteen tool rounds go by, and it is a good one.
 *
 * This plan OUTLIVES THE TURN, and that single difference is the whole feature.
 * Owner, 2026-09-17: "If you look at ML Harness, the goals there are more
 * straightforward: once you create a goal, you can tell the agent to work on
 * the goal, and that way we can enforce long-running tasks even with weaker
 * models." A weaker model cannot hold a twenty-step job in its head for
 * twenty turns. It does not have to: the job is on disk, the runner reads the
 * first open step off disk before each turn, and the model is asked to do one
 * thing. Enforcement lives in the loop, not in the model's memory.
 *
 * ── THE TWO RULES ML HARNESS PAID FOR ───────────────────────────────────────
 *
 * 1. ACCEPTANCE IS A CHECKBOX THE PLAN EITHER HAS OR DOES NOT, NEVER A PHRASE.
 *    A loop that decides whether a step finished by reading the model's prose
 *    ends the moment the model says a finishing-sounding sentence, and a model
 *    says finishing-sounding sentences constantly — "I'll now update the
 *    parser", "that should do it". So the ONLY thing that closes a step is the
 *    `[x]`, written by `markStepDone` on an explicit tool call. Nothing in this
 *    file reads prose for a verdict, and nothing should be added that does.
 *
 * 2. A TURN THAT PRODUCED NOTHING COSTS THE STEP NO STRIKE. That rule lives in
 *    `goalRunner.ts` because it is about turns, not about steps — but it is the
 *    reason `parkStep` here takes a `why` from the caller instead of inventing
 *    one. A park is a claim that a step could not be done, and a claim needs a
 *    reason that came from somewhere.
 *
 * ── THE LINE FORMAT ─────────────────────────────────────────────────────────
 *
 *   - [ ] Read packages/analyzer/src/server/askTools.ts with read_file
 *   - [x] Add the goal section to the prompt assembly
 *   - [!] Measure the baseline — parked: run_command refused: no such script
 *
 * Markdown a person can read and edit by hand, because they will. ONE parse
 * function and ONE match function, deliberately: ML Harness grew four
 * step-line regexes and two different fuzzy-match strategies across its Python
 * and TypeScript halves, and the TS `unpark` matched on exact equality while
 * the Python one matched on containment — so the same click silently no-opped
 * in one place and worked in the other. There is one of each here.
 */

import type { PlanStep, PlanStepStatus } from '@sequence/api-types';

/**
 * One checklist line. Four groups so a rewrite keeps the author's own
 * indentation and bullet glyph — a tick that reformats the line the person
 * wrote is a diff they did not ask for.
 */
export const PLAN_LINE_RE = /^(\s*[-*]\s+\[)([ xX!])(\]\s+)(.+)$/;

/**
 * What separates a parked step from its reason. EM DASH (U+2014), one space
 * either side.
 *
 * It is a constant rather than a literal in three places because the render
 * side and the parse side must agree byte for byte: a render that emits an
 * en dash and a parse that looks for an em dash produces a plan whose parked
 * reasons vanish on the next read, and every step still looks parked.
 */
export const PARKED_MARK = ' — parked: ';

/** Enough steps for real work, few enough that the plan stays readable. */
export const MAX_PLAN_STEPS = 40;

/** One step is one line; a paragraph is not a step. */
export const MAX_PLAN_STEP_CHARS = 300;

/** A park reason is a sentence, not a transcript. */
export const MAX_PARK_WHY_CHARS = 220;

/** Ids are path-safe and short — they travel in tool arguments and in JSON. */
const MAX_PLAN_ID_CHARS = 64;

const MARK: Record<PlanStepStatus, string> = { open: ' ', done: 'x', parked: '!' };

function squash(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

/* ------------------------------ reading a plan ---------------------------- */

/** Steps still to do. The run aims at `openSteps(plan)[0]` and nothing else. */
export function openSteps(steps: readonly PlanStep[]): PlanStep[] {
  return steps.filter((s) => s.status === 'open');
}

export function firstOpenStep(steps: readonly PlanStep[]): PlanStep | undefined {
  return steps.find((s) => s.status === 'open');
}

export interface PlanCounts {
  total: number;
  open: number;
  done: number;
  parked: number;
}

export function planCounts(steps: readonly PlanStep[]): PlanCounts {
  let open = 0;
  let done = 0;
  let parked = 0;
  for (const s of steps) {
    if (s.status === 'open') open += 1;
    else if (s.status === 'done') done += 1;
    else parked += 1;
  }
  return { total: steps.length, open, done, parked };
}

/* ---------------------------- checklist text ⇄ steps ---------------------- */

/**
 * Parse a markdown checklist into steps.
 *
 * Lines that are not checklist lines are DROPPED, not preserved as prose. The
 * plan's storage shape is `PlanStep[]`; the markdown is an input format a
 * person (or a model writing `write_plan`) may use, not a document we round-
 * trip. Preserving prose here would mean the stored plan and the rendered plan
 * disagree about what is in it, which is the ambiguity this module exists to
 * remove.
 */
export function parsePlanChecklist(text: string, idSeed = 0): PlanStep[] {
  const out: PlanStep[] = [];
  let n = idSeed;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = PLAN_LINE_RE.exec(line);
    if (!m) continue;
    const mark = m[2]!;
    let body = m[4]!.trim();
    let why = '';
    const at = body.indexOf(PARKED_MARK);
    if (at >= 0) {
      why = body.slice(at + PARKED_MARK.length).trim();
      body = body.slice(0, at).trim();
    }
    if (body === '') continue;
    n += 1;
    const status: PlanStepStatus = mark === 'x' || mark === 'X' ? 'done' : mark === '!' ? 'parked' : 'open';
    const step: PlanStep = {
      id: `s${n}`,
      text: body.slice(0, MAX_PLAN_STEP_CHARS),
      status,
    };
    /* A `why` is kept only where it cannot be mistaken for something else: on a
       parked step it is the reason, anywhere else it is a stray em dash in the
       author's prose and belongs back in the text. */
    if (status === 'parked') step.why = why.slice(0, MAX_PARK_WHY_CHARS) || 'no reason recorded';
    else if (why !== '') step.text = `${step.text}${PARKED_MARK}${why}`.slice(0, MAX_PLAN_STEP_CHARS);
    out.push(step);
    if (out.length >= MAX_PLAN_STEPS) break;
  }
  return out;
}

/** The plan as markdown — what the prompt shows and what a person can edit. */
export function renderPlanChecklist(steps: readonly PlanStep[]): string {
  return steps
    .map((s) => {
      const tail = s.status === 'parked' ? `${PARKED_MARK}${s.why ?? 'no reason recorded'}` : '';
      return `- [${MARK[s.status]}] ${s.text}${tail}`;
    })
    .join('\n');
}

/* ------------------------------- validation ------------------------------- */

export type PlanValidation =
  | { ok: true; steps: PlanStep[] }
  | { ok: false; reason: string };

/**
 * Is this a plan? REFUSES rather than repairs, on every rule — the stance
 * `parseTodos` takes and for its reason: a tool that quietly fixes its input
 * teaches the model nothing and leaves the reader looking at a plan the model
 * did not write.
 *
 * `[]` IS VALID and means "no plan". Clearing is a thing a person does, and a
 * validator that refuses the empty plan makes the Clear button impossible.
 */
export function validatePlan(raw: unknown): PlanValidation {
  if (!Array.isArray(raw)) return { ok: false, reason: '"plan" must be an array of steps' };
  if (raw.length > MAX_PLAN_STEPS) {
    return { ok: false, reason: `at most ${MAX_PLAN_STEPS} steps (got ${raw.length})` };
  }
  const steps: PlanStep[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, reason: 'every step must be an object' };
    }
    const o = entry as Record<string, unknown>;
    const id = squash(o.id, MAX_PLAN_ID_CHARS);
    if (id === '') return { ok: false, reason: 'every step needs a non-empty "id"' };
    if (seen.has(id)) return { ok: false, reason: `duplicate step id "${id}"` };
    seen.add(id);
    const text = squash(o.text, MAX_PLAN_STEP_CHARS);
    if (text === '') return { ok: false, reason: `step "${id}" needs a non-empty "text"` };
    const status = squash(o.status, 16);
    if (status !== 'open' && status !== 'done' && status !== 'parked') {
      return {
        ok: false,
        reason: `step "${id}" has status "${status || '(missing)'}" — use one of: open, done, parked`,
      };
    }
    const step: PlanStep = { id, text, status };
    const why = squash(o.why, MAX_PARK_WHY_CHARS);
    if (status === 'parked') {
      /*
       * A PARKED STEP WITH NO REASON READS AS A FORGOTTEN ONE — `todoList.ts`
       * rule 3, and the same difference between "this could not be done, here
       * is why" and "nobody knows what happened to this". Filled rather than
       * refused, because the only caller that can reach this with an empty
       * `why` is a person's own edit in the UI, and refusing their Park because
       * they did not type a sentence would just teach them to type a full stop.
       */
      step.why = why || 'no reason recorded';
    } else if (why !== '') {
      return { ok: false, reason: `step "${id}" is ${status} and must not carry a park reason` };
    }
    steps.push(step);
  }
  return { ok: true, steps };
}

/* --------------------------- an action, not a gate ------------------------ */

/**
 * WHY A STEP IS REFUSED, or `null` when it is fine.
 *
 * ML Harness's REPLAN_NUDGE names the failure exactly: "A step that is a
 * condition rather than an action — 'baseline measured', 'prompting exhausted'
 * — is a gate, and a gate is not a step." A gate cannot be worked. The run aims
 * a turn at it, the model has nothing to call, the step stays open, and two
 * turns later it is parked — so a plan made of gates burns the whole cap and
 * parks everything.
 *
 * The rule is deliberately narrow and mechanical: a line whose LAST word is a
 * state rather than a deed. It will not catch every gate anybody can write, and
 * it is not trying to — a heuristic that refuses real steps is worse than one
 * that lets a few gates through, because the run can park a gate and the person
 * cannot un-refuse a step the tool would not take.
 */
const GATE_TAIL_RE =
  /\b(measured|exhausted|complete|completed|done|finished|verified|validated|ready|passing|green|working|fixed|resolved|understood|confirmed|established|reviewed|approved|clear|clean|stable)\.?$/i;

export function whyNotAnAction(text: string): string | null {
  const t = squash(text, MAX_PLAN_STEP_CHARS);
  if (t === '') return 'a step needs words';
  if (t.split(' ').length < 2) {
    return `"${t}" is one word — say what to DO and what to do it to`;
  }
  if (GATE_TAIL_RE.test(t)) {
    return (
      `"${t}" is a condition, not an action — a gate is not a step. Say the call to make ` +
      '(the tool and what it takes), so that reading the line tells you what to do.'
    );
  }
  /*
   * MARKUP IS NOT A STEP. A 2B model on the owner walk (2026-09-18) handed
   * `write_plan` the tail of its own tool call — `,{'id': '1', 'title': …}]
   * </param></fun` — and it became a step the bar then displayed. A step is
   * one plain sentence; braces, angle brackets and quoted keys are the shape
   * of a call that fell apart, and the honest answer is to hand it back.
   */
  if (MARKUP_RE.test(t)) {
    return (
      'that looks like tool markup or JSON, not a step — send each step as one plain ' +
      'sentence naming what to do and what to do it to'
    );
  }
  return null;
}

/** Braces, tags, quoted keys: the residue of a tool call, never a sentence. */
const MARKUP_RE = /[{}]|<\/?[a-z]|\[\s*\{|['"](?:id|title|text|status)['"]\s*:/i;

/* -------------------------------- write_plan ------------------------------ */

export type WritePlanResult =
  | { ok: true; steps: PlanStep[]; replaced: number; added: number }
  | { ok: false; reason: string };

/**
 * Replace the REMAINING OPEN STEPS, keeping everything already ticked or parked
 * exactly where it is.
 *
 * REPLACE, NEVER PATCH — `todoList.ts` rule 1, and the argument carries: deltas
 * across twenty-four turns drift, and a drifted plan is worse than no plan
 * because the reader believes it.
 *
 * AND THE TICKED STEPS ARE NOT THE MODEL'S TO REWRITE. A rewrite that could
 * touch them would let a model un-finish its own work to buy turns, and would
 * let a replan quietly delete the evidence of what it had already done. The
 * done and parked rows are history; history is append-only here.
 */
export function writePlan(existing: readonly PlanStep[], rawSteps: unknown): WritePlanResult {
  if (!Array.isArray(rawSteps)) {
    return { ok: false, reason: '"steps" must be an array of strings — one line per step' };
  }
  const kept = existing.filter((s) => s.status !== 'open');
  const texts: string[] = [];
  for (const raw of rawSteps) {
    const text = squash(typeof raw === 'string' ? raw : (raw as { text?: unknown })?.text, MAX_PLAN_STEP_CHARS);
    if (text === '') continue;
    /* A model handed the rendered plan back verbatim writes `- [ ] x`; take it. */
    const asLine = PLAN_LINE_RE.exec(text);
    texts.push(asLine ? asLine[4]!.trim() : text);
  }
  if (texts.length === 0) {
    return { ok: false, reason: 'an empty list is not a plan — send the steps, or do not call this tool' };
  }
  if (kept.length + texts.length > MAX_PLAN_STEPS) {
    return {
      ok: false,
      reason: `that would make ${kept.length + texts.length} steps; at most ${MAX_PLAN_STEPS}`,
    };
  }
  const seenText = new Set(kept.map((s) => s.text.toLowerCase()));
  for (const text of texts) {
    const bad = whyNotAnAction(text);
    if (bad) return { ok: false, reason: bad };
    if (seenText.has(text.toLowerCase())) {
      return { ok: false, reason: `"${text}" is already on the plan — a step cannot be listed twice` };
    }
    seenText.add(text.toLowerCase());
  }
  let n = highestStepNumber(existing);
  const fresh: PlanStep[] = texts.map((text) => {
    n += 1;
    return { id: `s${n}`, text, status: 'open' as const };
  });
  return {
    ok: true,
    steps: [...kept, ...fresh],
    replaced: existing.length - kept.length,
    added: fresh.length,
  };
}

function highestStepNumber(steps: readonly PlanStep[]): number {
  let max = 0;
  for (const s of steps) {
    const m = /^s(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Math.max(max, steps.length);
}

/* ------------------------------ mark_step_done ---------------------------- */

export type MarkStepResult =
  | {
      ok: true;
      steps: PlanStep[];
      ticked: PlanStep;
      /** The next open step, or `undefined` when the plan is worked down. */
      next?: PlanStep;
      counts: PlanCounts;
    }
  | { ok: false; reason: string; matches?: string[] };

/**
 * TICK ONE STEP BY A FEW OF ITS WORDS.
 *
 * ONE match function, and it is containment on whitespace-normalised lowercase
 * text — the argument must appear inside the step line. Not edit distance, not
 * token overlap: those match a step the model did not mean, and a wrong tick is
 * the one error this whole design cannot recover from, because the run moves on
 * and nothing ever looks at that step again.
 *
 * AMBIGUOUS IS A REFUSAL, NOT A GUESS. Two open steps containing the words
 * means the model has not said which, and picking one is picking which of its
 * two possible intentions to believe. The refusal names the candidates so the
 * next round is a fix rather than a re-guess — one round of the existing
 * budget, which is what a refusal that teaches costs.
 *
 * ALREADY DONE IS ITS OWN REFUSAL, separately from "no such step", because they
 * ask for opposite corrections: one means send more of the line, the other
 * means go on to the next step.
 */
export function markStepDone(steps: readonly PlanStep[], words: string): MarkStepResult {
  const needle = squash(words, MAX_PLAN_STEP_CHARS).toLowerCase();
  if (needle === '') {
    return { ok: false, reason: 'say a few words from the step you finished' };
  }
  const norm = (s: PlanStep): string => s.text.toLowerCase().replace(/\s+/g, ' ').trim();
  const open = steps.filter((s) => s.status === 'open');
  if (open.length === 0) {
    return {
      ok: false,
      reason: 'there is no open step to tick — every step is done or parked. Say so in one line and stop.',
    };
  }
  const hits = open.filter((s) => norm(s).includes(needle));
  if (hits.length === 0) {
    const alreadyDone = steps.find((s) => s.status === 'done' && norm(s).includes(needle));
    if (alreadyDone) {
      return { ok: false, reason: `"${alreadyDone.text}" is already ticked — go on to the next open step` };
    }
    return {
      ok: false,
      reason: 'no open step contains those words',
      matches: open.map((s) => s.text).slice(0, 20),
    };
  }
  if (hits.length > 1) {
    return {
      ok: false,
      reason: 'those words match more than one open step — use more of the line',
      matches: hits.map((s) => s.text).slice(0, 10),
    };
  }
  const ticked = hits[0]!;
  const next = steps.map((s) => (s.id === ticked.id ? { ...s, status: 'done' as const } : s));
  return {
    ok: true,
    steps: next,
    ticked: { ...ticked, status: 'done' },
    ...(firstOpenStep(next) ? { next: firstOpenStep(next)! } : {}),
    counts: planCounts(next),
  };
}

/* --------------------------------- parking -------------------------------- */

/**
 * Park one step with the agent's OWN last words as the reason.
 *
 * `why` is clipped and whitespace-collapsed, never invented: a park is a claim
 * that a step could not be done, and the reader deciding whether to rewrite the
 * plan needs the thing that actually stopped it. "no reason recorded" is the
 * honest fallback and is deliberately ugly.
 */
export function parkStep(steps: readonly PlanStep[], id: string, why: string): PlanStep[] {
  const reason = squash(why, MAX_PARK_WHY_CHARS) || 'no reason recorded';
  return steps.map((s) => (s.id === id ? { ...s, status: 'parked' as const, why: reason } : s));
}

/** Put a parked step back on the list — the Unpark control. The reason is dropped. */
export function unparkStep(steps: readonly PlanStep[], id: string): PlanStep[] {
  return steps.map((s) => {
    if (s.id !== id || s.status !== 'parked') return s;
    const { why: _dropped, ...rest } = s;
    return { ...rest, status: 'open' as const };
  });
}

/* -------------------------------- the goal -------------------------------- */

/**
 * How many words a message must have before it could stand as a goal.
 *
 * ML Harness uses four (`conductor._GOAL_NEEDS_WORDS`). "hi", "hello there",
 * "what is this" are conversation, not a goal.
 *
 * NOTHING ADOPTS A GOAL ANY MORE — see {@link goalFromFirstMessage}. The
 * threshold survives because it still describes what a goal has to be, and the
 * argument it was written for turned out to be the argument against adoption
 * itself: a message the person typed as a question must not become a standing
 * instruction in every later prompt.
 */
export const GOAL_NEEDS_WORDS = 4;

/** A goal is a sentence shown in a bar, not an essay. */
export const MAX_GOAL_CHARS = 600;

/**
 * Would this message stand as a goal on its own? NOBODY ADOPTS ONE.
 *
 * `sessionsStore.adoptGoalFromChat` used to be the one caller, and it was
 * REMOVED on 2026-09-17: owner, walking the installed app, "I don’t like that
 * it sets the goal automatically." A goal is rendered into every prompt the
 * session assembles and the goal run aims at it, so deriving one from a message
 * turned a question into a standing instruction nobody gave. A goal now exists
 * only when the person set one (PUT {goal}: `/goal`, the New goal form).
 *
 * The predicate is kept because "is this sentence a goal at all" is still a
 * real question — a future control that OFFERS a goal for the person to accept
 * needs exactly it — and because deleting a tested rule to re-derive it later
 * is how a threshold comes back with a different number.
 */
export function goalFromFirstMessage(text: string): string | null {
  const t = squash(text, MAX_GOAL_CHARS);
  if (t === '') return null;
  return t.split(' ').length >= GOAL_NEEDS_WORDS ? t : null;
}

/* ------------------------------- the two voices --------------------------- */

/**
 * THE GOAL SECTION OF THE PROMPT — and there are TWO of them, on purpose.
 *
 * Ported from ML Harness `conductor._goal_note` and `_plan_note`, which arrived
 * at the split by shipping one voice and watching it fail in both directions at
 * once. ONE voice that says "work the checklist" turns an ordinary question
 * into a grind: the person asks "what does this file do" and the model starts
 * editing step three. ONE voice that says "the goal is context" turns a run
 * into a status report: the person presses Work on goal and the model writes a
 * paragraph about what it WOULD do, calls nothing, and the step is untouched.
 *
 * So: IDLE the goal is CONTEXT and says so out loud. LIVE it is an ORDER, and
 * names the one step, and forbids by name the three things a model does instead
 * of working (summarise, ask what to do next, narrate what it would do). Those
 * three are enumerated rather than implied because a model shown "do not stop"
 * stops politely.
 *
 * Empty goal AND empty plan ⇒ NO SECTION AT ALL, not an empty header. Every
 * turn in a session without a goal must assemble a prompt byte-identical to one
 * built before this feature existed.
 */
export interface GoalSectionInput {
  goal?: string;
  plan?: readonly PlanStep[];
  /** True only while a goal run is working this session down. */
  runLive: boolean;
  /** The step this turn is judged on — the runner's choice, not the model's. */
  aimingAt?: string;
  /**
   * THIS TURN IS THE COMPLETION AUDIT (carrying-harness plan, wave A4). The
   * run has worked the plan down, or is on its last allowed turn, and the one
   * job is to read the goal against the evidence and end on a `VERDICT:` line.
   */
  audit?: boolean;
}

/**
 * THE FIDELITY CLAUSE (carrying-harness plan, wave A5).
 *
 * MiniMax Code's anti-substitution rule, in Sequence's words. A small model
 * that cannot reach the goal as written reaches for the nearest thing that
 * makes a check pass — narrows the goal to what already exists, redefines
 * "done" around the half it managed, ticks a step it read about. Exported so
 * the test can assert the exact sentence is in the live voice and not the idle.
 */
export const FIDELITY_CLAUSE =
  'Do the step AS THE GOAL MEANS IT: the end state the person asked for, not the easiest change ' +
  'that makes a check pass. Never narrow the goal to what already exists, never redefine "done" ' +
  'around a partial result, and never tick a step you did not do. The audit at the end reads ' +
  'the evidence, not the claim.';

/** The line the audit turn must end on. The runner parses exactly this shape. */
export const AUDIT_VERDICT_LINE = 'VERDICT: PASS | PARTIAL | FAIL — one line on what was and was not verified';

export function renderGoalSection(input: GoalSectionInput): string[] {
  const goal = squash(input.goal, MAX_GOAL_CHARS);
  const plan = input.plan ?? [];
  if (goal === '' && plan.length === 0) return [];

  const L: string[] = [];
  if (goal !== '') {
    L.push('--- THE STANDING GOAL ---');
    L.push('This conversation was opened for, in the person\'s own words:');
    L.push(`> ${goal}`);
  }

  const counts = planCounts(plan);
  const open = openSteps(plan);
  const parked = plan.filter((s) => s.status === 'parked');

  if (plan.length > 0) {
    L.push('');
    L.push(`--- THE PLAN (${counts.done} of ${counts.total} done) ---`);
    L.push(renderPlanChecklist(plan));
    if (parked.length > 0) {
      L.push(
        `PARKED, and not to be retried: ${parked
          .slice(0, 6)
          .map((s) => `${s.text} (${s.why ?? 'no reason recorded'})`)
          .join('; ')}`,
      );
    }
  }

  if (!input.runLive) {
    /* ── THE IDLE VOICE ──────────────────────────────────────────────────── */
    L.push('');
    L.push(
      plan.length === 0
        ? 'Answer what they asked this turn. The goal is context, not an order to start a checklist.'
        : 'Answer what they asked this turn. The goal and the plan are CONTEXT, not an order to ' +
          'grind the checklist — a run works it down only when the person presses "Work on goal". ' +
          'Do not tick steps you were not asked to work.',
    );
    return L;
  }

  /* ── THE LIVE VOICE ──────────────────────────────────────────────────────
     A run is working this session down. This turn has exactly one job. */
  L.push('');
  if (input.audit === true) {
    /* ── THE AUDIT VOICE (wave A4) ─────────────────────────────────────────
       MiniMax Code's Completion Audit, in the goal run's terms. The model is
       asked for evidence per requirement and a verdict it cannot pass by
       saying so: PASS needs every requirement verified WITH A TOOL this turn,
       and the runner reads only the VERDICT line. A ticked box is a claim;
       this turn is where claims are checked against the files. */
    L.push('--- THIS TURN IS THE COMPLETION AUDIT. THE RUN ENDS ON YOUR VERDICT ---');
    L.push(
      `The plan above is ${counts.done} of ${counts.total} ticked${
        parked.length > 0 ? `, ${parked.length} parked` : ''
      }. A tick is a claim, not evidence. Audit the GOAL, not the plan:`,
    );
    L.push(
      '1. List the requirements the goal states or clearly implies, one line each.',
    );
    L.push(
      '2. For each, VERIFY it with a tool THIS TURN — read the file, locate the symbol, run the ' +
        'check — and write the evidence beside it (path and line, or the tool result). A ' +
        'requirement you remember doing but did not re-check is UNVERIFIED.',
    );
    L.push(
      '3. End with exactly one line: `' + AUDIT_VERDICT_LINE + '`. PASS only when every ' +
        'requirement is verified. PARTIAL when some are and you name the ones that are not. FAIL ' +
        "when the goal's end state is not there.",
    );
    L.push(
      'DO NOT tick, park or rewrite steps in this turn, and DO NOT do the work now — a fix ' +
        'started in the audit is unverified by definition. Report; the person acts on the verdict.',
    );
    return L;
  }
  if (plan.length === 0) {
    /* A run on a bare goal: this turn's one job is the plan. The scaffold says
       the same thing in the user seat; saying it here too keeps the system
       section honest about what state the run is in. */
    L.push('--- A RUN HAS STARTED ON THIS GOAL AND THERE IS NO PLAN YET ---');
    L.push(
      'Write the plan NOW with `write_plan`: two to six steps, each an ACTION naming what to do and ' +
        'what to do it to — the tool and its arguments where you can. A condition ("file exists", ' +
        '"tests pass") is a gate, not a step. Then work the first step, with tools, this same turn.',
    );
    L.push('DO NOT ask the person what they want — the goal above is what they want, in their words.');
    return L;
  }
  if (open.length === 0) {
    L.push(
      parked.length > 0
        ? `Nothing is left open — ${counts.done} of ${counts.total} ticked, ${parked.length} parked as undoable. ` +
          'Say which are parked and why, in one line each, and stop.'
        : `Nothing is left open — every step is ticked (${counts.done}). Say so in one line and stop.`,
    );
    return L;
  }

  const aim = squash(input.aimingAt, MAX_PLAN_STEP_CHARS) || open[0]!.text;
  L.push(`--- A RUN IS WORKING THIS PLAN DOWN. THIS TURN'S STEP ---`);
  L.push(`> ${aim}`);
  L.push(
    'Work that step NOW, with tools. Do the work this turn; the moment it is done call ' +
      '`mark_step_done` with a few of its words, then go straight on to the next open step.',
  );
  L.push(
    'DO NOT stop to summarise. DO NOT ask what to do next. DO NOT narrate what you would do — a ' +
      'turn that announces a move and calls no tool leaves the step exactly where it was, and the ' +
      'run can see that.',
  );
  L.push(
    'A step you did not do is not ticked. If this step cannot be done AS WRITTEN, say in one line ' +
      'what stopped you — that sentence becomes the parked reason the person reads. Only this ' +
      "step's own tools failing blocks this step.",
  );
  L.push(FIDELITY_CLAUSE);
  L.push(
    'If the open steps are the problem rather than the effort, call `write_plan` to rewrite the ' +
      'REMAINING open steps — what is already ticked or parked stays exactly as it is — then work ' +
      'the first one.',
  );
  return L;
}

/* ------------------------- a plan the harness writes ---------------------- */

/**
 * THE FILE-LIKE WORDS IN A SENTENCE. `askTools.ts` style paths, backticked
 * names, and bare names with an extension — the three ways a person names a
 * file in a goal. Order is preserved and duplicates dropped.
 */
export function pathTokensIn(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string): void => {
    const t = raw.replace(/^[`'"(]+|[`'"),.;:]+$/g, '');
    if (t.length < 3 || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const m of text.matchAll(/`([^`\n]{3,120})`/g)) add(m[1]!);
  for (const m of text.matchAll(/(?:^|[\s(])((?:[\w.-]+[\\/])+[\w.-]+|[\w-]+\.[A-Za-z][A-Za-z0-9]{0,5})(?=$|[\s),.;:])/g)) {
    add(m[1]!);
  }
  return out;
}

/** The ids a harness-written plan uses — distinct from the model's `p…` and the seed's `s…`. */
const SKELETON_ID_PREFIX = 'k';

/**
 * A PLAN FROM THE FILES THE GOAL NAMES (carrying-harness plan, wave A6).
 *
 * When two plan turns have written nothing, the harness writes a skeleton
 * rather than spending a third turn and ending on `no_plan_written`: a read
 * step per file the goal names, one change step, one re-read step. Every line
 * is an action `whyNotAnAction` accepts, and every path is one the resolver
 * found — a skeleton naming a file that does not exist would be a plan made
 * of parks.
 *
 * `resolveFile` is the loose resolver over the repository: `one` for a hit.
 * NULL when the goal names no file the repository has: a skeleton of generic
 * steps ("locate the code", "make the change") is three gates dressed as
 * actions, and the honest ending there is still `no_plan_written`.
 */
export function skeletonFromGoal(
  goal: string,
  resolveFile: (written: string) => string | null,
  maxFiles = 4,
): PlanStep[] | null {
  const hits: string[] = [];
  for (const token of pathTokensIn(goal)) {
    const hit = resolveFile(token);
    if (hit && !hits.includes(hit)) hits.push(hit);
    if (hits.length >= maxFiles) break;
  }
  if (hits.length === 0) return null;
  const aim = squash(goal, 100);
  const steps: PlanStep[] = hits.map((p, i) => ({
    id: `${SKELETON_ID_PREFIX}${i + 1}`,
    text: `Read ${p} with read_file and note what the goal needs changed in it`,
    status: 'open',
  }));
  steps.push({
    id: `${SKELETON_ID_PREFIX}${steps.length + 1}`,
    text: `Make the change the goal describes (${aim}) in ${hits.join(', ')} with propose_files`,
    status: 'open',
  });
  steps.push({
    id: `${SKELETON_ID_PREFIX}${steps.length + 1}`,
    text: `Re-read ${hits[0]} with read_file and compare what is there against what the goal asked for`,
    status: 'open',
  });
  return steps;
}
