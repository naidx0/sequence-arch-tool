/* ══════════════════════════════════════════════════════════════════════════
   ONE SENDER FOR "CONTINUES AT <RESET>" (T3 gap: usage-limit auto resume)
   packages/analyzer/src/server/autoResume.ts

   A turn that ended on a usage limit reruns by itself when the limit resets.
   The timer lives in the page, and a chat can be open in two windows, so the
   page asks here before it sends: the first asker for a chat and limit window
   (`resetsAt`) gets the claim, every other one is told no. A person who
   pressed Don't has declined that limit window, across windows and reloads;
   the next limit continues by itself again.

   State is one small file per chat, `.sequence/sessions/<id>/auto-resume.json`.
   READ, NEVER MINT: a chat that is not in the session index has no file.
   ══════════════════════════════════════════════════════════════════════════ */

import { readSessionIndex } from './sessionsStore.js';
import { readJson, writeJson } from './store.js';

interface AutoResumeFile {
  /** Limit windows (resetsAt) the person pressed Don't on. A later limit is a new window and continues again. */
  declined?: number[];
  /** Limit windows (resetsAt, epoch ms) already claimed; the newest few. */
  claimed?: number[];
}

const leaf = (chatId: string): string => `sessions/${chatId}/auto-resume.json`;

function read(root: string, chatId: string): { declined: number[]; claimed: number[] } {
  try {
    const v = readJson<{ declined?: unknown; claimed?: unknown }>(root, leaf(chatId));
    const nums = (x: unknown): number[] => (Array.isArray(x) ? x.filter((n): n is number => typeof n === 'number') : []);
    return { declined: nums(v?.declined), claimed: nums(v?.claimed) };
  } catch {
    return { declined: [], claimed: [] };
  }
}

const known = (root: string, chatId: string): boolean => !!readSessionIndex(root)?.sessions.some((s) => s.id === chatId);

/** True for exactly one caller per chat and limit window, and never for a window the person declined. */
export function claimAutoResume(root: string, chatId: string, resetsAt: number): boolean {
  if (!known(root, chatId) || !Number.isFinite(resetsAt)) return false;
  const st = read(root, chatId);
  if (st.declined.includes(resetsAt) || st.claimed.includes(resetsAt)) return false;
  writeJson(root, leaf(chatId), { declined: st.declined, claimed: [...st.claimed, resetsAt].slice(-8) });
  return true;
}

/** The person pressed Don't on this limit window: it is not rerun by any window. */
export function declineAutoResume(root: string, chatId: string, resetsAt: number): boolean {
  if (!known(root, chatId) || !Number.isFinite(resetsAt)) return false;
  const st = read(root, chatId);
  writeJson(root, leaf(chatId), { declined: [...st.declined.filter((n) => n !== resetsAt), resetsAt].slice(-8), claimed: st.claimed });
  return true;
}
