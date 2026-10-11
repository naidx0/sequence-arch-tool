import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BLOCK_KINDS, applyWorkflowOps, checkWorkflow, freshWorkflowBlocks, workflowNotes, type WorkflowDoc, type WorkflowOp } from '@sequence/schema';

import { BlockGlyph, WorkflowEditor } from './WorkflowEditor';
import { createWorkflowApi, type WorkflowApi, type WorkflowView } from './workflowClient';

afterEach(cleanup);

/* ROUND 16 (G8): the workflow editor walkthrough fixes. CSS rules are read from the real files (jsdom has no layout);
   the layout itself was measured in a browser at 1440x900. */
const css = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');

describe('G8 item 1: the editor opens at a comfortable width (superseded by 0.1.6 C5: 480px start pop-up, 1280px editor, see workflowEditorC5.test.tsx)', () => {
  it('.wfe is capped by its container and never four menu widths (1280)', () => {
    const rule = /\.wfe \{[^}]*\}/.exec(css('workflowEditor.css'))![0];
    expect(/width: min\((\d+)px, 100%\);/.exec(rule), rule).not.toBeNull();
    expect(rule).not.toMatch(/--menu-w/);
  });
});

describe('G8 item 6: no circle inside a circle in the block glyphs', () => {
  /* The palette chips are pills and the rows sit on rounded tiles, so a glyph that is itself a circle (the Checker's
     circled tick) or a hexagon with a circle inside it (the Agent's) read as a double ring. */
  it.each([...BLOCK_KINDS])('the %s glyph draws no <circle>', (kind) => {
    const { container } = render(<BlockGlyph kind={kind} />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });
});

describe('G8 item 5: graph nodes are glass, not an opaque card', () => {
  it('.ac-gnode takes the glass control fill and edge, and no opaque surface token', () => {
    const rule = /\.ac-scope \.ac-gnode \{[^}]*\}/.exec(css('activity.css'))![0];
    expect(rule).toMatch(/background: var\(--glass-ctl,/);
    expect(rule).toMatch(/border: var\(--w-hair\) solid var\(--glass-ctl-edge/);
    expect(rule).not.toMatch(/--surface-[0-9]/);
  });
});

/** An in-memory store that is chat-aware the way the server is: a chat's workflow is made once, and legacy ones are offered. */
export function memoryApi(seed: WorkflowDoc[] = []) {
  const docs = new Map<string, WorkflowDoc>(seed.map((d) => [d.id, d]));
  const view = (d: WorkflowDoc): WorkflowView => {
    const c = checkWorkflow(d);
    return { ...d, program: c.program, valid: c.ok, errors: c.errors, notes: workflowNotes(d) };
  };
  const created: { name: string; from: string | undefined; chatId: string | undefined }[] = [];
  const adopted: { id: string; chatId: string }[] = [];
  const api: WorkflowApi = {
    list: async () => ({ ok: true, body: [...docs.values()].map(view) }),
    chatList: async (chatId) => ({
      ok: true,
      body: { workflows: [...docs.values()].filter((d) => d.chatId === chatId).map(view), legacy: [...docs.values()].filter((d) => d.chatId === undefined).map(view) },
    }),
    get: async (id) => ({ ok: true, body: view(docs.get(id)!) }),
    create: async (name, from = 'fresh', chatId) => {
      created.push({ name, from, chatId });
      const have = chatId ? [...docs.values()].find((d) => d.chatId === chatId) : undefined;
      if (have) return { ok: true, body: view(have) };
      const d: WorkflowDoc = { version: 1, id: `${chatId ?? 'p'}-${docs.size}`, name, blocks: from === 'fresh' ? freshWorkflowBlocks() : [{ id: 'b1', kind: 'finish', title: 'Finish' }], rev: 1, createdAt: '', updatedAt: '', ...(chatId ? { chatId } : {}) };
      docs.set(d.id, d);
      return { ok: true, body: view(d) };
    },
    adopt: async (id, chatId) => {
      adopted.push({ id, chatId });
      const d = { ...docs.get(id)!, chatId, rev: docs.get(id)!.rev + 1 };
      docs.set(id, d);
      return { ok: true, body: view(d) };
    },
    ops: async (id, ops) => {
      const cur = docs.get(id)!;
      const d = { ...cur, ...applyWorkflowOps(cur, ops as WorkflowOp[]), rev: cur.rev + 1 };
      docs.set(id, d);
      return { ok: true, body: view(d) };
    },
    remove: async () => ({ ok: true, body: true }),
    agents: async () => ({ ok: true, body: [] }),
    models: async () => ({ ok: true, body: [] }),
  };
  return { api, docs, created, adopted };
}

describe('G8 item 2: an empty workflow has one clear start', () => {
  it('shows a sentence, one primary action (the white wfe-btn-solid, 0.1.6 B9) and a quiet secondary (wfe-btn); no heading, no second Start fresh', async () => {
    const { api } = memoryApi();
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    const primary = await screen.findByTestId('wfe-start-fresh');
    expect(primary.textContent).toBe('Start from ready-made blocks');
    expect(primary.className).toMatch(/wfe-btn-solid/);
    expect(primary.className).not.toMatch(/s2-blue/);
    const quiet = screen.getByTestId('wfe-start-empty');
    expect(quiet.className).toBe('wfe-btn');
    expect(quiet.className).not.toMatch(/s2-blue/);
    expect(screen.getByTestId('wfe-start-lead').textContent).toMatch(/ready-made blocks/);
    expect(screen.getByTestId('wfe-start').querySelector('h4')).toBeNull();
    expect(screen.queryByTestId('wfe-fresh'), 'the header does not repeat the start').toBeNull();
  });

  it('once empty (only Finish) the list shows where the first block goes, and a drop there adds it', async () => {
    const { api } = memoryApi();
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    fireEvent.click(await screen.findByTestId('wfe-start-empty'));
    const first = await screen.findByTestId('wfe-first');
    expect(first.textContent).toMatch(/Add the first block here/);
    expect(screen.getAllByTestId('wfe-block')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('wfe-add-agent'));
    await waitFor(() => expect(screen.getAllByTestId('wfe-block')).toHaveLength(2));
    expect(screen.queryByTestId('wfe-first'), 'the hint goes once there is a block').toBeNull();
  });

  it('an empty workflow does not open on the fields of Finish: the side column says where to start', async () => {
    const { api } = memoryApi();
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    fireEvent.click(await screen.findByTestId('wfe-start-empty'));
    await screen.findByTestId('wfe-first');
    expect(screen.queryByTestId('wfe-inspector')).toBeNull();
    expect(screen.getByText(/Nothing to edit yet/)).toBeTruthy();
  });
});

describe('G8 item 3: one workflow per chat', () => {
  const doc = (id: string, name: string, chatId?: string): WorkflowDoc => ({ version: 1, id, name, blocks: freshWorkflowBlocks(), rev: 1, createdAt: '', updatedAt: '', ...(chatId ? { chatId } : {}) });

  it('a chat opens its own workflow, with no picker of the others; a different chat opens a different one', async () => {
    const { api } = memoryApi([doc('wa', 'Chat A flow', 'chat-a'), doc('wb', 'Chat B flow', 'chat-b')]);
    const a = render(<WorkflowEditor api={api} chatId="chat-a" onClose={() => undefined} onRun={async () => null} />);
    await screen.findAllByTestId('wfe-block');
    expect((screen.getByTestId('wfe-name') as HTMLInputElement).defaultValue).toBe('Chat A flow');
    expect(screen.queryByTestId('wfe-pick'), 'one workflow per chat: nothing to pick').toBeNull();
    expect(screen.queryByTestId('wfe-fresh'), 'and no second one to start').toBeNull();
    a.unmount();
    render(<WorkflowEditor api={api} chatId="chat-b" onClose={() => undefined} onRun={async () => null} />);
    await screen.findAllByTestId('wfe-block');
    expect((screen.getByTestId('wfe-name') as HTMLInputElement).defaultValue).toBe('Chat B flow');
  });

  it('a chat with none starts one for itself (the chat id goes to the server), and the project list is not shown to it', async () => {
    const { api, created } = memoryApi([doc('wb', 'Chat B flow', 'chat-b')]);
    render(<WorkflowEditor api={api} chatId="chat-a" onClose={() => undefined} onRun={async () => null} />);
    fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
    await waitFor(() => expect(screen.getAllByTestId('wfe-block')).toHaveLength(4));
    expect(created).toEqual([{ name: 'Workflow', from: 'fresh', chatId: 'chat-a' }]);
  });

  it('older project workflows are offered to a chat that has none, and taking one opens it', async () => {
    const { api, adopted } = memoryApi([doc('old', 'Saved before chats')]);
    render(<WorkflowEditor api={api} chatId="chat-a" onClose={() => undefined} onRun={async () => null} />);
    const use = await screen.findByTestId('wfe-legacy-use');
    expect(use.textContent).toBe('Saved before chats');
    fireEvent.click(use);
    await waitFor(() => expect(adopted).toEqual([{ id: 'old', chatId: 'chat-a' }]));
    await screen.findAllByTestId('wfe-block');
    expect(screen.queryByTestId('wfe-legacy')).toBeNull();
  });

  it('the transport asks the server for the workflow of the chat and says the chat when it creates', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ workflows: [], legacy: [] }), { status: 200 });
    });
    const api = createWorkflowApi(f as unknown as typeof fetch);
    await api.chatList('chat-a');
    await api.create('Workflow', 'fresh', 'chat-a');
    await api.adopt('old', 'chat-a');
    expect(calls[0]!.url).toBe('/api/workflows?chat=chat-a');
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ name: 'Workflow', from: 'fresh', chatId: 'chat-a' });
    expect(calls[2]!.url).toBe('/api/workflows/old/adopt');
  });

  it('the Agents Workflows surface passes the open chat to the editor', () => {
    const src = readFileSync(resolve(__dirname, 'ConnectedActivity.tsx'), 'utf8');
    expect(src).toMatch(/useActiveSessionIdIfAny\(\)/);
    expect(src).toMatch(/<WorkflowEditor[\s\S]{0,120}chatId=\{chatId\}/);
  });
});

