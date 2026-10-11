import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BLOCK_KINDS, applyWorkflowOps, checkWorkflow, freshWorkflowBlocks, workflowNotes, type WorkflowDoc, type WorkflowOp } from '@sequence/schema';
import { afterEach, describe, expect, it } from 'vitest';

import { BlockGlyph, WorkflowEditor } from './WorkflowEditor';
import type { WorkflowApi, WorkflowView } from './workflowClient';

afterEach(cleanup);

const css = readFileSync(resolve(__dirname, 'workflowEditor.css'), 'utf8').replace(/\r\n/g, '\n');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\n)${sel.replace(/[.[\]']/g, '\\$&')} \\{[^}]*\\}`, 'g'))].map((m) => m[0]).join('\n');

const emptyApi = {
  list: async () => ({ ok: true, body: [] }),
  chatList: async () => ({ ok: true, body: { workflows: [], legacy: [] } }),
  agents: async () => ({ ok: true, body: [] }),
  models: async () => ({ ok: true, body: [] }),
} as unknown as WorkflowApi;

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
    agents: async () => ({ ok: true, body: [] }),
    models: async () => ({ ok: true, body: [] }),
  } as unknown as WorkflowApi;
}

describe('C5 item 1: a small start pop-up, a large editor', () => {
  it('the start choice is marked small, and the editor of an open workflow is marked large', async () => {
    const a = render(<WorkflowEditor api={emptyApi} onClose={() => undefined} onRun={async () => null} chatId="c1" />);
    await screen.findByTestId('wfe-start');
    expect(screen.getByTestId('wfe').getAttribute('data-size')).toBe('small');
    expect(a.container.ownerDocument.querySelector('.wfe-scrim')!.getAttribute('data-size')).toBe('small');
    cleanup();
    render(<WorkflowEditor api={starterApi()} onClose={() => undefined} onRun={async () => null} />);
    await screen.findAllByTestId('wfe-block');
    expect(screen.getByTestId('wfe').getAttribute('data-size')).toBe('large');
    expect(document.querySelector('.wfe-scrim')!.getAttribute('data-size')).toBe('large');
  });
  it('small is a ~480px pop-up (height to content); large is the 0.1.5 width, capped to the viewport, 86vh tall', () => {
    expect(rule('.wfe')).toMatch(/width: min\(480px, 100%\);/);
    expect(rule('.wfe')).toMatch(/height: auto;/);
    const large = rule(".wfe[data-size='large']");
    expect(large).toMatch(/width: min\(1280px, 100%\);/);
    expect(css).toMatch(/--wfe-h: min\(86vh, calc\(100vh - 48px\)\);/);
    expect(large).toMatch(/height: var\(--wfe-h\);/);
  });
  it('the change animates width, height and the top edge with the switch duration and easing, and is instant under reduced motion', () => {
    const r = rule(".wfe[data-grow='true']");
    for (const prop of ['width', 'height']) expect(r).toContain(`${prop} var(--s2-switch-dur) var(--s2-switch-ease)`);
    expect(rule('.wfe')).toMatch(/interpolate-size: allow-keywords;/);
    expect(rule(".wfe-scrim[data-grow='true']")).toContain('padding-top var(--s2-switch-dur) var(--s2-switch-ease)');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.wfe\[data-grow='true'\], \.wfe-scrim\[data-grow='true'\] \{ transition: none; \} \}/);
    /* the base rules carry no transition: only a grow from the start choice animates */
    expect(rule('.wfe')).not.toMatch(/transition:/);
    expect(rule('.wfe-scrim')).not.toMatch(/transition:/);
  });
  it('a reopen of an existing workflow never marks itself as growing; the start choice does, so leaving it animates', async () => {
    cleanup();
    localStorage.setItem('seq.wfe.size', 'large');
    render(<WorkflowEditor api={starterApi()} onClose={() => undefined} onRun={async () => null} />);
    expect(screen.getByTestId('wfe').getAttribute('data-size')).toBe('large');
    await screen.findAllByTestId('wfe-block');
    expect(screen.getByTestId('wfe').getAttribute('data-grow')).toBeNull();
    cleanup();
    render(<WorkflowEditor api={emptyApi} onClose={() => undefined} onRun={async () => null} chatId="c1" />);
    await screen.findByTestId('wfe-start');
    await waitFor(() => expect(screen.getByTestId('wfe').getAttribute('data-grow')).toBe('true'));
    localStorage.removeItem('seq.wfe.size');
  });
  it('Start from ready-made blocks moves focus into the editor (its first block), not to the page', async () => {
    cleanup();
    const api = { ...starterApi(), chatList: async () => ({ ok: true, body: { workflows: [], legacy: [] } }), create: async () => ({ ok: true, body: await (starterApi() as unknown as { get: () => Promise<{ body: WorkflowView }> }).get().then((r) => r.body) }) } as unknown as WorkflowApi;
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} chatId="c1" />);
    fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
    await screen.findAllByTestId('wfe-block');
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByTestId('wfe-block-open')[0]));
  });
});

describe('C5 item 2: the 0.1.5 glyph artwork, centred', () => {
  const EXPECT: Record<string, RegExp> = {
    agent: /M8 1\.8 13\.4 4\.9v6\.2L8 14\.2/,
    checker: /m2\.6 8\.6 3\.4 3\.4 7\.4-8/,
    test: /M6 2\.5h4/,
    loop: /M3 8a5 5 0 0 1 8\.6-3\.5L13 6/,
    finish: /M4 14V2\.5/,
  };
  it.each([...BLOCK_KINDS])('the %s glyph is the earlier drawing (1.5 stroke, 16x16, 1:1 viewBox)', (kind) => {
    const { container } = render(<BlockGlyph kind={kind} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.innerHTML).toMatch(EXPECT[kind]!);
  });
  it('the agent glyph keeps the 0.1.5 stroked hollow inner diamond, and no glyph draws a circle (G8 item 6)', () => {
    const { container } = render(<BlockGlyph kind="agent" />);
    const inner = container.querySelectorAll('path')[1]!;
    expect(inner.getAttribute('d')).toBe('M8 6.2 9.8 8 8 9.8 6.2 8z');
    expect(inner.getAttribute('fill')).toBeNull();
    expect(inner.getAttribute('stroke')).toBeNull();
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });
  it('a chip centres its glyph and label as one group, at a whole-pixel width', () => {
    expect(rule('.wfe-chip')).toMatch(/justify-content: center;/);
    expect(rule('.wfe-chip')).toMatch(/width: 120px;/);
  });
  it('a chip label is a whole even pixel width (set from its measure), so the group sits on whole pixels', () => {
    expect(readFileSync(resolve(__dirname, 'WorkflowEditor.tsx'), 'utf8')).toMatch(/Math\.ceil\(w \/ 2\) \* 2/);
  });
});
