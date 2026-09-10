/* ══════════════════════════════════════════════════════════════════════════
   PLAN MODE — read everything, write nothing, end in a plan
   packages/acp/src/planMode.ts

   Owner walk 2026-08-22: "There should be a plan mode. Planning mode is really
   important, and we need in-depth instructions for that."

   ── WHY IT IS A PERMISSION AND NOT A PROMPT ──────────────────────────────

   Plan mode is the answer to "what is this agent allowed to do to my repo
   right now", and that question already has a control under the composer. Put
   anywhere else, it invites the failure it exists to prevent: a person
   believing they are planning while the agent is editing. A mode you can be
   wrong about is not a safety property.

   ── AND IT IS THE ONE NON-DEFAULT MODE THIS PRODUCT CAN HONESTLY SHIP ────

   `PermissionControl.tsx` draws `autoEdit` and `full` as REFUSED, and is right
   to: Sequence has no permission system, so offering them would promise an
   autonomy it cannot deliver. Plan mode is the opposite case. It is STRICTLY
   WEAKER than the current default — `defaultPermissionPolicy` already allows
   only `read`, `fetch`, `search` and `think` — so it asks the enforcement layer
   for nothing the enforcement layer does not already do.

   That is the whole reason this can land now. A mode that needs less than what
   is already enforced needs no new enforcement.

   ── WHAT IT ADDS ON TOP ──────────────────────────────────────────────────

   The refusal is NAMED. Denying a write silently is indistinguishable from an
   agent that decided not to write, and the reader cannot tell whether their
   plan-mode session is protecting them or the model simply had nothing to say.

   PURE. No transport, no process, no clock — the policy is a function of the
   mode and the request, and the instructions are a constant. Everything here
   is answerable in a test.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What an agent is allowed to do, weakest first.
 *
 * The order is the ladder of trust and it is load-bearing: a surface that
 * renders these in declaration order shows the always-safe option at the top.
 */
export type AgentMode = 'plan' | 'propose' | 'autoEdit' | 'full';

export const AGENT_MODES: readonly AgentMode[] = ['plan', 'propose', 'autoEdit', 'full'];

/**
 * Tool kinds that only read.
 *
 * Deliberately the same four `client.ts` already treats as safe. Two lists that
 * could disagree about what "read-only" means is a defect nobody would see
 * until the day they diverged.
 */
export const READ_ONLY_KINDS: readonly string[] = ['read', 'fetch', 'search', 'think'];

/** Whether a mode may mutate anything at all. */
export function mayMutate(mode: AgentMode): boolean {
  return mode === 'autoEdit' || mode === 'full';
}

/**
 * Whether a tool call is permitted under a mode.
 *
 * `plan` and `propose` both refuse every mutating kind at THIS boundary, and
 * that is not a bug in the distinction — it is where the distinction does not
 * live. Propose lets a turn end in a proposal a human accepts; plan lets a turn
 * end in words. Both reach disk only through an explicit human act, so neither
 * needs a mutating tool.
 */
export function allowsTool(mode: AgentMode, kind: string | undefined): boolean {
  if (mode === 'full') return true;
  if (!kind) return false;
  if (READ_ONLY_KINDS.includes(kind)) return true;
  return mode === 'autoEdit' && kind === 'edit';
}

/**
 * Why a tool call was refused, in the reader's terms, or null if it was not.
 *
 * SILENCE IS THE FAILURE THIS PREVENTS. A denied write that says nothing looks
 * exactly like an agent that chose not to write, and the person cannot tell
 * whether the mode is working. The sentence names the mode, so the fix is
 * obvious and is theirs to make.
 */
export function refusalFor(mode: AgentMode, kind: string | undefined): string | null {
  if (allowsTool(mode, kind)) return null;
  const what = kind ?? 'that';
  if (mode === 'plan') {
    return `Plan mode is read-only, so the "${what}" step was not run. Nothing has been changed. Switch to Propose to get the change as something you can read and accept.`;
  }
  if (mode === 'propose') {
    return `Propose mode does not run "${what}" directly. Changes arrive as a proposal you accept, and nothing reaches disk on its own.`;
  }
  return `Auto-edit writes files but does not run "${what}". Switch to Full access to allow it.`;
}

/**
 * THE INSTRUCTIONS — the "in-depth instructions" the owner asked for.
 *
 * Versioned here rather than typed by each user, so every plan-mode turn in
 * this product plans the same way and an improvement to how it plans is a
 * change to a file with a diff and a test, not a habit somebody has to
 * remember.
 *
 * Every clause below exists because of a failure mode worth naming:
 *
 *   SURVEY FIRST — a plan that skips this is a guess about a repository that
 *   was sitting right there, and it is the failure a grounded product has the
 *   least excuse for.
 *
 *   NAME THE FILES — "update the auth layer" cannot be checked, cannot be
 *   estimated, and cannot be handed to anyone. A file list can be all three.
 *
 *   SAY WHAT IS UNCERTAIN — the single most useful thing a plan carries, and
 *   the first thing an eager one drops. A plan with no unknowns is either
 *   trivial or dishonest.
 *
 *   ORDER WITH DEPENDENCIES — a list of changes is not a plan until it says
 *   what has to happen before what.
 *
 *   DO NOT PAD — a three-step change gets three steps. Padding a plan to look
 *   thorough is how a reader loses the ability to tell a big change from a
 *   small one.
 *
 *   NO EDITS — the mode already refuses them at the tool boundary; saying so
 *   here means the agent stops trying rather than accumulating refusals.
 */
export const PLAN_MODE_INSTRUCTIONS = `You are in PLAN MODE. You may read anything in this repository and you may not change anything. Every tool that writes, moves, deletes or executes is refused, so do not attempt one.

Produce a plan, and hold it to this bar:

1. SURVEY BEFORE YOU PROPOSE. Read the code that the change actually touches. A plan that guesses about a repository you could have read is the one failure this product has no excuse for.

2. NAME THE FILES. Say which files change and what each change is for. "Update the auth layer" cannot be checked, estimated, or handed to anyone; a list of paths can be all three.

3. SAY WHAT YOU ARE UNSURE OF, and what would settle it. This is the most useful thing a plan carries and the first thing an eager plan drops. If a decision belongs to the reader, say so and give them the options rather than picking one quietly.

4. ORDER THE WORK, AND SAY WHAT DEPENDS ON WHAT. A list of changes is not a plan until it says what has to happen first.

5. STATE HOW EACH STEP WILL BE VERIFIED. Name the test or the check. A step nobody can confirm is a step nobody can finish.

6. DO NOT PAD. A three-step change gets three steps. Length is not thoroughness, and a padded plan destroys the reader's ability to tell a large change from a small one.

End with the plan itself, not with an offer to write it.`;

/** How a plan-mode turn is allowed to end. */
export interface PlanOutcome {
  /** The plan, as written. */
  plan: string;
  /**
   * Always false. Accepting a plan is the READER'S act, and an agent that
   * could accept its own plan would make the mode decorative.
   */
  accepted: false;
}

export function planOutcome(plan: string): PlanOutcome {
  return { plan, accepted: false };
}
