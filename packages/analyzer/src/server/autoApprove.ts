/* ══════════════════════════════════════════════════════════════════════════
   AUTO-APPROVE — THE UNATTENDED AUTONOMY MODE
   packages/analyzer/src/server/autoApprove.ts

   ── WHAT IT IS, IN ONE LINE ──────────────────────────────────────────────

   Owner's ask, 2026-09-02: "there should be some auto approve bypass
   permissions mode as well please which would be awesome for the tools so it
   can run like its own agentic workflow fully independent."

   Mechanically that is ONE transform and nothing else: an `ask` verdict from
   {@link evaluatePermission} becomes `allow` for the session. Today an `ask`
   REFUSES — `describeVerdict` in `permissionRules.ts` says the call "was NOT
   run" because "this turn has no approval channel open". This module is the
   approval channel, opened once by the user for a repository they have
   already trusted.

   ── WHY IT SHIPPED LAST, AND WHAT IT RIDES ON ────────────────────────────

   `docs/research/trust-boundary-verification.md` sequenced this behind the
   trust boundary, deliberately: before that boundary a hostile repository
   could run code as the owner the first time he attached it, and auto-approve
   would have turned that from dangerous into automatic and silent. The
   boundary shipped (`repoTrust.ts`), so this is unblocked — and it is gated on
   the SAME boundary rather than on a settings toggle of its own, because a
   mode that could be switched on globally and then have a hostile repo
   attached under it would make the boundary decorative.

   ── THE FOUR THINGS THIS MODULE REFUSES TO DO ────────────────────────────

   1. IT NEVER OVERRIDES A `deny`. The transform is `ask -> allow`, and that
      is enforced by the TYPE of {@link approveAskVerdict}: its parameter is
      {@link AskPermissionVerdict}, reachable only through the
      {@link isAskVerdict} guard, so a future edit that tried to hand it a
      `deny` fails to compile rather than widening the mode. A user's explicit
      deny outranks autonomy, always.

   2. IT CANNOT BE ENABLED ON AN UNTRUSTED REPOSITORY, and it is not enough to
      check that once: {@link isAutoApproveActive} re-asks `isRepoTrusted` on
      EVERY call, so attaching an untrusted repo while the mode is on does not
      run autonomously. Trust can be revoked between the turn that enabled it
      and the turn that would use it, and the whole point of the boundary is
      that a repo you have not consented to does not act as you.

   3. IT IS NOT PERSISTED. The state is a module-scope `Set` and dies with the
      process. A permanent bypass written to disk is a different feature with a
      different risk, and nobody asked for one. It is the deliberate opposite
      of `repo-trust.json`, whose own header explains why THAT one is a file.

   4. IT RAISES NO CEILING. Everything refused by CODE stays refused: writes
      outside the repo root (`server/jail.ts`), a `run_command` whose
      allowlisted string resolves to something that is not a runner
      (`resolveRepoScript` / `runAllowlistedRepoCommand` in
      `harness/verifyGate.ts`), and the untrusted-repo execution refusal.
      Auto-approve removes the PROMPT below the ceiling; it does not move it.

   LOCAL-FIRST IS UNTOUCHED. Nothing here reaches the network or reads a key;
   it is a `Set` of strings and one call into the local trust file.
   ══════════════════════════════════════════════════════════════════════════ */

import type { PermissionVerdict } from './permissionRules.js';
import { isRepoTrusted, repoTrustKey } from './repoTrust.js';

/**
 * The `step:*` id that says on screen "this turn ran without asking".
 *
 * Shared with the client, which maps it to English rather than printing the
 * slug (`packages/web2/src/state/store.ts`, `NAMED_STEP_ROW`). A constant
 * because the two halves must agree on the spelling — the same arrangement
 * `TEACH_MODE_STEP_ID` already has, and reusing `step:*` is why this needs no
 * new ask-stream event and no new row in `tools/ci/reachability-baseline.json`.
 */
