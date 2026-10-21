/**
 * Generative UI: `ui`, the agent's live surface in the chat (packages/genui).
 *
 *   ui({help:true})                              the catalog, the op format, the rules
 *   ui({surface:'s1', ops:'<JSONL>'})            apply ops; the surface draws as they land
 *   ui({surface:'s1', ops:'<JSONL>', done:true}) the pass is finished: validate it strictly
 *
 * Every call runs the same pipeline the renderer runs: lenient line parsing, op
 * normalising, the lossless fixer, then the validator. What the fixer could not
 * settle comes back as `isError` with numbered diagnostics, and the surface stays
 * where it was, so the agent's next call is a patch on top (the repair round the
 * user watches). Fixes are reported too, so the agent learns the catalog's names.
 *
 * Delivery: with SEQUENCE_GENUI_URL set (the app sets it), each accepted batch is
 * posted there as {surface, ops, done} and the app's session renders it live. The
 * renderer re-validates; this tool is the agent's early answer, not the guard.
 */

import { z } from 'zod';
import { postLocalJson } from '@sequence/analyzer';
import { SpecStream, autoFix, catalogPrompt, diagnosticsPrompt, validateSpec, type UIOp } from '@sequence/genui';
import type { ToolResult } from './boardTools.js';

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

export const uiShape = {
  surface: z.string().optional(),
  ops: z.string().optional(),
  done: z.boolean().optional(),
  help: z.boolean().optional(),
};
export const UI_DESCRIPTION =
  'Live card in the chat. Call ui({help:true}) once for the catalog. ops: JSONL; done:true checks it.';

export interface UIArgs {
  surface?: string;
  ops?: string;
  done?: boolean;
  help?: boolean;
  reset?: boolean;
}
export interface UIEnv {
  SEQUENCE_GENUI_URL?: string;
}

/** One stream per surface, for this server process (one agent session). */
const surfaces = new Map<string, SpecStream>();

export function resetUISurfaces(): void {
  surfaces.clear();
}

async function deliver(url: string | undefined, body: { surface: string; ops: UIOp[]; done: boolean }): Promise<void> {
  if (!url || (body.ops.length === 0 && !body.done)) return;
  try {
    const signal = AbortSignal.timeout(2000);
    const target = new URL(url);
    /* The app is on this machine: over node:http, because fetch (undici) refuses the Fetch spec's bad ports (4190, 6000, ...) before sending a byte. */
    if (target.protocol === 'http:' && (target.hostname === '127.0.0.1' || target.hostname === 'localhost') && target.port !== '') {
      await postLocalJson(Number(target.port), `${target.pathname}${target.search}`, {}, body, signal);
      return;
    }
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch {
    /* The app may be gone; the agent's answer does not depend on delivery. */
  }
}

export async function uiTool(a: UIArgs, env: UIEnv = process.env): Promise<ToolResult> {
  if (a.help || (!a.ops && !a.done && !a.reset)) return text(catalogPrompt());
  const id = a.surface?.trim() || 'main';
  if (a.reset) surfaces.delete(id);
  const stream = surfaces.get(id) ?? new SpecStream();
  surfaces.set(id, stream);
  const before = stream.spec;
  const pushed = stream.push((a.ops ?? '') + '\n');
  const ended = stream.end();
  const applied = [...pushed.applied, ...ended.applied];
  const parseIssues = [...pushed.issues, ...ended.issues];
  const fixed = autoFix(stream.spec, { phase: a.done ? 'final' : 'streaming' });
  stream.spec = fixed.spec;
  const fixes = [...pushed.fixes, ...ended.fixes, ...fixed.fixes];
  const v = validateSpec(stream.spec, a.done ? 'final' : 'streaming');
  const errors = [...parseIssues.filter((i) => i.severity === 'error'), ...v.issues.filter((i) => i.severity === 'error')];
  const fixNote = fixes.length ? `\nauto-fixed (use these names next time):\n${fixes.slice(0, 12).map((f) => `- ${f.message}`).join('\n')}` : '';
  const count = Object.keys(stream.spec.elements).length;
  if (errors.length && a.done) {
    /* A finished pass that is not valid is not shown as finished: the agent patches it. */
    await deliver(env.SEQUENCE_GENUI_URL, { surface: id, ops: applied, done: false });
    return text(diagnosticsPrompt(errors, id) + fixNote, true);
  }
  if (parseIssues.some((i) => i.severity === 'error') && applied.length === 0) {
    stream.spec = before;
    return text(diagnosticsPrompt(errors, id) + fixNote, true);
  }
  await deliver(env.SEQUENCE_GENUI_URL, { surface: id, ops: applied, done: a.done === true });
  /* Past the cap the extra ops were dropped, not queued: say so plainly, with what to do instead. */
  const capped = parseIssues.find((i) => i.code === 'LIMIT_EXCEEDED');
  const droppedNote = capped ? `\nDROPPED: ${capped.message}. ${capped.hint ?? ''}` : '';
  const warn = errors.length ? `\nstill open (fine while streaming, fix before done):\n${errors.slice(0, 8).map((i) => `- [${i.code}] ${i.path}: ${i.message}`).join('\n')}` : '';
  return text(`surface ${id}: ${applied.length} ops applied, ${count} elements${a.done ? ', valid and final' : ''}.${fixNote}${droppedNote}${warn}`);
}
