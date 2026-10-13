/**
 * THE `goal` TOOL, as an agent (Claude, Codex) sees it over MCP.
 *
 * A goal run on the built-in model ticks its plan through `write_plan` and
 * `mark_step_done` (askTools.ts). A coding agent has neither, so the Sequence MCP
 * server hands it ONE tool, `goal`, with those same two ops. The checks are the
 * built-in ones (`goalPlan.writePlan`, `goalPlan.markStepDone`): the same refusals,
 * the same containment rule, the same "ticked history is not the model's to
 * rewrite". Only the door differs.
 *
 * It writes the session's plan through `updateSession`, the store the goal run
 * reads back before every turn, so the loop sees a tick exactly as it sees one
 * from the built-in model. It works ONLY while a run is live for that chat: an
 * agent that finds the tool in a stale process, or in an ordinary chat, changes
 * nothing.
 */
import { firstOpenStep, markStepDone, renderPlanChecklist, writePlan } from './goalPlan.js';
import { readGoalRun } from './goalRunner.js';
import { readSessionGoal, updateSession } from './sessionsStore.js';

export interface GoalToolArgs {
  op?: string;
  /** write_plan: one line per step. */
  steps?: unknown;
  /** mark_step_done: a few words of the step just finished. */
  step?: unknown;
}

export interface GoalToolResult {
  text: string;
  isError?: boolean;
}

/** `root` is the project that holds the chat's sessions; `chat` the chat id. */
export function goalToolCall(root: string, chat: string, args: GoalToolArgs): GoalToolResult {
  const fail = (text: string): GoalToolResult => ({ text, isError: true });
  if (readGoalRun(root, chat)?.running !== true) {
    return fail('goal: no goal run is working this chat right now, so there is no plan to change.');
  }
  const plan = readSessionGoal(root, chat).plan ?? [];
  if (args.op === 'write_plan') {
    const written = writePlan(plan, args.steps);
    if (!written.ok) return fail(`refused: write_plan — ${written.reason}`);
    updateSession(root, chat, { plan: written.steps });
    const open = written.steps.filter((s) => s.status === 'open').length;
    return { text: `plan written: ${open} open step${open === 1 ? '' : 's'}.\n${renderPlanChecklist(written.steps)}` };
  }
  if (args.op === 'mark_step_done') {
    const marked = markStepDone(plan, String(args.step ?? ''));
    if (!marked.ok) {
      const list = marked.matches && marked.matches.length > 0 ? ` Open steps: ${marked.matches.map((m) => `"${m}"`).join('; ')}` : '';
      return fail(`refused: mark_step_done — ${marked.reason}${list}`);
    }
    updateSession(root, chat, { plan: marked.steps });
    const { counts } = marked;
    const next = firstOpenStep(marked.steps);
    return {
      text:
        `ticked "${marked.ticked.text}" (${counts.done} of ${counts.total} done). ` +
        (next ? `Next open step: ${next.text}` : 'Every step is ticked. Say so in one line and stop.'),
    };
  }
  return fail('goal: op must be write_plan or mark_step_done.');
}