export const AUTO_APPROVE_STEP_ID = 'auto-approve';

/**
 * THE SESSION. Canonical repo roots the user has switched the mode on for.
 *
 * Module scope, in memory, never written anywhere. A restart clears it, which
 * is constraint 3 and is the point: the user re-decides each time they launch,
 * because "run my tools unattended" is a decision about a sitting, not a
 * property of a directory.
 */
const enabledRoots = new Set<string>();

/** Everything this module can answer about one repository. */
export interface AutoApproveState {
  /** Canonical root the answer is about, or null when there is no such dir. */
  root: string | null;
  /** Is the repository trusted right now? Auto-approve is meaningless without it. */
  trusted: boolean;
  /** Is the mode ACTIVE — switched on AND still trusted. */
  on: boolean;
  /**
   * Why it is not on, in one sentence the user can act on, or null when it is.
   * Honest errors (`docs/vision.md` §5): a refusal that says only "no" is a
   * refusal nobody can fix.
   */
  refusal: string | null;
}

/**
 * The refusal sentence for enabling — or keeping — the mode on a repository
 * that is not trusted.
 *
 * ONE STRING, ONE PLACE, the same arrangement `repoExecutionRefusal` makes: the
 * route, the model and the UI all say this, so they cannot drift into three
 * explanations of one rule. It names TRUST because trust is the thing the user
 * can change; "auto-approve is unavailable" would leave them clicking a switch
 * that never moves.
 */
export const AUTO_APPROVE_UNTRUSTED_REFUSAL =
  'auto-approve cannot be turned on for a repository that is not trusted. Running tools ' +
  'unattended means running this repository\'s own code without being asked each time, so the ' +
  'trust decision comes first. Trust the repository in Sequence, then turn this on.';

/** The refusal for a root that does not resolve to a directory at all. */
export const AUTO_APPROVE_NO_REPO_REFUSAL =
  'auto-approve needs an attached repository — there is nothing to run tools against.';

/**
 * Read the mode for one repository. TOTAL: every uncertain case answers `off`.
 *
 * THE TRUST RE-CHECK IS HERE, NOT AT THE SWITCH. `enabledRoots` remembers a
 * decision; this function decides whether that decision still applies, and it
 * asks the boundary every single time. A mode that checked trust only when it
 * was switched on would survive `PUT /api/repo-trust {"trusted":false}` and
 * would survive detaching a trusted repo and attaching a hostile one under the
 * same process — both of which are exactly the case the boundary exists for.
 *
 * `isRepoTrusted`'s OWN default store, never an injected directory: the
 * boundary has exactly one store (`repoTrust.ts`, and the same note on
 * `PUT /api/repo-trust`), and a caller that could redirect the trust read could
 * grant itself autonomy by pointing at a store it wrote.
 */
export function readAutoApprove(repoRoot: string | null | undefined): AutoApproveState {
  const root = repoTrustKey(repoRoot);
  if (root === null) {
    return { root: null, trusted: false, on: false, refusal: AUTO_APPROVE_NO_REPO_REFUSAL };
  }
  const trusted = isRepoTrusted(root);
  if (!trusted) {
    /* Switched on earlier and the repository has since lost trust: the answer
       is OFF and the memory is dropped, so a later re-trust does not silently
       resurrect an autonomy grant the user never re-made. */
    enabledRoots.delete(root);
    return { root, trusted: false, on: false, refusal: AUTO_APPROVE_UNTRUSTED_REFUSAL };
  }
  const on = enabledRoots.has(root);
  return {
    root,
    trusted: true,
    on,
    refusal: on ? null : 'auto-approve is off for this repository.',
  };
}

/**
 * Is the mode active for this repository, right now?
 *
 * The one predicate the pipeline asks per turn. Everything above is the reason
 * this is not simply a boolean somebody set once.
 */
export function isAutoApproveActive(repoRoot: string | null | undefined): boolean {
  return readAutoApprove(repoRoot).on;
}

