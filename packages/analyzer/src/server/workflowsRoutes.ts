/* ══════════════════════════════════════════════════════════════════════════
   /api/workflows — the routes over the workflow store
   packages/analyzer/src/server/workflowsRoutes.ts

     GET    /api/workflows            every saved workflow, each with its compiled `program` and plain-words `notes`
     GET    /api/workflows?chat=<id>  that chat's workflow (at most one) as `workflows`, and `legacy`: the project's workflows no chat owns yet
     POST   /api/workflows            {name, from?: "fresh"|"empty", chatId?}  create; with chatId the chat's one workflow, made on first use (200 when it was there)
     POST   /api/workflows/:id/adopt  {chatId}  a legacy project workflow becomes that chat's (only when neither side is taken)
     GET    /api/workflows/:id        one workflow (+ program, notes, validator verdict); ?chat=<id> hides another chat's
     POST   /api/workflows/:id/ops    {ops:[add|update|move|remove|rename]}  edit (the same ops the MCP tool sends)
     DELETE /api/workflows/:id

   Running one is the existing `POST /api/program/run` with the compiled `program`;
   this route family stores and edits, it does not start anything.
   ══════════════════════════════════════════════════════════════════════════ */

import type http from 'node:http';

import { checkWorkflow, workflowNotes, type WorkflowDoc, type WorkflowOp } from '@sequence/schema';

import { WorkflowError, adoptWorkflow, applyWorkflowEdit, createWorkflow, deleteWorkflow, ensureChatWorkflow, listWorkflows, liveChatIds, readWorkflow, unownedWorkflows, workflowForChat } from '../workflows/workflowStore.js';

export interface WorkflowsRouteDeps {
  root: string | null;
  readBody: (req: http.IncomingMessage) => Promise<string>;
  sendJson: (res: http.ServerResponse, status: number, body: unknown) => void;
  sendError: (res: http.ServerResponse, status: number, message: string) => void;
}

/** A doc with what the page needs to draw and run it. */
export function describeWorkflow(doc: WorkflowDoc) {
  const c = checkWorkflow(doc);
  return { ...doc, program: c.program, valid: c.ok, errors: c.errors, notes: workflowNotes(doc) };
}

export async function handleWorkflowsRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  deps: WorkflowsRouteDeps,
): Promise<boolean> {
  if (pathname !== '/api/workflows' && !pathname.startsWith('/api/workflows/')) return false;
  const method = req.method ?? 'GET';
  const root = deps.root;
  if (root === null) {
    deps.sendError(res, 409, 'no project open — attach a repository or fix home permissions');
    return true;
  }
  const decoded: (string | null)[] = pathname.slice('/api/workflows'.length).split('/').filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return null;
      }
    });
  if (decoded.includes(null)) {
    deps.sendError(res, 400, 'the address is not valid');
    return true;
  }
  const rest = decoded as string[];
  const chatQuery = new URL(req.url ?? '/', 'http://localhost').searchParams.get('chat');
  const body = async (): Promise<Record<string, unknown>> => {
    const text = await deps.readBody(req);
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new WorkflowError('invalid JSON');
    }
  };
  try {
    if (rest.length === 0) {
      if (method === 'GET') {
        if (chatQuery === null) return void deps.sendJson(res, 200, { workflows: listWorkflows(root).map(describeWorkflow) }), true;
        const mine = workflowForChat(root, chatQuery);
        return void deps.sendJson(res, 200, { workflows: mine ? [describeWorkflow(mine)] : [], legacy: unownedWorkflows(root, liveChatIds(root)).map(describeWorkflow) }), true;
      }
      if (method === 'POST') {
        const b = await body();
        if (b.chatId !== undefined) {
          const r = ensureChatWorkflow(root, b.chatId, { name: b.name, from: b.from, live: liveChatIds(root) });
          return void deps.sendJson(res, r.created ? 201 : 200, describeWorkflow(r.doc)), true;
        }
        return void deps.sendJson(res, 201, describeWorkflow(createWorkflow(root, { name: b.name, from: b.from, live: liveChatIds(root) }))), true;
      }
    }
    const id = rest[0]!;
    if (rest.length === 1) {
      if (method === 'GET') {
        const doc = readWorkflow(root, id);
        if (!doc || (chatQuery !== null && doc.chatId !== undefined && doc.chatId !== chatQuery)) return void deps.sendError(res, 404, `no workflow "${id}"`), true;
        return void deps.sendJson(res, 200, describeWorkflow(doc)), true;
      }
      if (method === 'DELETE') {
        deleteWorkflow(root, id);
        return void deps.sendJson(res, 200, { ok: true }), true;
      }
    }
    if (rest.length === 2 && rest[1] === 'adopt' && method === 'POST') {
      const b = await body();
      return void deps.sendJson(res, 200, describeWorkflow(await adoptWorkflow(root, id, b.chatId, liveChatIds(root)))), true;
    }
    if (rest.length === 2 && rest[1] === 'ops' && method === 'POST') {
      const b = await body();
      const owner = readWorkflow(root, id)?.chatId;
      if (typeof b.chatId === 'string' && owner !== undefined && owner !== b.chatId) {
        return void deps.sendError(res, 403, 'that workflow belongs to another chat'), true;
      }
      return void deps.sendJson(res, 200, describeWorkflow(await applyWorkflowEdit(root, id, b.ops as WorkflowOp[], typeof b.expectedRev === 'number' ? b.expectedRev : undefined))), true;
    }
    deps.sendError(res, 405, 'method not allowed');
    return true;
  } catch (e) {
    if (e instanceof WorkflowError) {
      deps.sendError(res, e.status, e.message);
      return true;
    }
    throw e;
  }
}
