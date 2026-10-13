import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { applyWorkflowOps, checkWorkflow, freshWorkflowBlocks, workflowNotes, type WorkflowDoc, type WorkflowOp } from '@sequence/schema';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkflowEditor } from './WorkflowEditor';
import type { WorkflowApi, WorkflowView } from './workflowClient';

afterEach(cleanup);

/* G5: the editor's buttons answer a hover and a press, Run is the one primary and shows a running state. */

const css = readFileSync(resolve(__dirname, 'workflowEditor.css'), 'utf8').replace(/\r\n/g, '\n');

function starterApi(): WorkflowApi {
  let d: WorkflowDoc = { version: 1, id: 'w1', name: 'Workflow', blocks: freshWorkflowBlocks(), rev: 1, createdAt: '', updatedAt: '' };
  const view = (x: WorkflowDoc): WorkflowView => {
    const c = checkWorkflow(x);
    return { ...x, program: c.program, valid: c.ok, errors: c.errors, notes: workflowNotes(x) };
  };
  return {
    list: async () => ({ ok: true, body: [view(d)] }),
    get: async () => ({ ok: true, body: view(d) }),
    ops: async (_id: string, ops: readonly WorkflowOp[]) => {
      d = { ...d, ...applyWorkflowOps(d, ops as WorkflowOp[]), rev: d.rev + 1 };
      return { ok: true, body: view(d) };
    },
    agents: async () => ({ ok: true, body: [{ id: 'claude', label: 'Claude Code' }] }),
    models: async () => ({ ok: true, body: [{ id: 'm1', name: 'Model 1' }] }),
  } as unknown as WorkflowApi;
}

describe('G5: workflow editor buttons', () => {
  it('Run is the solid primary with a play mark, and while it runs it shows the spinner and says Running', async () => {
    render(<WorkflowEditor api={starterApi()} onClose={() => undefined} onRun={() => new Promise(() => undefined)} />);
    const run = (await screen.findByTestId('wfe-run')) as HTMLButtonElement;
    await waitFor(() => expect(run.className.split(' ')).toContain('wfe-btn-solid'));
    expect(run.querySelector('[data-glyph="play"]')).not.toBeNull();
    expect(run.textContent).toBe('Run');
    fireEvent.click(run);
    await waitFor(() => expect(run.getAttribute('data-running')).toBe('true'));
    expect(run.textContent).toMatch(/Running/);
    expect(run.getAttribute('aria-busy')).toBe('true');
    expect(run.disabled).toBe(true);
    expect(run.querySelector('[data-glyph="play"]')).toBeNull();
  });

  it('the CSS gives hover and press motion, icons that do not shrink, and turns it all off under reduced motion', () => {
    expect(css).toMatch(/\.wfe-btn:hover:not\(:disabled\) \{ transform: translateY\(-1px\); \}/);
    expect(css).toMatch(/\.wfe-btn:active:not\(:disabled\) \{ transform: translateY\(0\) scale\(0\.97\); \}/);
    expect(css).toMatch(/\.wfe-btn > svg[^{]*\{ flex: none; \}/);
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{\n  \.wfe-btn, \.wfe-x \{ transition: none; \}[\s\S]*?\n\}/.exec(css);
    expect(reduced).not.toBeNull();
    expect(reduced![0]).toMatch(/transform: none/);
  });
});
