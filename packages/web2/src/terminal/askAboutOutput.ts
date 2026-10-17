/* ══════════════════════════════════════════════════════════════════════════
   "ASK ABOUT THIS OUTPUT": WHAT THE TERMINAL HANDS THE CHAT
   packages/web2/src/terminal/askAboutOutput.ts

   Select text in the terminal, right-click, and the chat composer gets the
   selection in a fenced block with the command that produced it and the
   folder it ran in (owner, 0.1.8 audit). Pure: no DOM, no state.

   THE PANE DOES NOT TRACK COMMANDS, so the command is READ OFF THE SCREEN: the
   text typed after the shell's prompt, on the nearest prompt line at or above
   the selection (never the prompt the cursor is still sitting on, which has run
   nothing yet). When no such line is on screen (it scrolled away, or the shell
   draws a prompt this does not know) the command is OMITTED, never guessed.
   The folder is the prompt's own path when that prompt shows one, else the
   folder the pane started the shell in, said as such.
   ══════════════════════════════════════════════════════════════════════════ */

import { condensePrompt, parsePromptLine } from './promptLine';

export interface RanCommand {
  command: string;
  /** The folder the prompt showed for it (home as ~), when the prompt showed one. */
  folder: string | null;
}

/** Where `needle` (a multi-line selection) sits in `lines` (the last place it fits), or -1. Trailing blanks are not compared. */
export function findSelection(lines: readonly string[], needle: string): number {
  const want = needle.replace(/\r/g, '').split('\n').map((l) => l.trimEnd());
  while (want.length > 1 && want[want.length - 1] === '') want.pop();
  const have = lines.map((l) => l.replace(/\r$/, '').trimEnd());
  /* The selection may begin mid-line and end mid-line; the lines between are whole. */
  for (let i = have.length - want.length; i >= 0; i--) {
    let ok = true;
    for (let k = 0; k < want.length && ok; k++) {
      const h = have[i + k]!;
      const w = want[k]!;
      if (want.length === 1) ok = h.includes(w);
      else if (k === 0) ok = h.endsWith(w);
      else if (k === want.length - 1) ok = h.startsWith(w);
      else ok = h === w;
    }
    if (ok) return i;
  }
  return -1;
}

/** The command last run above (or on) line `from`, skipping the live prompt the cursor is on. */
export function commandAbove(lines: readonly string[], from: number, cursorLine: number | null): RanCommand | null {
  for (let i = Math.min(from, lines.length - 1); i >= 0; i--) {
    const line = lines[i]!;
    const p = condensePrompt(line, lines[i + 1]);
    if (!p) continue;
    const last = i + p.consumed - 1;
    /* The prompt the cursor is on has not run what is typed there. */
    if (cursorLine !== null && cursorLine >= i && cursorLine <= last) continue;
    const parts = parsePromptLine(line);
    const typed = (parts?.rest !== undefined ? parts.rest : (lines[i + 1] ?? '').replace(/^\$ ?/, '')).trim();
    if (!typed) continue;
    const folder = parts?.path.replace(/\s+\([^()]*\)$/, '') || null;
    return { command: typed, folder };
  }
  return null;
}

/** A fence longer than any run of backticks inside the text, so the block cannot be closed early. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

export interface OutputAsk {
  selection: string;
  command: string | null;
  /** Folder shown by the prompt that ran the command. */
  folder: string | null;
  /** The folder the pane started the shell in. */
  startedIn: string | null;
}

export function askAboutOutputDraft(a: OutputAsk): string {
  const text = a.selection.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const fence = fenceFor(text);
  const lines = ['Here is some output from my terminal. What does it mean, and what should I do about it?', ''];
  if (a.command) lines.push(`Command: \`${a.command}\``);
  if (a.folder) lines.push(`Folder: ${a.folder}`);
  else if (a.startedIn) lines.push(`Folder: ${a.startedIn} (where this terminal started)`);
  if (a.command || a.folder || a.startedIn) lines.push('');
  lines.push(fence, text, fence);
  return lines.join('\n');
}
