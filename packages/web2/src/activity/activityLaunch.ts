/**
 * P4 — toolbelt "Start a workflow" hands Activity a draft to author.
 *
 * The Activity overlay is store/shell state; the author form is local to
 * ConnectedActivity. This one-shot handoff carries a name + instruction from
 * the composer so Start a workflow opens the form ready to POST /api/program/run
 * rather than an empty Activity viewer.
 */

export interface ActivityLaunchDraft {
  name: string;
  instruction: string;
}

let pending: ActivityLaunchDraft | null = null;

export function setActivityLaunch(draft: ActivityLaunchDraft): void {
  pending = draft;
}

/** Consume the pending draft (once). */
export function takeActivityLaunch(): ActivityLaunchDraft | null {
  const next = pending;
  pending = null;
  return next;
}
