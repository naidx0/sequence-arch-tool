/* ══════════════════════════════════════════════════════════════════════════
   MODALITY, ACTUALLY DELIVERED
   packages/web2/src/shell/focusTrap.ts

   Four of the five overlays declare `role="dialog"` and none of them manages
   focus. That role is a PROMISE — it tells a screen reader, and a keyboard
   user, that the thing behind the scrim is unreachable. It was not.

   Open Settings and press Tab: focus walks out of the dialog, through the
   board behind the scrim, into controls the reader cannot see. Close the
   palette with Escape and the next Tab starts again from the top of the page,
   because nothing recorded where focus had been.

   ── THE THREE PARTS, AND WHY EACH IS ITS OWN FAILURE ─────────────────────

     1. INITIAL FOCUS. A dialog that opens without moving focus leaves the
        keyboard behind the scrim, so the first Tab goes somewhere invisible.
     2. CONTAINMENT. Tab from the last control must return to the first, and
        Shift+Tab from the first must reach the last. Without it "modal" is a
        visual effect only.
     3. RESTORE. On close, focus returns to whatever opened the dialog. Without
        it a reader who opens and closes Settings from the app bar is dumped at
        the top of the document and has to walk back.

   ── WHY THIS IS A FUNCTION AND NOT A COMPONENT ───────────────────────────

   Every overlay renders its own chrome and must keep doing so; what they share
   is behaviour, not markup. A wrapper component would also have had to own the
   scrim, which `Shell` already owns and tests.

   The DOM query is deliberately conservative: it asks for the elements the
   platform itself considers focusable, and excludes anything hidden or
   `inert`, because trapping focus onto something that cannot receive it is
   the same bug in a different place.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * What the platform treats as tabbable.
 *
 * `[tabindex]` is included and then filtered, because `tabindex="-1"` is
 * focusable by script and NOT by Tab — putting it in the ring would strand a
 * reader on an element the key cannot leave.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
].join(',');

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute('inert')) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;

  /*
   * COMPUTED STYLE, NOT `offsetParent`.
   *
   * The first draft tested `el.offsetParent !== null`, which is wrong in two
   * places at once: it is null in jsdom, which has no layout, and it is ALSO
   * null for `position: fixed` elements in real browsers — which is what an
   * overlay is. So the trap would have found nothing focusable in exactly the
   * dialogs it exists for, and silently done nothing.
   *
   * `display` and `visibility` are the properties that actually decide whether
   * the platform will let a control take focus, and jsdom implements both.
   */
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

/** Every element inside `root` that Tab can reach, in document order. */
export function tabbable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    const index = el.getAttribute('tabindex');
    if (index !== null && Number(index) < 0) return false;
    return isVisible(el);
  });
}

/**
 * Handle one Tab press inside a dialog.
 *
 * Returns true when it moved focus, so a caller knows to `preventDefault`.
 * Doing nothing and returning false is the honest answer for a dialog with no
 * focusable content at all — swallowing the key there would strand the reader
 * with no way out except the mouse.
 */
export function wrapTab(root: HTMLElement, event: KeyboardEvent): boolean {
  const ring = tabbable(root);
  if (ring.length === 0) return false;

  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  const active = document.activeElement as HTMLElement | null;

  if (event.shiftKey) {
    /* Also wraps when focus is somewhere the ring does not contain — which is
       what has happened if focus escaped before the trap was installed. */
    if (active === first || active === null || !root.contains(active)) {
      last.focus();
      return true;
    }
    return false;
  }

  if (active === last || active === null || !root.contains(active)) {
    first.focus();
    return true;
  }
  return false;
}

/**
 * Move focus into a newly opened dialog.
 *
 * Prefers the first tabbable control. Falls back to the dialog itself, which
 * requires the container to carry `tabindex={-1}` — a dialog with nothing to
 * focus still has to take focus, or the reader stays behind the scrim.
 */
export function focusFirst(root: HTMLElement): void {
  const ring = tabbable(root);
  if (ring.length > 0) {
    ring[0]!.focus();
    return;
  }
  root.focus();
}

/**
 * Install the trap. Returns a teardown that also RESTORES focus.
 *
 * The opener is recorded at install time rather than passed in, because the
 * element that had focus when the dialog opened is the only thing that is
 * reliably the opener — a caller passing a ref would be guessing.
 */
export function trapFocus(root: HTMLElement): () => void {
  const opener = document.activeElement as HTMLElement | null;

  focusFirst(root);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    if (wrapTab(root, event)) event.preventDefault();
  };

  document.addEventListener('keydown', onKeyDown, true);

  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    /* Restore only if the opener is still in the document and still focusable.
       Focusing a detached node throws in some browsers and does nothing in the
       rest, and either way the reader would end up at the top of the page. */
    if (opener && opener.isConnected && typeof opener.focus === 'function') {
      opener.focus();
    }
  };
}