describe('G8 item 4: edit the workflow with the chat', () => {
  it('Edit with chat puts a starter sentence naming the chat in the composer hook, and nothing is sent', async () => {
    const { api } = memoryApi();
    const starters: string[] = [];
    render(<WorkflowEditor api={api} chatId="chat-a" onClose={() => undefined} onRun={async () => null} onEditWithChat={(t) => starters.push(t)} />);
    expect(screen.queryByTestId('wfe-chat-edit'), 'nothing to edit until the chat has a workflow').toBeNull();
    fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
    const btn = await screen.findByTestId('wfe-chat-edit');
    expect(btn.className).toMatch(/s2-chipbtn/);
    expect(btn.textContent).toBe('Edit with chat');
    fireEvent.click(btn);
    expect(starters).toEqual(["Edit this chat's workflow: "]);
    expect(starters[0]).not.toMatch(/chat-a|session/);
  });

  it('the Agents surface turns it into the composer draft and closes the editor', () => {
    const src = readFileSync(resolve(__dirname, 'ConnectedActivity.tsx'), 'utf8');
    expect(src).toMatch(/composer\/draft/);
    /* an unsent draft is kept: the starter is appended to it, not put in its place */
    expect(src).toMatch(/draft\.trim\(\) === '' \? starter : `\$\{draft\.replace/);
    expect(src).toMatch(/setEditorOpen\(false\)/);
  });
});

describe('G8 F6: Run waits for a block', () => {
  it('on an empty workflow Run is disabled and quiet (no solid class); with a block it is the solid primary', async () => {
    const { api } = memoryApi();
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    fireEvent.click(await screen.findByTestId('wfe-start-empty'));
    const run = (await screen.findByTestId('wfe-run')) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(run.className).not.toMatch(/wfe-btn-solid/);
    fireEvent.click(screen.getByTestId('wfe-add-agent'));
    await screen.findAllByTestId('wfe-block');
    expect(screen.getAllByTestId('wfe-block')).toHaveLength(2);
    expect((screen.getByTestId('wfe-run') as HTMLButtonElement).className).toMatch(/wfe-btn-solid/);
  });
});
