import type { Program } from '@sequence/schema';

/* ══════════════════════════════════════════════════════════════════════════
   STARTING A RUN — a name and an instruction become a program
   packages/web2/src/activity/runAuthor.ts

   `programRunner` has always been the real thing: it detaches from the request,
   survives the client being SIGKILLed, and a reconnecting reader resumes off a
   durable log at exactly `lastSeq+1`. And `web2` could not start one.
   `activityClient.ts` declared `ACTIVITY_ROUTES = ['/api/program/runs']` and
   issued GETs only, so the Activity pane was a viewer for runs that only the
   CLI could create — the moat point "agent workflows on the graph" shipped as a
   library rather than as a workflow.

   ── WHY THIS IS A MODULE AND NOT A FORM HANDLER ──────────────────────────

   `POST /api/program/run` runs `validateProgram` and 400s on failure, and its
   comment says why: "a program that would not survive `sequence program run`
   must not survive this route either, or the two entry points disagree about
   what a valid program is." So the shape a form composes is the part that has
   to be right, and it is the part a form cannot check for itself.

   Pure, so the shape is asserted against the REAL validator in a unit test,
   with no DOM, no server and no fetch. The caller supplies the id for the same
   reason the whiteboard's caller supplies its ids: a module that reaches for a
   clock or a counter cannot be asserted against an exact value.

   ── AND WHY IT IS THREE NODES ────────────────────────────────────────────

   The program vocabulary has branches, loops, parallel fan-out, shared state
   and deterministic checkers. None of them is needed to start ONE run, and a
   visual program editor is a different product from a button that starts work.
   `start → agent → end` is the smallest thing the scheduler will walk.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What the form will not send.
 *
 * The instruction cap is deliberately well under the route's body limit: a
 * refusal that arrives AFTER the reader has written eight paragraphs is worse
 * than one that arrives as they write, because by then the draft is gone.
 * The name cap is what a row in the list can show without becoming an ellipsis.
 */
export const RUN_AUTHOR_LIMITS = {
  name: 120,
  instruction: 8000,
} as const;

/**
 * Everything wrong with this form, in one pass.
 *
 * ALL OF IT, not the first problem. A form that reveals its second complaint
 * only once you have fixed the first is a form people fill in twice. Each
 * sentence names its field, because "invalid input" is a refusal nobody can
 * act on.
 */
export function authorProblems(name: string, instruction: string): string[] {
  const problems: string[] = [];
  const n = name.trim();
  const i = instruction.trim();

  if (n === '') problems.push('Give the run a name — the list has nothing else to tell two runs apart by.');
  else if (n.length > RUN_AUTHOR_LIMITS.name) {
    problems.push(`The name is ${n.length} characters; keep it under ${RUN_AUTHOR_LIMITS.name}.`);
  }

  if (i === '') problems.push('Say what the agent should do — the instruction is the whole of the run.');
  else if (i.length > RUN_AUTHOR_LIMITS.instruction) {
    problems.push(
      `The instruction is ${i.length} characters; the engine will not carry more than ${RUN_AUTHOR_LIMITS.instruction}.`,
    );
  }

  return problems;
}

/**
 * The program itself.
 *
 * `runtime: 'acp'` is not a detail. It is what makes this a REAL local
 * coding-agent turn — a subprocess with real repository writes — rather than a
 * metered gateway call, and the route gates on exactly that field
 * (`wantsAcp` → `acpGate()`). Getting it wrong would not fail loudly; the run
 * would quietly become something else.
 *
 * NOTHING ELSE IS SET. `agent.model` routes nothing, `agent.tools` is an
 * allow-list no executor enforces, `agent.skills` names a catalogue nothing
 * activates, and `agent.requiresReview` promises an agent cannot run before
 * approval when no such gate exists. Composing any of them here would put the
 * lie inside the run's own record, where it outlives the form.
 */
export function programFrom(name: string, instruction: string, id: string): Program {
  return {
    id,
    name: name.trim(),
    nodes: [
      { id: 'start', title: 'Start', kind: 'start' },
      {
        id: 'work',
        title: 'Work',
        kind: 'agent',
        agent: {
          /* VERBATIM. Rewording what a person typed answers a question they did
             not ask — the same rule the board's Generate gate follows with the
             reader's note. */
          prompt: instruction.trim(),
          runtime: 'acp',
          intent: 'edit',
        },
      },
      { id: 'done', title: 'Done', kind: 'end' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'work', kind: 'seq' },
      { id: 'e2', from: 'work', to: 'done', kind: 'seq' },
    ],
  };
}
