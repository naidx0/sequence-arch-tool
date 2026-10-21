/** The shape of GET /api/memory/summary (analyzer server/memorySummary.ts) and the words Settings > Memory says from it. */
export interface MemorySummary {
  notes: number;
  notesPath: string;
  findFilesLabels: number;
  findFilesModel: 'frozen' | 'repo';
  agentThreads: number;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** What persists across chats, with live counts, and what a new session does and does not clear. */
export function memoryDetail(m: MemorySummary): string {
  const finder = m.findFilesModel === 'repo' ? 'its ranker is trained on this repo' : 'it still uses the shipped ranker';
  return (
    `This session’s transcript is on disk; a new session starts a fresh one. A new session does not clear what persists across chats: ` +
    `${plural(m.notes, 'repo note', 'repo notes')} in ${m.notesPath} (delete a line to remove one), ` +
    `the file finder’s learning (${plural(m.findFilesLabels, 'labelled query', 'labelled queries')}; ${finder}), ` +
    `and ${plural(m.agentThreads, 'Claude or Codex conversation', 'Claude and Codex conversations')} your chats can resume.`
  );
}
