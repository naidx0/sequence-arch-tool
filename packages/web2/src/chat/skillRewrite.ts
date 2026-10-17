/**
 * "Rewrite with be-ambitious": the composer action that runs a skill on the current draft and hands the rewritten
 * prompt back for editing. It never sends it. The server does the model call (`POST /api/skills/<slug>/run`) on the
 * chat's agent, or on the configured model for a plain chat, and answers with the skill's fenced block.
 */
import { extractFencedPrompt } from '@sequence/schema';

export const REWRITE_SKILL = 'be-ambitious';
export const REWRITE_LABEL = 'Rewrite with be-ambitious';

export type RewriteResult = { ok: true; prompt: string } | { ok: false; message: string };

export interface RewriteOptions {
  /** The chat's agent (its ACP id), or absent for a plain chat. */
  agentId?: string;
  /** The model that agent should use, when the chat names one. */
  model?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Ask the server to run the skill on `draft`. Total: a refusal, a network failure and an answer with nothing to
 * put in the input are each one plain sentence, never a thrown error. When the server's answer carries only text,
 * the fenced block is taken from it here as well, so a server that returns the raw answer still works.
 */
export async function rewriteWithSkill(draft: string, opts: RewriteOptions = {}): Promise<RewriteResult> {
  const input = draft.trim();
  if (input === '') return { ok: false, message: 'Write the prompt first, then rewrite it.' };
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`/api/skills/${encodeURIComponent(REWRITE_SKILL)}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ input, ...(opts.agentId ? { agentId: opts.agentId } : {}), ...(opts.model ? { model: opts.model } : {}) }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const body = (await res.json().catch(() => null)) as { prompt?: unknown; text?: unknown; error?: unknown } | null;
    if (!res.ok) {
      const why = typeof body?.error === 'string' && body.error !== '' ? body.error : `the server answered ${res.status}`;
      return { ok: false, message: `Could not rewrite the prompt: ${why}` };
    }
    const prompt = typeof body?.prompt === 'string' && body.prompt.trim() !== '' ? body.prompt.trim() : typeof body?.text === 'string' ? extractFencedPrompt(body.text) : null;
    if (!prompt) return { ok: false, message: 'The model answered without a rewritten prompt, so your draft is unchanged.' };
    return { ok: true, prompt };
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') return { ok: false, message: 'Stopped. Your draft is unchanged.' };
    return { ok: false, message: `Could not rewrite the prompt: ${e instanceof Error ? e.message : String(e)}` };
  }
}
