/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN: SKILLS CHOSEN BEFORE A PROJECT EXISTS
   packages/web2/src/onboarding/skillsPending.ts

   Skills are saved inside a project, and first run has none open. When the
   person confirms rows with no project, the choice (the typed text and the
   chosen paths, nothing else) waits in localStorage; FirstRunGate imports it
   once a project is attached, through the same confirmed-only route.
   ══════════════════════════════════════════════════════════════════════════ */

import type { OnboardingClient } from './onboardingClient';

export const PENDING_SKILLS_KEY = 'sequence.onboarding.skills.pending';

export interface PendingSkills {
  text: string;
  selected: string[];
}

export function savePendingSkills(p: PendingSkills): void {
  try {
    window.localStorage.setItem(PENDING_SKILLS_KEY, JSON.stringify(p));
  } catch {
    /* The import is then simply not remembered; Settings, Skills still has it. */
  }
}

export function readPendingSkills(): PendingSkills | null {
  try {
    const raw = window.localStorage.getItem(PENDING_SKILLS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<PendingSkills>;
    if (typeof j.text !== 'string' || !Array.isArray(j.selected) || !j.selected.every((s) => typeof s === 'string')) return null;
    return { text: j.text, selected: j.selected as string[] };
  } catch {
    return null;
  }
}

export function clearPendingSkills(): void {
  try {
    window.localStorage.removeItem(PENDING_SKILLS_KEY);
  } catch {
    /* Nothing to clear. */
  }
}

/** What a deferred import came to: the notice line is built from this. */
export interface PendingOutcome {
  imported: string[];
  kept: string[];
  problems: string[];
  /** The server's reason when it refused. */
  error?: string;
}

/**
 * Import what was chosen before a project existed. The entry is dropped only once the server has
 * answered over HTTP; no project yet, or a request that threw (offline, reload), keeps it for the next try.
 * Null means nothing was pending or nothing was decided.
 */
export async function runPendingSkills(client: OnboardingClient): Promise<PendingOutcome | null> {
  const p = readPendingSkills();
  if (!p || !client.skillsImport) return null;
  const a = await client.skillsImport(p.text, p.selected);
  if (!a.ok && (a.needsProject || a.networkError)) return null;
  clearPendingSkills();
  return a.ok ? { ...a.body } : { imported: [], kept: [], problems: [], error: a.message };
}

/** The one line shown after a deferred import. */
export function pendingNotice(o: PendingOutcome, project: string): string {
  if (o.error) return `Skills were not imported: ${o.error}`;
  const n = o.imported.length;
  const head = n > 0 ? `Imported ${n} skill${n === 1 ? '' : 's'} into ${project}.` : `No new skills imported into ${project}.`;
  const tail = o.problems.length > 0 ? ` ${o.problems.length} could not be: ${o.problems[0]}` : o.kept.length > 0 ? ` ${o.kept.length} already there.` : '';
  return head + tail;
}
