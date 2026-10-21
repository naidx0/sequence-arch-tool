/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN — where Start chatting lands
   packages/web2/src/onboarding/landing.ts

   Round 12: no project attach and no reload, so the only helper left is the
   one that puts the caret in the composer.
   ══════════════════════════════════════════════════════════════════════════ */

/** Put the caret in the composer, once the field exists. */
export function focusComposer(doc: Document = document): boolean {
  const field = doc.querySelector<HTMLElement>('[data-testid="composer-field"]');
  if (!field) return false;
  field.focus();
  return doc.activeElement === field;
}

/** The chat box mounts a frame after a screen leaves: put the caret in it once it exists. */
export function focusComposerSoon(): void {
  let tries = 0;
  const tick = () => {
    tries += 1;
    if (focusComposer() || tries > 60) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
