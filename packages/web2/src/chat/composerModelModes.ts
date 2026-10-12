import type { AccessMode, PermissionMode } from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   THE THREE MODES (round 11) — NO REACT, NO DOM.
   packages/web2/src/chat/composerModelModes.ts

   Owner, 2026-10-08: "We don't need five modes. Remove teaching — fold
   teaching into planning ... Then edit mode with permissions — auto with
   smart permissions (blocked when risky). Then full auto, bypass / skip
   permissions."

   The composer's state still has two wire values, `permission.mode`
   (plan | build) and `permission.access` (ask | autoEdit | full), because the
   server and the ACP agents read those. A mode is a NAME for one pair of them:

     Plan      intent plan                 -> ACP `plan` (every write refused)
     Smart     intent build + autoEdit     -> ACP `autoEdit` (edits go through,
                                              risky commands still ask)
     Full auto intent build + full         -> ACP `full` (skip permissions)

   `teach` is gone as a mode: Plan's prompt now carries the teaching and
   discussion text (packages/acp planMode.ts), and a saved `teach` loads as Plan.
   ══════════════════════════════════════════════════════════════════════════ */

export type ComposerModeKey = 'plan' | 'smart' | 'full';

export const COMPOSER_MODE_KEYS: readonly ComposerModeKey[] = ['plan', 'smart', 'full'];

export const DEFAULT_COMPOSER_MODE: ComposerModeKey = 'smart';

/** The copy each mode wears in the popup, the slash palette and the chip. */
export const COMPOSER_MODE_COPY: Record<ComposerModeKey, { label: string; desc: string }> = {
  plan: { label: 'Plan', desc: 'Plans and teaches, no edits' },
  smart: { label: 'Smart', desc: 'Edits, asks before commands' },
  full: { label: 'Full auto', desc: 'Skips permissions' },
};

export function isComposerModeKey(v: unknown): v is ComposerModeKey {
  return v === 'plan' || v === 'smart' || v === 'full';
}

/**
 * A saved or typed mode name from any past version -> today's mode.
 *
 *   teach, plan                          -> plan
 *   ask, propose                         -> plan   (the old Ask; see below)
 *   build, edit, autoEdit, smart         -> smart   (build alone is the old default: auto-edit)
 *   auto, skip, bypass, full, ...        -> full
 *
 * A saved Ask NEVER WIDENS (owner, round 11): Ask asked before every edit, and
 * Smart edits on its own, so Ask becomes Plan, the most restrictive of the
 * three. A saved `build` whose separately saved `access` is `ask` is the same
 * Ask. A saved `build` that was at Full access is Full auto. Anything
 * unrecognised is the default (Smart), never Full auto.
 */
export function modeFromSaved(mode: string | null | undefined, access?: string | null): ComposerModeKey {
  const m = (mode ?? '').trim().toLowerCase();
  if (m === 'plan' || m === 'teach' || m === 'teaching' || m === 'ask' || m === 'propose') return 'plan';
  if (m === 'full' || m === 'auto' || m === 'fullauto' || m === 'full-auto' || m === 'full access' || m === 'skip' || m === 'bypass' || m === 'yolo') return 'full';
  if (m === 'smart' || m === 'edit' || m === 'autoedit' || m === 'auto-edit' || m === 'build') {
    if (m === 'build' && access === 'ask') return 'plan';
    return m === 'build' && access === 'full' ? 'full' : 'smart';
  }
  return DEFAULT_COMPOSER_MODE;
}

/** The one quiet line said, once, when a saved Ask is carried over as Plan. */
export const ASK_NOW_PLAN_NOTE = 'Ask mode is now Plan. Pick Smart to let the agent edit.';
/** Set by hydrate when the note is owed; the composer shows it once and clears it. */
export const MODE_NOTE_KEY = 'v3.composer.modeNote';

/** What hydrate does with what was saved: the wire pair to load, and the rewrite that makes it stick. */
export interface SavedModeLoad {
  key: ComposerModeKey;
  /** Dispatch `composer/permission` with this (null = leave the intent alone). */
  intent: PermissionMode | null;
  /** Dispatch `composer/access` with this (null = nothing was saved). */
  access: AccessMode | null;
  /** The old Ask was carried over as Plan: say so once. */
  note: boolean;
  /** Storage to rewrite so the carry-over happens once; null when nothing changes. */
  rewrite: { mode: 'plan'; access: AccessMode } | null;
}

/**
 * Decide, from the two saved values, what the composer loads as. Pure.
 * `buildEnabled` is the project's own opt-in for Build (auto-edit / Full); without it the intent stays Plan.
 */
export function loadSavedMode(rawMode: string | null, rawAccess: string | null, buildEnabled: boolean): SavedModeLoad {
  const savedAccess: AccessMode | null = rawAccess === 'ask' || rawAccess === 'autoEdit' || rawAccess === 'full' ? rawAccess : null;
  const key = modeFromSaved(rawMode, savedAccess);
  const m = (rawMode ?? '').trim().toLowerCase();
  /* Ask in either of its saved shapes: the old mode name, or Build at Ask access. */
  const wasAsk = m === 'ask' || m === 'propose' || (m === 'build' && savedAccess === 'ask');
  const askAccess = savedAccess === 'ask';
  if (wasAsk || askAccess) {
    /* Plan, with the access stored as Auto-edit so a later pick of Smart starts from Smart, never from Ask. */
    return {
      key: 'plan',
      intent: 'plan',
      access: 'autoEdit',
      note: wasAsk,
      rewrite: { mode: 'plan', access: 'autoEdit' },
    };
  }
  /* Nothing saved leaves the composer at its own default; Build needs the project's opt-in. */
  const intent: PermissionMode | null = m === '' ? null : key === 'plan' ? 'plan' : buildEnabled ? 'build' : null;
  return { key, intent, access: savedAccess, note: false, rewrite: null };
}

/** The mode a composer state is in: its intent and access read together. */
export function modeOf(intent: PermissionMode, access: AccessMode): ComposerModeKey {
  if (intent === 'plan') return 'plan';
  return access === 'full' ? 'full' : 'smart';
}

/** What a mode means on the wire: the intent, and the access it needs (null = leave access alone). */
export function wireOf(mode: ComposerModeKey): { intent: PermissionMode; access: AccessMode | null } {
  if (mode === 'plan') return { intent: 'plan', access: null };
  return { intent: 'build', access: mode === 'full' ? 'full' : 'autoEdit' };
}

/** The ACP `permissionMode` a mode reaches the agent as (mirrors chat/accessMode.ts `acpPermissionModeFor`). */
export function acpModeOf(mode: ComposerModeKey): 'plan' | 'autoEdit' | 'full' {
  return mode === 'plan' ? 'plan' : mode === 'full' ? 'full' : 'autoEdit';
}

/** Shift+Tab: the next mode, wrapping Full auto back to Plan. */
export function nextComposerMode(mode: ComposerModeKey): ComposerModeKey {
  const i = COMPOSER_MODE_KEYS.indexOf(mode);
  return COMPOSER_MODE_KEYS[(i + 1) % COMPOSER_MODE_KEYS.length]!;
}

/** What gets written to `v3.composer.mode` / the last place: the names V3App's hydrate already reads. */
export function savedNameOf(mode: ComposerModeKey): 'plan' | 'build' {
  return mode === 'plan' ? 'plan' : 'build';
}
