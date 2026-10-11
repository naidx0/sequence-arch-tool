/**
 * Round 13 (A8) — THE AGENT'S HAND ON THE WORKFLOW GRAPH. One tool, `edit_workflow`:
 * with nothing but a repo it lists the project's saved workflows and their blocks;
 * with `create` it starts a new one from the ready-made blocks; with `workflow` and
 * `ops` it adds, updates, moves or removes blocks.
 *
 * It writes through `@sequence/analyzer`'s workflow store, the same files the app's
 * `/api/workflows` routes write, so the open Workflows editor sees the change on its
 * next poll with no reload. Every refusal is a sentence that names the op to fix, and
 * a refused call changes nothing. Running a workflow stays a person's click.
 *
 * ONE WORKFLOW PER CHAT (round 16): with a chat (SEQUENCE_CHAT_ID or SEQUENCE_CHAT in the server's environment; not a model-facing
 * argument, so the core listing stays inside its token budget) the tool
 * works on that chat's workflow only: ops with no `workflow` edit it (made from the ready-made blocks on first use), `create`
 * returns it if it exists, a listing shows just it. Another chat's workflow is not found, by id or by name. The chat agent's
 * server already carries its chat as SEQUENCE_CHAT (the same one the visual tool saves drawings under), so it needs no argument.
 */

import path from 'node:path';
import { z } from 'zod';
import { WorkflowError, applyWorkflowEdit, createWorkflow, ensureChatWorkflow, findWorkflow, linkedWorktreeBase, listWorkflows, liveChatIds, unownedWorkflows, workflowForChat } from '@sequence/analyzer';
import { BLOCK_KINDS, TEST_COMMANDS, checkWorkflow, workflowNotes, type WorkflowDoc, type WorkflowOp } from '@sequence/schema';
import type { ToolResult } from './boardTools.js';

const okJson = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

/** Workflows belong to the project the app shows: a linked worktree edits its base's workflows. */
function workflowsRoot(repoPath: string): string {
  const root = path.resolve(repoPath);
  return linkedWorktreeBase(root) ?? root;
}

const opShape = z
  .object({ op: z.enum(['add', 'update', 'move', 'remove', 'rename']) })
  .passthrough();

export const editWorkflowShape = {
  repoPath: z.string().describe('Path to the repo.'),
  workflow: z.string().optional().describe('Workflow id or name. Omit (with no `create`) to list them.'),
  create: z.string().max(80).optional().describe('Create a workflow with this name.'),
  ops: z
    .array(opShape)
    .min(1)
    .max(50)
    .optional()
    .describe(
      'All-or-nothing. add {kind, at|afterId, title, prompt, intent, agentRef, model, command, maxIterations, span}; update {id, fields}; ' +
        `move {id, to}; remove {id}; rename {name}. command: ${TEST_COMMANDS.join(' | ')}.`,
    ),
};

export const EDIT_WORKFLOW_DESCRIPTION =
  'List, create or edit the saved agent workflows the user sees live (Agents, Workflows): an ordered list of blocks ' +
  `(${BLOCK_KINDS.join(', ')}). repoPath alone lists; create starts one; workflow + ops edits. Agent blocks take agentRef and model. Never runs one.`;

function view(doc: WorkflowDoc) {
  const c = checkWorkflow(doc);
  return { id: doc.id, name: doc.name, rev: doc.rev, blocks: doc.blocks, valid: c.ok, errors: c.errors, notes: workflowNotes(doc) };
}

export async function editWorkflowTool(a: { repoPath: string; workflow?: string; create?: string; chatId?: string; ops?: WorkflowOp[] }): Promise<ToolResult> {
  try {
    const root = workflowsRoot(a.repoPath);
    const chat = (a.chatId ?? process.env.SEQUENCE_CHAT_ID ?? process.env.SEQUENCE_CHAT ?? '').trim() || undefined;
    const live = chat !== undefined ? liveChatIds(root) : undefined;
    if (chat !== undefined) {
      if (a.create !== undefined) {
        const r = ensureChatWorkflow(root, chat, { name: a.create, live });
        return okJson(r.created ? { created: view(r.doc) } : { existing: view(r.doc), note: 'this chat already has its one workflow; edit it with ops' });
      }
      if (a.workflow === undefined) {
        if (!a.ops) {
          const mine = workflowForChat(root, chat);
          return okJson({ workflows: mine ? [view(mine)] : [], legacy: unownedWorkflows(root, live).map((d) => ({ id: d.id, name: d.name })) });
        }
        return await applyTo(root, ensureChatWorkflow(root, chat, { live }).doc, a.ops);
      }
    }
    if (a.create !== undefined) {
      const doc = createWorkflow(root, { name: a.create });
      return okJson({ created: view(doc) });
    }
    if (a.workflow === undefined) {
      if (a.ops) return fail('edit_workflow: say which workflow to edit (id or name); omit ops to list them.');
      return okJson({ workflows: listWorkflows(root).map(view) });
    }
    const found = findWorkflow(root, a.workflow, { ...(chat !== undefined ? { chatId: chat } : {}), ...(live ? { live } : {}) });
    if (!found) return fail(`no workflow "${a.workflow}". Call edit_workflow with only repoPath to list them, or pass create to make one.`);
    if (!a.ops) return okJson({ workflow: view(found) });
    return await applyTo(root, found, a.ops);
  } catch (e) {
    return fail(e instanceof WorkflowError ? e.message : `edit_workflow failed: ${(e as Error).message}`);
  }
}

async function applyTo(root: string, found: WorkflowDoc, ops: WorkflowOp[]): Promise<ToolResult> {
  try {
    /* Compare-and-swap on the revision just read; if a person or another agent got in first, read again and retry. */
    let cur: WorkflowDoc = found;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return okJson({ workflow: view(await applyWorkflowEdit(root, cur.id, ops, cur.rev)) });
      } catch (e) {
        if (!(e instanceof WorkflowError) || e.status !== 409 || attempt >= 8) throw e;
        cur = findWorkflow(root, cur.id) ?? cur;
      }
    }
  } catch (e) {
    return fail(e instanceof WorkflowError ? e.message : `edit_workflow failed: ${(e as Error).message}`);
  }
}
