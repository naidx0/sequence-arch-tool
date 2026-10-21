/* ══════════════════════════════════════════════════════════════════════════
   SAVED SURFACES: the client of /api/genui/surfaces
   packages/web2/src/genui/surfaceStore.ts

   A card the agent drew is kept with its chat when it settles: the FINAL spec, keyed by chat, turn and surface
   (server: analyzer genuiStore.ts). Reloading the chat reads them back and draws each once, with no entry
   animation and with its buttons off (`restoredView`, session.ts; `GenUISavedSurface`).

   For other panels (the overview's "saved artifacts"):

     const saved = await listChatSurfaces(chatId);   // SavedSurface[], oldest first; [] when none or on any error
     saved[i].title      the card's own title, for a list row
     saved[i].turn       the turn that drew it (open that turn in the transcript)
     saved[i].spec       the final spec; render it with <GenUISavedSurface saved={saved[i]} />

   For the chat that hosts a live session: `new GenUISession(agent, { onSettled: persistSettled(chatId, turnId) })`.
   Both functions swallow failures on purpose: saving is a convenience, and a card that did not save is still on screen.
   ══════════════════════════════════════════════════════════════════════════ */
import type { UISpec } from '@sequence/genui';

export interface SavedSurface {
  chat: string;
  turn: string;
  surface: string;
  /** When it was saved (ms since the epoch). */
  saved: number;
  title: string;
  spec: UISpec;
}

/** The server keeps `[a-z0-9-]{1,40}` chat ids (the same as drawings); anything else has no saved surfaces. */
const CHAT_RE = /^[a-z0-9-]{1,40}$/;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function listChatSurfaces(chatId: string, f: Fetcher = (u, i) => fetch(u, i)): Promise<SavedSurface[]> {
  if (!CHAT_RE.test(chatId)) return [];
  try {
    const r = await f(`/api/genui/surfaces?chat=${encodeURIComponent(chatId)}`);
    if (!r.ok) return [];
    const j = (await r.json()) as { surfaces?: SavedSurface[] };
    return Array.isArray(j.surfaces) ? j.surfaces : [];
  } catch {
    return [];
  }
}

/** Keep the final spec of one surface. Resolves true when the server stored it. */
export async function saveChatSurface(chatId: string, turn: string, surface: string, spec: UISpec, f: Fetcher = (u, i) => fetch(u, i)): Promise<boolean> {
  if (!CHAT_RE.test(chatId)) return false;
  try {
    const r = await f('/api/genui/surfaces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: chatId, turn, surface, spec }) });
    return r.ok;
  } catch {
    return false;
  }
}

/** The `onSettled` for a GenUISession that belongs to one turn of one chat. */
export function persistSettled(chatId: string, turnId: string, f?: Fetcher): (surfaceId: string, spec: UISpec) => void {
  return (surfaceId, spec) => void saveChatSurface(chatId, turnId, surfaceId, spec, f);
}
