/**
 * A GOAL RUN'S TURN, TAKEN BY A CODING AGENT (Claude, Codex) instead of the
 * built-in model.
 *
 * `goalRunner.workGoalRun` is a loop over a plan with an injected `takeTurn`. The
 * built-in `takeTurn` runs Sequence's own ask pipeline. This one hands the same
 * turn to the chat's ACP agent, through the same `/api/acp/run-node` path a typed
 * agent message takes (the caller injects `runNode`; none of the ACP plumbing,
 * permission handling or session cache is repeated here).
 *
 * ── HOW A STEP GETS TICKED ──────────────────────────────────────────────────
 *
 * The agent is given the Sequence MCP `goal` tool (goalAgentTools.ts) and told to
 * call `mark_step_done`. The loop then reads the plan back from disk, exactly as
 * it does for the built-in model.
 *
 * THE FALLBACK, for an agent that ignores the tool: if the plan on disk did not
 * move, the agent's closing text is read for checklist lines (`- [x] step`) that
 * match the AIMED step exactly, and that step is ticked; with no plan yet, a
 * checklist in the text becomes the plan. Exact line match only: a wrong tick is
 * the one error the loop cannot recover from. If neither the tool nor the text
 * moved the plan, `noProgress` is set on the outcome and the loop ends the run
 * as `no_progress` after a few such turns.
 */
import type { PlanStep } from '@sequence/api-types';
import type { GoalTurnArgs, GoalTurnOutcome } from './goalRunner.js';
import { PLAN_LINE_RE, parsePlanChecklist, renderPlanChecklist, writePlan } from './goalPlan.js';

export interface AcpTurnDeps {
  /** One prompt to the agent, awaited to its end. Rejects when the agent or the connection fails. */
  runNode: (prompt: string, signal: AbortSignal, label: string) => Promise<{ text: string; stopReason: string }>;
  /** The plan as it is on disk now. */
  readPlan: () => PlanStep[];
  /** Replace the plan on disk. */
  writePlan: (plan: readonly PlanStep[]) => void;
  /** The standing goal, in the person's words. */
  goal: () => string | undefined;
  signal?: AbortSignal;
}

export const GOAL_TOOL_BRIEF =
  'You are working a long-running goal one step at a time. Sequence gave you a tool named `goal` ' +
  '(its MCP server is called sequence). `goal` with op `mark_step_done` and `step` (a few words ' +
  'of the step you finished) ticks a step; with op `write_plan` and `steps` (one line per step) it ' +
  'writes the plan. Where the instruction below says write_plan or mark_step_done, it means that ' +
  'tool. Use your own file and shell tools for the work itself. A step counts as done only when ' +
  'you have ticked it with the tool, not when you say so.';

/** The prompt for one turn. */
export function agentGoalPrompt(args: GoalTurnArgs, goal: string | undefined): string {
  const parts = [GOAL_TOOL_BRIEF];
  if (goal) parts.push(`Goal: ${goal}`);
  if (args.plan.length > 0) parts.push(`Plan:\n${renderPlanChecklist(args.plan)}`);
  parts.push(args.scaffold);
  return parts.join('\n\n');
}

/** What the chat shows as the person's side of this turn (the full prompt is the agent's copy). */
export function turnLabel(args: GoalTurnArgs): string {
  if (args.audit) return 'Goal run: completion audit';
  return args.aimingAt ? `Goal run: ${args.aimingAt.text}` : 'Goal run: write the plan';
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Apply a checklist written in the agent's text to the plan. Returns the new plan,
 * or null when the text changes nothing. Never un-ticks, never edits a step. With a plan,
 * only the step the turn was aimed at (`onlyId`) can be ticked: an agent that prints a
 * later step as done has not been asked about it.
 */
export function planFromText(plan: readonly PlanStep[], text: string, onlyId?: string): PlanStep[] | null {
  if (plan.length === 0) {
    const steps = parsePlanChecklist(text).filter((s) => s.status === 'open' || s.status === 'done');
    if (steps.length === 0) return null;
    const written = writePlan([], steps.map((s) => s.text));
    return written.ok ? written.steps : null;
  }
  const ticked = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = PLAN_LINE_RE.exec(line);
    if (!m || (m[2] !== 'x' && m[2] !== 'X')) continue;
    ticked.add(norm(m[4]!));
  }
  let changed = false;
  const next = plan.map((s) => {
    if (s.status === 'open' && s.id === onlyId && ticked.has(norm(s.text))) {
      changed = true;
      return { ...s, status: 'done' as const };
    }
    return s;
  });
  return changed ? next : null;
}

const samePlan = (a: readonly PlanStep[], b: readonly PlanStep[]): boolean => JSON.stringify(a) === JSON.stringify(b);

export function makeAcpTakeTurn(deps: AcpTurnDeps): (args: GoalTurnArgs) => Promise<GoalTurnOutcome> {
  const signal = deps.signal ?? new AbortController().signal;
  return async (args) => {
    const before = deps.readPlan();
    let result: { text: string; stopReason: string };
    try {
      result = await deps.runNode(agentGoalPrompt(args, deps.goal()), signal, turnLabel(args));
    } catch (e) {
      return { kind: 'provider-failed', text: '', toolCallsMade: 0, plan: before, error: e instanceof Error ? e.message : String(e) };
    }
    if (result.stopReason === 'cancelled') {
      return { kind: 'provider-failed', text: '', toolCallsMade: 0, plan: before, error: 'the agent turn was cancelled' };
    }
    const text = result.text ?? '';
    let plan = deps.readPlan();
    const viaTool = !samePlan(before, plan);
    let viaText = false;
    if (!viaTool && !args.audit) {
      const fromText = planFromText(plan, text, args.aimingAt?.id);
      if (fromText) {
        deps.writePlan(fromText);
        plan = fromText;
        viaText = true;
      }
    }
    return {
      kind: 'ok',
      text,
      /* The wire reports no tool count. A turn that said or changed anything is a real
         attempt (it can strike); an empty one is hollow. */
      toolCallsMade: viaTool || viaText || text.trim() !== '' ? 1 : 0,
      plan,
      ...(args.audit || viaTool || viaText ? {} : { noProgress: true }),
    };
  };
}
