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
