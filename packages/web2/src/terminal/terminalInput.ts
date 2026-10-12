/* ══════════════════════════════════════════════════════════════════════════
   A LINE FOR THE TERMINAL TO RUN, FROM ELSEWHERE IN THE PAGE (S2b)
   packages/web2/src/terminal/terminalInput.ts

   "Start Claude Code with hooks" (agents/AgentsPanel.tsx) writes the hook
   settings and hands the command here; the Terminal tab's live pane types
   it, so nothing has to be copied by hand. A line queued while no terminal
   is live waits for the next one that connects.
   ══════════════════════════════════════════════════════════════════════════ */

type Sink = (line: string) => void;

let pending: string[] = [];
const sinks = new Set<Sink>();

/** Run `line` in the Terminal (typed, then Enter). */
export function queueTerminalInput(line: string): void {
  const sink = [...sinks].at(-1);
  if (sink) sink(line);
  else pending.push(line);
}

/** A live terminal takes lines; it is handed what waited for it. Returns the release. */
export function takeTerminalInput(sink: Sink): () => void {
  sinks.add(sink);
  const waiting = pending;
  pending = [];
  for (const line of waiting) sink(line);
  return () => {
    sinks.delete(sink);
  };
}
