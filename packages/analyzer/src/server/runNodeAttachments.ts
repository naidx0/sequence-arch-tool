/* ══════════════════════════════════════════════════════════════════════════
   WHAT AN AGENT TURN CARRIES BESIDE ITS TEXT (S2a)
   packages/analyzer/src/server/runNodeAttachments.ts

   POST /api/acp/run-node `attachments`, each one resolved HERE, against what
   the server holds, never taken on the client's word:
     { kind: 'image', id }    a stored image (attachmentStore.ts), sent as
                              its file: an ACP image block, a codex localImage
     { kind: 'file', path }   a file of the turn's repository (or worktree),
                              sent as a resource_link with its absolute path;
                              a path outside it is refused
     { kind: 'text', id }     a stored text attachment, inline, named as the
                              user's
     { kind: 'node', nodeId } a node of the attached graph, sent as its map
                              slice (its paths and edges, the 1k
                              NODE_SLICE_BUDGET cut of map.md's grammar)
   acp's promptContent.ts decides how each one goes to the agent.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

import type { PromptAttachment } from '@sequence/acp';
import type { ArchGraph } from '@sequence/schema';

import { NODE_SLICE_BUDGET, renderAgentMap } from '../agentMap.js';
import { imageAttachmentFile, readAttachment, readAttachmentText } from './attachmentStore.js';

/** At most this many per turn. */
export const MAX_TURN_ATTACHMENTS = 10;

export function resolveRunNodeAttachments(
  raw: unknown,
  ctx: { repoRoot: string | null; turnRoot: string | null; graph: ArchGraph | null; chatId?: string | null },
): { attachments: PromptAttachment[] } | { error: string } {
  if (raw === undefined || raw === null) return { attachments: [] };
  if (!Array.isArray(raw)) return { error: '"attachments" must be an array' };
  if (raw.length > MAX_TURN_ATTACHMENTS) return { error: `at most ${MAX_TURN_ATTACHMENTS} attachments per turn` };
  const out: PromptAttachment[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    const kind = a?.kind;
    if (kind === 'image') {
      /* The chat's own image: it lives in that chat's folder (attachmentStore.ts). */
      const img = ctx.repoRoot && ctx.chatId && typeof a.id === 'string' ? imageAttachmentFile(ctx.repoRoot, ctx.chatId, a.id) : null;
      if (!img) return { error: `no stored image ${String(a.id)}` };
      out.push({ kind: 'image', path: img.path, mimeType: img.mimeType });
    } else if (kind === 'text') {
      /* A pasted log or dropped text file: inline, named as the user's (never as the repository's). */
      const rec = ctx.repoRoot && typeof a.id === 'string' ? readAttachment(ctx.repoRoot, a.id) : null;
      const text = rec && ctx.repoRoot ? readAttachmentText(ctx.repoRoot, rec.id) : null;
      if (!rec || text === null) return { error: `no stored attachment ${String(a.id)}` };
      out.push({ kind: 'context', name: rec.name, uri: `sequence://attachment/${rec.id}`, text: `[${rec.name}, supplied by the user; not read from this repository${rec.truncated ? '; cut short' : ''}]\n${text}` });
    } else if (kind === 'file') {
      if (!ctx.turnRoot || typeof a.path !== 'string' || a.path === '') return { error: 'a file attachment needs a path in the repository' };
      const abs = path.resolve(ctx.turnRoot, a.path);
      const rel = path.relative(ctx.turnRoot, abs);
      if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return { error: `${a.path} is not inside the repository` };
      if (!fs.existsSync(abs)) return { error: `${a.path} does not exist` };
      out.push({ kind: 'file', path: abs, name: rel.split(path.sep).join('/') });
    } else if (kind === 'node') {
      const node = typeof a.nodeId === 'string' ? ctx.graph?.nodes.find((n) => n.id === a.nodeId) : undefined;
      if (!node || !ctx.graph) return { error: `${String(a.nodeId)} is not a node of the attached repository's graph` };
      out.push({
        kind: 'context',
        name: node.label,
        uri: `sequence://map?focus=${encodeURIComponent(node.id)}&budget=${NODE_SLICE_BUDGET}`,
        text: renderAgentMap(ctx.graph, { budget: NODE_SLICE_BUDGET, focus: node.id }).trimEnd(),
      });
    } else {
      return { error: `unknown attachment kind ${JSON.stringify(kind)}` };
    }
  }
  return { attachments: out };
}