/**
 * Turn the mode on or off for one repository, for this process only.
 *
 * ENABLING IS REFUSED OUTRIGHT ON AN UNTRUSTED REPO — it does not record the
 * wish and wait for trust. A switch that stored "on, pending trust" would mean
 * that trusting a repository later ALSO granted it autonomy, in one click the
 * user thought was about instructions and commands. Two decisions, two actions.
 *
 * Turning it OFF always succeeds, including on an untrusted repo: a user
 * revoking autonomy must never be told they may not.
 */
export function setAutoApprove(
  repoRoot: string | null | undefined,
  on: boolean,
): AutoApproveState {
  const root = repoTrustKey(repoRoot);
  if (root === null) {
    return { root: null, trusted: false, on: false, refusal: AUTO_APPROVE_NO_REPO_REFUSAL };
  }
  if (!on) {
    enabledRoots.delete(root);
    return readAutoApprove(root);
  }
  if (!isRepoTrusted(root)) {
    return { root, trusted: false, on: false, refusal: AUTO_APPROVE_UNTRUSTED_REFUSAL };
  }
  enabledRoots.add(root);
  return readAutoApprove(root);
}

/**
 * Forget every grant this process made. Used when the active repository
 * changes (`POST /api/attach`) and by tests, which must not leak into each
 * other.
 *
 * Detaching drops the grant even though `readAutoApprove` would re-check trust
 * anyway: the grant is scoped to a sitting with ONE repository, and leaving it
 * armed for a root the user has walked away from is state nothing on screen
 * explains.
 */
export function clearAutoApprove(): void {
  enabledRoots.clear();
}

/* ═══════════════════════════════════════════════════ the transform itself ═ */

/**
 * A verdict that is KNOWN to be `ask`. The only thing auto-approve may touch.
 *
 * This type is the lock for constraint 1 and it is why the rule is structural
 * rather than a condition somebody could edit. `PermissionVerdict.decision` is
 * a three-member union, and TypeScript does not narrow the OBJECT from a check
 * on that property — so the only way to obtain one of these is
 * {@link isAskVerdict}, and a future change that tried to pass a `deny` verdict
 * to {@link approveAskVerdict} is a compile error, not a widened mode.
 */
export type AskPermissionVerdict = PermissionVerdict & { decision: 'ask' };

/** The one door to {@link AskPermissionVerdict}. */
export function isAskVerdict(verdict: PermissionVerdict): verdict is AskPermissionVerdict {
  return verdict.decision === 'ask';
}

/**
 * `ask` → `allow`, with the reason rewritten so the record says WHY it ran.
 *
 * The old reason ended "this turn has no approval channel open, so it was NOT
 * run" — which would be a lie on a call that did run. The verdict rides the
 * tool result onto the SSE receipt and into the model's next prompt, so a
 * stale sentence here is a surface asserting something the engine did not do,
 * which is this repo's standing defect. It keeps naming the rule and the file,
 * because the user still has to be able to find the rule that would have asked.
 *
 * THE RUNTIME BRANCH IS A BELT, NOT THE LOCK. The lock is the parameter type
 * above. `dist/` is JavaScript and an untyped caller could force anything
 * through, so a non-`ask` verdict is returned UNCHANGED rather than widened —
 * the failure mode of this function must be "nothing happened", never "a deny
 * became an allow".
 */
export function approveAskVerdict(verdict: AskPermissionVerdict): PermissionVerdict {
  if (verdict.decision !== 'ask') return verdict;
  const what = verdict.subject !== undefined ? `"${verdict.subject}"` : 'this call';
  return {
    ...verdict,
    decision: 'allow',
    reason:
      `${what} was AUTO-APPROVED: ${verdict.rule !== undefined ? `the permission rule \`${verdict.rule}\` puts it on the ask list, and ` : ''}` +
      `auto-approve is on for this session on a trusted repository, so it ran without asking. ` +
      `Denied calls are still denied.`,
  };
}
