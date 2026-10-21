/* The page's side of usage-limit auto resume: ask the server before sending (one sender per chat and
   limit window, across windows), and tell it when the person pressed Don't. See analyzer autoResume.ts. */

import type { Fetch } from './runNodeStream';

const post = async (body: unknown, f: Fetch): Promise<Record<string, unknown> | null> => {
  try {
    const r = await f('/api/acp/auto-resume', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** True only when this page is the one that should send. Any doubt (offline, refused) is no. */
export async function claimAutoResume(chatId: string, resetsAt: number, f: Fetch = (u, i) => fetch(u, i)): Promise<boolean> {
  return (await post({ chatId, resetsAt }, f))?.claimed === true;
}

export async function declineAutoResume(chatId: string, resetsAt: number, f: Fetch = (u, i) => fetch(u, i)): Promise<void> {
  await post({ chatId, resetsAt, decline: true }, f);
}
