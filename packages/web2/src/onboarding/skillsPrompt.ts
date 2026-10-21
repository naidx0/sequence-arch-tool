/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN: THE PROMPT THAT ASKS AN AGENT TO BRING THE SKILLS
   packages/web2/src/onboarding/skillsPrompt.ts

   One text, two uses: "Ask my agent" puts it in the chat box, and "Copy prompt for
   Claude or Codex" puts it on the clipboard for an agent outside Sequence. The agent
   copies the files into the project's .sequence/skills, and Sequence picks them up.
   ══════════════════════════════════════════════════════════════════════════ */

export const SKILLS_PROMPT =
  'Find my skills and instruction files (for example in ~/.claude/skills, ~/.codex/skills, ~/.cursor/rules, and any AGENTS.md or CLAUDE.md) ' +
  "and copy them into this project's .sequence/skills folder: one folder per skill, each with a SKILL.md. " +
  'Copy only; leave the originals where they are and do not change anything else.';

/** Copy to the clipboard; false when the browser refuses (the caller then shows the text selected). */
export async function copyText(text: string, nav: Pick<Navigator, 'clipboard'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<boolean> {
  try {
    if (!nav?.clipboard?.writeText) return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
