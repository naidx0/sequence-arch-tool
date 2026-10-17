/**
 * components: bundled skills that are not in the context until asked for. `search` lists what fits;
 * `load` returns one SKILL.md (paged with `offset`), or one file of the pack (`file`, e.g. a references/ page).
 * The listing is kept tiny (every session pays for it).
 *
 * `load` is the agent asking, not the person: when the app is reachable it decides by the person's
 * mode. approve (or a pack marked review): a card is raised and the body is withheld. auto: the body.
 */
import { z } from 'zod';
import { MAX_COMPONENT_BODY_CHARS, componentBlock, loadMergedCatalog, matchComponents, postLocalJson, readComponentBody, readComponentFile, readComponentPreamble } from '@sequence/analyzer';

export const COMPONENTS_DESCRIPTION = 'Optional skill packs. search finds one; load returns it (offset pages it, file reads one of its files).';

/* Kept bare on purpose: every session pays for this listing. The handler checks the values. */
export const componentsShape = {
  op: z.enum(['search', 'load']),
  query: z.string().optional(),
  id: z.string().optional(),
  offset: z.number().optional(),
  file: z.string().optional(),
};

type Out = { content: { type: 'text'; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): Out => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

type Args = { op: 'search' | 'load'; query?: string; id?: string; offset?: number; file?: string };

/** A page of `s` from `offset`, with a line saying where the next one starts. */
function page(s: string, offset: number): string {
  if (offset >= s.length) return `(nothing at offset ${offset}; this is ${s.length} characters long)`;
  const end = Math.min(s.length, offset + MAX_COMPONENT_BODY_CHARS);
  return `${s.slice(offset, end)}${end < s.length ? `\n\n[${s.length - end} more characters: call load again with offset ${end}.]` : ''}`;
}

/** Ask the app whether this load may proceed. null: no app to ask (a standalone install). */
async function ask(id: string, env: NodeJS.ProcessEnv): Promise<{ decision: string; message?: string; url?: string } | 'unreachable' | null> {
  const url = env.SEQUENCE_COMPONENTS_URL?.trim();
  if (!url) return null;
  try {
    const body = { key: env.SEQUENCE_COMPONENTS_KEY ?? '', componentId: id };
    const signal = AbortSignal.timeout(5000);
    /* The app is on this machine: over node:http, because fetch (undici) refuses the Fetch spec's bad ports (4190, 6000,
       ...) before sending a byte, and that read as "the app cannot be reached" for an app started on one of them. */
    const target = new URL(url);
    if (target.protocol === 'http:' && (target.hostname === '127.0.0.1' || target.hostname === 'localhost') && target.port !== '') {
      const r = await postLocalJson(Number(target.port), `${target.pathname.replace(/\/+$/, '')}/api/components/request`, {}, body, signal);
      return r.status >= 200 && r.status < 300 ? (r.json as { decision: string; message?: string; url?: string }) : 'unreachable';
    }
    const r = await fetch(`${url}/api/components/request`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!r.ok) return 'unreachable';
    return (await r.json()) as { decision: string; message?: string; url?: string };
  } catch {
    return 'unreachable';
  }
}

export async function componentsTool(a: Args, sessionRepo?: string, env: NodeJS.ProcessEnv = process.env): Promise<Out> {
  try {
    const catalog = loadMergedCatalog(sessionRepo ?? null);
    if (a.op === 'search') {
      const q = (a.query ?? '').trim().slice(0, 300);
      if (!q) return text('search needs a query', true);
      const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const byTrigger = matchComponents(q, catalog, { max: 5 }).map((m) => m.id);
      const byWords = catalog.components.filter((c) => !byTrigger.includes(c.id) && words.some((w) => `${c.label} ${c.summary}`.toLowerCase().includes(w))).map((c) => c.id);
      const ids = [...byTrigger, ...byWords.sort()].slice(0, 5);
      if (ids.length === 0) return text('No component fits.');
      return text(ids.map((id) => { const c = catalog.components.find((x) => x.id === id)!; return `${c.id} [${c.status}]: ${c.summary}`; }).join('\n'));
    }
    const c = catalog.components.find((x) => x.id === a.id);
    if (!c) return text(`No component ${String(a.id ?? '').slice(0, 120)}. Use search.`, true);
    const offset = Number.isInteger(a.offset) && a.offset! > 0 ? a.offset! : 0;
    if (c.status === 'link-only') return text(`${c.label} is a link, not a loadable pack: ${c.url ?? ''}`);
    const needsApproval = `${c.label} needs the person's approval before it is used. A card asks them; if they accept, it loads with their next message. Do not try again now.`;
    const verdict = await ask(c.id, env);
    if (verdict === 'unreachable') return text(needsApproval);
    if (verdict && verdict.decision !== 'load') {
      if (verdict.decision === 'refused') return text(verdict.message ?? 'Components are not available right now.');
      return text(verdict.decision === 'link' ? `${c.label} is a link, not a loadable pack: ${verdict.url ?? c.url ?? ''}` : needsApproval);
    }
    /* A Sequence session with no app address to ask (a launch that could not pass one): only auto may load, as the person set it. */
    if (!verdict && env.SEQUENCE_COMPONENTS_MODE && env.SEQUENCE_COMPONENTS_MODE !== 'auto') return text(needsApproval);
    /* No app to ask (standalone): a pack marked review still never loads on the model's say-so. */
    if (!verdict && c.status === 'review') return text(`${c.label} needs the person's approval before it is used. Ask them to accept it in the chat or run /components ${c.id}.`);
    if (a.file) {
      const f = readComponentFile(c, a.file);
      return f === null ? text(`No file ${a.file} inside ${c.id}.`, true) : text(page(f, offset));
    }
    if (offset) {
      const body = readComponentBody(c);
      return body === null ? text(`${c.id} has no readable body.`, true) : text(page(body, offset));
    }
    const block = componentBlock(c);
    if (!block) return text(`${c.id} has no readable body${c.preamble && !readComponentPreamble(c) ? ' (its preamble is unreadable, so it is not loaded)' : ''}.`, true);
    return text(block);
  } catch (e) {
    return text(`components failed: ${(e as Error).message}`, true);
  }
}
