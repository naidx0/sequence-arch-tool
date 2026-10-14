import type { WorkflowAudience } from './nodeSurface';

/* POST /api/services/:id/flows { audience }: the engine draws a grounded
   page-to-page flow for one service onto a Space (a whiteboard). A 404 means
   this engine does not have the route, and the caller falls back to asking the
   agent in chat. */

export type FlowResult =
  | { outcome: 'ok'; boardId: string; name: string | null; group: string | null }
  | { outcome: 'missing' }
  | { outcome: 'failed'; message: string };

export async function generateFlow(
  serviceId: string,
  audience: WorkflowAudience,
  fetchImpl: typeof fetch = (i, n) => fetch(i, n),
): Promise<FlowResult> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/services/${encodeURIComponent(serviceId)}/flows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audience }),
    });
  } catch (error) {
    return { outcome: 'failed', message: (error as Error).message || 'the engine did not answer' };
  }
  if (response.status === 404) return { outcome: 'missing' };
  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const text = typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : `HTTP ${response.status}`;
    return { outcome: 'failed', message: text };
  }
  /* The answer is { board, group, steps, grounded, notes }. Nothing is "drawn"
     unless it names the Space it drew on. */
  const board = body?.board;
  const boardId =
    typeof board === 'string' && board !== ''
      ? board
      : board && typeof board === 'object' && typeof (board as { id?: unknown }).id === 'string' && (board as { id: string }).id !== ''
        ? (board as { id: string }).id
        : null;
  if (boardId === null) return { outcome: 'failed', message: 'The engine answered without saying which board it drew on.' };
  const name = board && typeof board === 'object' && typeof (board as { name?: unknown }).name === 'string' ? (board as { name: string }).name : null;
  const group = typeof body?.group === 'string' && body.group !== '' ? body.group : null;
  return { outcome: 'ok', boardId, name: name || null, group };
}
