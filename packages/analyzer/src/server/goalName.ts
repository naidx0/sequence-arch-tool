/**
 * ══ A GOAL HAS A NAME, AND THE NAME IS NOT THE PROMPT ══════════════════════
 *
 * Owner, 2026-09-22, on the Bastion session: "The goal just takes the prompt
 * and shoves it … The goal name should be summarized by the task." The goalbar
 * and the rail both read "this long running task and goal from earlier make
 * tand decide on the logic behind this fe…" — the sentence he typed, typos and
 * all, cut at 48 characters.
 *
 * The goal itself stays his words, verbatim: it is the standing instruction
 * every prompt carries, and rewriting an instruction is changing it. What
 * changes is the NAME shown for it — an outcome in a few words, written by the
 * model when one answers ("Explore and explain the Bastion repository"), and
 * the deterministic title trimmer when none does.
 */
import { summarizeSessionTitle } from './sessionsStore.js';

export const GOAL_NAME_MAX_WORDS = 10;
/** How long a new goal waits for its name before keeping the trimmer's. */
export const GOAL_NAME_TIMEOUT_MS = 15_000;
const GOAL_NAME_MAX_CHARS = 72;

/** One short ask. No absolutes, no format lecture — the answer is one line. */
export function goalNamePrompt(goal: string): string {
  return (
    'Give this goal a short name: four to nine words saying what will be done, ' +
    'as an outcome, with the spelling fixed. Reply with the name only.\n\n' +
    `Goal: ${goal.trim().slice(0, 1200)}`
  );
}

/**
 * The name out of a reply, or `null` when the reply is not a name. A model
 * that answers with a paragraph, a list or nothing has not named the goal,
 * and the fallback is better than any piece of that.
 */
export function parseGoalName(reply: string): string | null {
  const line = reply
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const name = line
    .replace(/^(?:goal\s*name|name|goal)\s*[:\-–—]\s*/i, '')
    .replace(/^[*_#>\-\s"'`“”‘’]+|[*_"'`“”‘’\s]+$/g, '')
    .replace(/[.!]+$/, '')
    .trim();
  if (!name) return null;
  const words = name.split(/\s+/).length;
  if (words < 2 || words > GOAL_NAME_MAX_WORDS || name.length > GOAL_NAME_MAX_CHARS) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Without a model: the same trimmer the rail's titles use. */
export function fallbackGoalName(goal: string): string {
  return summarizeSessionTitle(goal);
}

/**
 * A CHAT IS NAMED BY WHAT IT ASKS, from the beginning of its first message
 * (owner, 2026-09-22: "it should only send the beginning of the first prompt
 * … use the same model they're using locally, just to name that session";
 * "if I requested to build something, the chat name should be like 'build
 * XYZ feature'"). Named once, at the start of the first turn, so the reply is
 * not waited for and a later prompt never renames it. The trimmed first
 * message stays the fallback when no model answers.
 */
export const SESSION_TITLE_PROMPT_CHARS = 600;

export function sessionTitlePrompt(firstMessage: string): string {
  return (
    'Name this chat in three to seven words, as what it asks for — an outcome, with the ' +
    'spelling fixed. Examples: "Build the memory feature", "Explain the gateway routing", ' +
    '"Break down the harness architecture". Reply with the name only.\n\n' +
    `The message begins: ${firstMessage.trim().slice(0, SESSION_TITLE_PROMPT_CHARS)}`
  );
}
