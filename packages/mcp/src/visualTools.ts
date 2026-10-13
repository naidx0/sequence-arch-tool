/**
 * Lane components: `visual`, the agent's ready kit of charts and diagrams.
 *
 *   visual({list:true})                      the components, one line each
 *   visual({help:'line'})                    one component's spec shape and an example
 *   visual({component:'line', spec:{...}})   validate, draw, save as a drawing, return its id
 *   visual({id:'d5', component, spec})       a new version of d5 (same drawing, redrawn)
 *
 * The drawing is saved in the drawings store (versions by id), in the project the app
 * serves: SEQUENCE_DRAWINGS_ROOT (the app's repository, set by the app even when the
 * session runs in a chat worktree), else the session's repository. To put it in the
 * chat the agent writes a fenced block ```visual {"id":"d5"}``` (a few tokens).
 */

import path from 'node:path';
import { z } from 'zod';
import { saveDrawing, DrawingError, BoardError, applyBoardOps, boardBounds, findBoard, linkedWorktreeBase, listBoards, readBoard } from '@sequence/analyzer';
import { SpecError, findComponent, helpVisual, listVisuals, renderVisual } from '@sequence/schema/dist/visual/index.js';
import type { ToolResult } from './boardTools.js';

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

export const visualShape = {
  repoPath: z.string(),
  component: z.string().optional(),
  spec: z.record(z.string(), z.unknown()).optional(),
  title: z.string().optional(),
  id: z.string().optional(),
  list: z.boolean().optional(),
  help: z.string().optional(),
  board: z.string().optional(),
};
export const VISUAL_DESCRIPTION = 'Chart or diagram from numbers: {component, spec}. list:true names components, help:"line" shows a spec. Returns a drawing id. Uses the app theme.';

export interface VisualArgs {
  repoPath: string;
  component?: string;
  spec?: Record<string, unknown>;
  title?: string;
  id?: string;
  list?: boolean;
  help?: string;
  /** Also place the drawing on this Space (board id or name). */
  board?: string;
}

export interface VisualEnv {
  SEQUENCE_DRAWINGS_ROOT?: string;
  SEQUENCE_CHAT?: string;
  /** The drawing ids this turn's message referenced (@drawing:d3), comma separated; set by the app, never by the agent. */
  SEQUENCE_REFERENCED?: string;
}

/** The text a `visual({list:true})` call returns: one line per component. */
export const visualListText = (): string => listVisuals().map((c) => `${c.id}: ${c.blurb}`).join('\n') + '\nvisual({help:"<id>"}) gives the spec; visual({component, spec, title?, id?}) draws and saves it.';

/** The drawing as an svg item in its own group on a Space, beside what is there; a new version replaces it in place. */
function placeOnBoard(ref: string, root: string, drawingId: string, drawn: { svg: string; width: number; height: number; title: string }): { board: string; group: string } | { error: string } {
  try {
    const base = linkedWorktreeBase(root) ?? root;
    const meta = findBoard(listBoards(base), ref);
    if (!meta) return { error: `no board "${ref}"; list_boards names them` };
    const group = `visual-${drawingId}`;
    const items = readBoard(base, meta.id)?.items ?? [];
    const prev = items.find((i) => i.id === group);
    const b = boardBounds(items.filter((i) => i.id !== group));
    const w = Math.min(20000, Math.max(8, Math.round(drawn.width)));
    const h = Math.min(20000, Math.max(8, Math.round(drawn.height)));
    const at = prev && prev.kind === 'svg' ? prev.at : { x: b ? b.maxX + 80 : 0, y: b ? b.minY : 0 };
    applyBoardOps(base, meta.id, [{ op: 'put', item: { kind: 'svg', id: group, group, by: 'agent', at, w, h, svg: drawn.svg, label: drawn.title } }]);
    return { board: meta.id, group };
  } catch (e) {
    return { error: e instanceof BoardError ? e.message : (e as Error).message };
  }
}

export function visualTool(a: VisualArgs, env: VisualEnv = process.env): ToolResult {
  if (a.list) return text(visualListText());
  if (a.help !== undefined) {
    const known = findComponent(a.help);
    return text(known ? helpVisual(a.help) : `no component "${a.help}". visual({list:true}) names them.`, !known);
  }
  if (!a.component) return text('visual needs component and spec (or list:true, or help:"<component>"). visual({list:true}) names the components.', true);
  if (a.spec === undefined) return text(`visual ${a.component} needs a spec: visual({help:"${a.component}"}) shows its shape.`, true);
  let drawn;
  try {
    drawn = renderVisual(a.component, a.spec, { title: a.title });
  } catch (e) {
    if (e instanceof SpecError) return text(`${e.message}. visual({help:"${findComponent(a.component)?.id ?? 'line'}"}) shows the shape.`, true);
    throw e;
  }
  const id = a.id?.replace(/^@drawing:/, '');
  const root = path.resolve(env.SEQUENCE_DRAWINGS_ROOT || a.repoPath);
  try {
    const r = saveDrawing(root, { chat: env.SEQUENCE_CHAT || 'agent', turn: 'agent', kind: 'svg', source: drawn.svg, title: drawn.title, ...(id ? { id, referenced: (env.SEQUENCE_REFERENCED ?? '').split(',').includes(id) } : {}) });
    const d = r.drawing;
    let space = '';
    if (a.board) {
      const placed = placeOnBoard(a.board, root, d.id, drawn);
      if ('error' in placed) return text(`${d.id} v${r.version} saved, but not placed on the Space: ${placed.error}`, true);
      space = `\nOn Space {"board":"${placed.board}","group":"${placed.group}"}. inline preview: /api/boards/${encodeURIComponent(placed.board)}/render.svg?group=${encodeURIComponent(placed.group)}; open on surface: board ${placed.board}`;
    }
    return text(`${d.id} v${r.version} "${d.title}" saved (${drawn.component}, ${drawn.width}x${drawn.height}). ${drawn.summary}. To show it in the chat write this block:\n\`\`\`visual\n{"id":"${d.id}"}\n\`\`\`${space}`);
  } catch (e) {
    if (e instanceof DrawingError) return text(`drawing not saved: ${e.message}`, true);
    throw e;
  }
}
