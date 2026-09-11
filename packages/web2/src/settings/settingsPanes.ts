/* ══════════════════════════════════════════════════════════════════════════
   GETTING TO THE SETTING YOU CAME FOR
   packages/web2/src/settings/settingsPanes.ts

   The panel is one long scroll: the provider form, notifications, this
   repository's hooks and nine workspace sections, all stacked. A reader who
   opened it to add an API key — which is now the destination of the failure
   strip's "Open Settings", so it is the single most likely reason anyone opens
   this at all — lands at the top and reads down.

   ── AND THE OVERLAY ALREADY SAID WHICH ONE ───────────────────────────────

   `ShellOverlay` has carried `{ kind: 'settings'; pane }` from the beginning.
   Every caller passes one — `connect.tsx` dispatches `pane: 'provider'` from
   the failure strip and from the toolbelt — and THE PANEL NEVER READ IT. The
   request was being made and answered by nobody, which is this repository's
   documented failure mode.

   ── THE OLD UNION NAMED PANES THAT DO NOT EXIST ──────────────────────────

   It was `'provider' | 'permissions' | 'appearance'`. The panel draws a
   provider form, notifications, hooks and workspace sections; there is no
   permissions pane and no appearance pane, and light is deferred by Graphite
   decision so there may never be one. A contract naming surfaces that do not
   exist is a contract that cannot be honoured — so it now names the four that
   do.
   ══════════════════════════════════════════════════════════════════════════ */

/** The panes the panel actually draws. */
export type SettingsPane = 'provider' | 'notifications' | 'hooks' | 'workspace';

export interface PaneTab {
  id: SettingsPane;
  label: string;
  /** What a reader is looking for when they want this one. */
  title: string;
}

/**
 * The sidebar nav items, in the order a reader meets them.
 *
 * PROVIDER IS FIRST because it is the one that blocks everything else: with no
 * model configured the assistant cannot answer, and the failure strip routes
 * here for exactly that. The rest are things you adjust once the product
 * already works.
 */
export const SETTINGS_PANES: readonly PaneTab[] = [
  { id: 'provider', label: 'Reasoning', title: 'Which reasoning provider answers, and the key it uses' },
  { id: 'notifications', label: 'Notifications', title: 'Being told when a long run finishes' },
  { id: 'hooks', label: 'Hooks', title: "This repository's own hook scripts" },
  { id: 'workspace', label: 'Workspace', title: 'The folder, sessions, memory and tools' },
];

/**
 * Which pane to show.
 *
 * FALLS BACK TO `provider` RATHER THAN TO NOTHING. A panel opened with an
 * unknown pane showing an empty frame would be worse than one that ignored the
 * request entirely — at least the old behaviour drew something. And `provider`
 * is the honest default for the same reason it is first.
 */
export function resolvePane(requested: unknown): SettingsPane {
  return SETTINGS_PANES.some((p) => p.id === requested) ? (requested as SettingsPane) : 'provider';
}

/** Whether a pane is the one showing — for `aria-selected` and the mark. */
export function isCurrent(pane: SettingsPane, current: SettingsPane): boolean {
  return pane === current;
}
