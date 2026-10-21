/* What persists across chats, counted live for Settings > Memory (GET /api/memory/summary). Read-only. */
import fs from 'node:fs';
import path from 'node:path';

import { findFilesModelBaseId } from '../explain/findFilesLearn.js';
import { NOTES_REL } from '../harness/refineNotes.js';
import { readSessionIndex } from './sessionsStore.js';

export interface MemorySummary {
  /** Accepted repo notes in `.sequence/memory/NOTES.md`: sent to Claude and Codex threads, and to the built-in model. */
  notes: number;
  notesPath: string;
  /** Answered file-finder queries that got a label, kept in `.sequence/findfiles/labels.jsonl`. */
  findFilesLabels: number;
  /** The ranker the finder uses here: the shipped one, or that plus trees trained on this repo's labels. */
  findFilesModel: 'frozen' | 'repo';
  /** Claude and Codex conversations this workspace can resume, over all its chats. */
  agentThreads: number;
}

function countJsonl(file: string): number {
  let n = 0;
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        JSON.parse(line);
        n += 1;
      } catch {
        /* a torn last line is not a label */
      }
    }
  } catch {
    return 0;
  }
  return n;
}

const notesCache = new Map<string, { mtimeMs: number; size: number; n: number }>();

/** Top-level bullet lines of NOTES.md (what readNotes keeps as notes), counted in 64 KB chunks and cached by mtime and size, so a huge file is never one string. */
function countNotes(file: string): number {
  let fd: number | null = null;
  try {
    const st = fs.statSync(file);
    const hit = notesCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.n;
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    let n = 0;
    let carry = '';
    for (;;) {
      const got = fs.readSync(fd, buf, 0, buf.length, null);
      if (got === 0) break;
      const lines = (carry + buf.toString('utf8', 0, got)).split('\n');
      carry = lines.pop() ?? '';
      for (const l of lines) if (/^[-*]\s+\S/.test(l)) n += 1;
      if (carry.length > 1_000_000) carry = '';
    }
    if (/^[-*]\s+\S/.test(carry)) n += 1;
    notesCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, n });
    return n;
  } catch {
    return 0;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function repoModelKind(file: string): 'frozen' | 'repo' {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { v?: unknown; base?: unknown; trees?: unknown };
    return j.v === 1 && j.base === findFilesModelBaseId() && Array.isArray(j.trees) && j.trees.length > 0 ? 'repo' : 'frozen';
  } catch {
    return 'frozen';
  }
}

export function memorySummary(root: string): MemorySummary {
  const dir = path.join(root, '.sequence', 'findfiles');
  const sessions = readSessionIndex(root)?.sessions ?? [];
  return {
    notes: countNotes(path.join(root, NOTES_REL)),
    notesPath: NOTES_REL,
    findFilesLabels: countJsonl(path.join(dir, 'labels.jsonl')),
    findFilesModel: repoModelKind(path.join(dir, 'model.json')),
    agentThreads: sessions.reduce((n, s) => n + Object.keys(s.agentThreads ?? {}).length, 0),
  };
}
