/* ══════════════════════════════════════════════════════════════════════════
   THE V3 WORKSPACE, AS A TEST READS IT
   packages/web2/test/support/v3.ts

   ── WHY THIS EXISTS, AND WHY IT IS NOT A SET OF ALIASES ───────────────────

   Six test files were written against the v2 shell's chrome — `workspace-tabs`,
   `workspace-tab-<id>`, `shell-workspace-pane-<id>`, `shell-settings-gear`.
   None of those elements exists: `shell/Shell.tsx` is a retired stub returning
   `null` (Decision 22) and V3 draws the workspace itself.

   The tempting repair is a table of old-name to new-name. That would be the
   shortest green edit and it would cost the tests their meaning, because the
   two chromes do not say the same things in different words. Two examples,
   both of which a rename would have papered over:

     A v2 pill carried `aria-selected`. A V3 pill carries `aria-pressed` for
     OPEN and a class for FOCUSED, and those are DIFFERENT FACTS — three panes
     can be open and only one focused. A test that read `aria-selected` on a
     V3 pill would have been asking one question and getting the other.

     v2 had a workspace `+` menu that gated Files on attach. V3 has no `+`
     menu: every surface is a pill, and Files is gated where the pane mounts.
     There is no element to rename that to.

   So this module is a reading of V3's DOM in the vocabulary of what a reader
   can SEE, and each helper says which fact it reports. A test that wants
   "open" asks `paneIsOpen`; one that wants "focused" asks `paneIsFocused`; and
   the difference is visible at the call site rather than buried in a selector.

   ONE PLACE, because the mapping is the part that goes stale. When a V3
   testid moves, one file changes.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, screen, within } from '@testing-library/react';

import { CHROME_TAB_DEFS, type ChromeTabId } from '../../src/app/chromeTabModel';

/** The workspace bar itself — `<nav aria-label="Workspace">`. */
export function workspaceBar(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Workspace' });
}

/**
 * One pill in the workspace bar.
 *
 * Scoped to the bar, not to the document: `Files`, `Terminal` and `Browser`
 * are also the names of things inside their own panes, and a document-wide
 * lookup finds whichever mounted first.
 */
export function tab(id: ChromeTabId): HTMLElement {
  return within(workspaceBar()).getByRole('button', { name: CHROME_TAB_DEFS[id].label });
}

/**
 * IS THE PANE OPEN — `aria-pressed` on the pill.
 *
 * Open is not focused. Several panes are open at once by design (the owner's
 * multi-pane walk), and the bar says so on each of their pills.
 */
export function paneIsOpen(id: ChromeTabId): boolean {
  return tab(id).getAttribute('aria-pressed') === 'true';
}

/**
 * IS THE PANE FOCUSED — exactly one, ever.
 *
 * Read off the pill's own class rather than off the pane, because the pill is
 * what a reader looks at to answer this, and because chat has a pill and no
 * live pane.
 */
export function paneIsFocused(id: ChromeTabId): boolean {
  return tab(id).classList.contains('is-selected');
}

/**
 * Open a pane if it is not open. Idempotent — a pill is a toggle, so a second
 * call on an open pane would CLOSE it.
 *
 * `fireEvent`, not `element.click()`: a raw DOM click is not wrapped in `act`,
 * so React has not flushed by the time the next assertion reads the DOM and
 * the test fails on scheduling rather than on the rule.
 */
export function openPane(id: ChromeTabId): void {
  if (!paneIsOpen(id)) fireEvent.click(tab(id));
}

/**
 * Close a pane if it is open, from its own × — the control a reader uses.
 *
 * Not the pill: the pill toggles, so calling it on a CLOSED pane would open
 * one and a test that meant "make sure this is shut" would do the opposite.
 */
export function closePane(id: ChromeTabId): void {
  if (!paneIsOpen(id)) return;
  const x = document.querySelector<HTMLElement>(`[data-testid="v3-tab-close-${id}"]`);
  if (x) fireEvent.click(x);
}

/** The live pane's own section, or null when it is not mounted. */
export function pane(id: ChromeTabId): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.v3-live-pane[data-surface="${id}"]`);
}

/** Every live pane currently mounted, in the order the stack draws them. */
export function openPanes(): ChromeTabId[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.v3-live-pane[data-surface]'),
    (el) => el.dataset.surface as ChromeTabId,
  );
}
