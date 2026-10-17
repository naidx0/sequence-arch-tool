/* ══════════════════════════════════════════════════════════════════════════
   WHAT A SUBAGENT IS CALLED (R10 polish)
   packages/web2/src/chat/subagentLabel.ts

   Claude names its subagent type as a slug ("general-purpose"). A person
   reads "General purpose". When the call also carries a description, that
   description is the title, since it says what the subagent was asked. A
   name that is not a slug ("Explore") is shown as it is. Pure.
   ══════════════════════════════════════════════════════════════════════════ */

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The title and the detail line a subagent row shows. */
export function subagentLabel(name: string, description: string): { title: string; detail: string } {
  if (!SLUG.test(name)) return { title: name, detail: description };
  if (description) return { title: description, detail: '' };
  const words = name.replace(/-/g, ' ');
  return { title: words.charAt(0).toUpperCase() + words.slice(1), detail: '' };
}
