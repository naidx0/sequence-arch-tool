/**
 * Lane visual (v2): the agent's view of the drawings it showed in the chat.
 * `drawings` (no id) names them (id, title, chat, kind, versions); `read_drawing`
 * returns the source, so a later turn can reference one ("@drawing:d3") or
 * redraw it: a fenced block whose info string is `svg id=d3` saves as a new
 * version of d3 instead of a new drawing. Same files as the app's /api/drawings.
 */

import path from 'node:path';
import { z } from 'zod';
import { drawingFileName, listDrawings, readDrawing } from '@sequence/analyzer';
import type { ToolResult } from './boardTools.js';

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

export const listDrawingsShape = {
  repoPath: z.string(),
  chat: z.string().optional(),
};
export const readDrawingShape = {
  repoPath: z.string(),
  id: z.string(),
  version: z.number().int().optional(),
};

export const drawingsShape = { repoPath: z.string(), id: z.string().optional(), version: z.number().int().optional() };
export const DRAWINGS_DESCRIPTION = 'Drawings shown in chat: list, or read one by id (@drawing:d3).';

/** One small tool: no `id` lists, an `id` reads. */
export function drawingsTool(a: { repoPath: string; id?: string; version?: number }): ToolResult {
  return a.id ? readDrawingTool({ repoPath: a.repoPath, id: a.id, version: a.version }) : listDrawingsTool({ repoPath: a.repoPath });
}

export function listDrawingsTool(a: { repoPath: string; chat?: string }): ToolResult {
  const rows = listDrawings(path.resolve(a.repoPath), { chat: a.chat }).map((d) => ({ id: d.id, title: d.title, chat: d.chat, turn: d.turn, kind: d.kind, created: d.created, versions: d.versions.length, name: drawingFileName(d) }));
  return text(JSON.stringify({ drawings: rows }));
}

export function readDrawingTool(a: { repoPath: string; id: string; version?: number }): ToolResult {
  const got = readDrawing(path.resolve(a.repoPath), a.id.replace(/^@drawing:/, ''), a.version);
  if (!got) return text(`no drawing "${a.id}" (the drawings tool without an id lists them)`, true);
  return text(JSON.stringify({ id: got.drawing.id, title: got.drawing.title, kind: got.drawing.kind, version: got.version.v, versions: got.drawing.versions.length, source: got.source }));
}
