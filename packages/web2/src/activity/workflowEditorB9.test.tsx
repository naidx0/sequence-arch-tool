import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BLOCK_KINDS, applyWorkflowOps, checkWorkflow, freshWorkflowBlocks, workflowNotes, type WorkflowDoc, type WorkflowOp } from '@sequence/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BlockGlyph, WorkflowEditor } from './WorkflowEditor';
import { WorkflowGraph } from './WorkflowGraph';
import type { WorkflowApi, WorkflowView } from './workflowClient';

afterEach(cleanup);

/** A store with nothing in it: the editor opens on its start page. */
const emptyApi = {
  list: async () => ({ ok: true, body: [] }),
  chatList: async () => ({ ok: true, body: { workflows: [], legacy: [] } }),
  agents: async () => ({ ok: true, body: [] }),
  models: async () => ({ ok: true, body: [] }),
} as unknown as WorkflowApi;

/* 0.1.6 B9 (the owner: "see how long this pop-up is? ... it was too wide and still is too wide"). jsdom has no layout, so the rules
   are read from the real CSS; the pixel measurements were taken in a browser at 1440x900 and 1024x700 (scripts/b9/size.mjs). */
const css = readFileSync(resolve(__dirname, 'workflowEditor.css'), 'utf8').replace(/\r\n/g, '\n');
const rule = (sel: string) => [...css.matchAll(new RegExp(`(?:^|\n)${sel.replace(/[.[\]]/g, '\\$&')} \\{[^}]*\\}`, 'g'))].map((m) => m[0]).join('\n');

describe('B9 item 1: a compact pop-up with its own boundaries', () => {
  it('the start-size .wfe is 480px at most and never wider than its container (the viewport less the scrim gutters)', () => {
    expect(rule('.wfe')).toMatch(/width: min\(480px, 100%\);/);
  });
  it('the start-size .wfe is as tall as its content up to 80% of the viewport, and clips what is past it', () => {
    const r = rule('.wfe');
    expect(r).toMatch(/max-height: min\(80vh, 100%\);/);
    expect(r).toMatch(/overflow: hidden;/);
    expect(r).toMatch(/height: auto;/);
  });
  it('the inner columns scroll, so the header and palette stay in view', () => {
    expect(css).toMatch(/\.wfe-list, \.wfe-side \{[^}]*overflow-y: auto;/);
    expect(rule('.wfe-cols')).toMatch(/grid-template-rows: minmax\(0, 1fr\);/);
    expect(rule('.wfe-cols')).toMatch(/min-height: 0;/);
  });
  it('what sits in a scrolling column keeps its height instead of shrinking into a scrollbar of its own', () => {
    expect(css).toMatch(/\.wfe-list > \*, \.wfe-side > \* \{ flex-shrink: 0; \}/);
  });
  it('the graph does not scroll inside the scrolling column (no second scrollbar)', () => {
    const r = /\.wfe-graph\.ac-scope \{[^}]*\}/.exec(css)![0];
    expect(r).not.toMatch(/max-height: (?!none)/);
    expect(r).toMatch(/overflow: visible;/);
  });
  it('the two columns stack below 680px, not at 900px', () => {
    expect(css).toMatch(/@media \(max-width: 679px\) \{ \.wfe-cols \{ grid-template-columns: minmax\(0, 1fr\);/);
    expect(css).not.toMatch(/max-width: 899px/);
  });
});

describe('B9 item 2: the white primary is back', () => {
  it('the start page primary is the app white primary (wfe-btn-solid), not the blue s2-blue; the second action is the quiet outline', async () => {
    render(<WorkflowEditor api={emptyApi} onClose={() => undefined} onRun={async () => null} chatId="c1" />);
    const fresh = await screen.findByTestId('wfe-start-fresh');
    expect(fresh.className.split(' ')).toEqual(['wfe-btn', 'wfe-btn-solid']);
    expect(fresh.className).not.toMatch(/s2-blue/);
    const empty = screen.getByTestId('wfe-start-empty');
    expect(empty.className).toBe('wfe-btn');
    expect(document.querySelector('[data-testid="wfe"] .s2-blue')).toBeNull();
  });
  it('the solid is the ink of the page on the page (white in dark), not an accent', () => {
    const solid = /\.wfe-btn-solid \{[^}]*\}/.exec(css)![0];
    expect(solid).toMatch(/background: var\(--b-ink1\);/);
    expect(solid).not.toMatch(/--b-acc|blue/);
  });
});

/** A store holding one starter workflow (the real ops, the real compile). */
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

describe('B9 item 3: icons sit on whole pixels', () => {
  it.each([...BLOCK_KINDS])('the %s glyph is 16x16 on a 16x16 viewBox (1 unit = 1 css pixel) with a 1.5 stroke and no transform', (kind) => {
    const { container } = render(<BlockGlyph kind={kind} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    /* 0.1.6 C5: the block glyphs are the 0.1.5 artwork again, at its 1.5 stroke */
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
    expect(container.querySelectorAll('[transform]')).toHaveLength(0);
  });

  it('every svg in the open editor is drawn at its own size (viewBox = width x height), with an integer size and stroke, and no transform', async () => {
    render(<WorkflowEditor api={starterApi()} onClose={() => undefined} onRun={async () => null} />);
    await screen.findAllByTestId('wfe-block');
    const svgs = [...document.querySelectorAll('[data-testid="wfe"] svg')].filter((n) => !n.closest('[data-testid="wfe-graph"]'));
    /* the palette, the rows' glyphs, grips and mini buttons, and the close button: well over a dozen */
    expect(svgs.length).toBeGreaterThan(12);
    for (const svg of svgs) {
      const w = svg.getAttribute('width')!;
      const h = svg.getAttribute('height')!;
      expect(Number.isInteger(Number(w)) && Number.isInteger(Number(h)), svg.outerHTML).toBe(true);
      expect(svg.getAttribute('viewBox'), svg.outerHTML).toBe(`0 0 ${w} ${h}`);
      const sw = svg.getAttribute('stroke-width');
      if (sw !== null && !(BLOCK_KINDS as readonly string[]).includes(svg.getAttribute('data-glyph') ?? '')) expect(Number.isInteger(Number(sw)), svg.outerHTML).toBe(true);
      expect(svg.querySelectorAll('[transform]'), svg.outerHTML).toHaveLength(0);
    }
  });

  it('the graph arrowhead is drawn in page pixels (not scaled by the line width) and a straight edge sits on a whole x', async () => {
    const { program } = checkWorkflow({ version: 1, id: 'w', name: 'W', blocks: freshWorkflowBlocks(), rev: 1, createdAt: '', updatedAt: '' });
    const { container } = render(<WorkflowGraph program={program} nodeStates={{}} />);
    const m = container.querySelector('marker')!;
    expect(m.getAttribute('markerUnits')).toBe('userSpaceOnUse');
    expect(m.getAttribute('viewBox')).toBe(`0 0 ${m.getAttribute('markerWidth')} ${m.getAttribute('markerHeight')}`);
    const starts = [...container.querySelectorAll('[data-testid="activity-graph-edge"] path')].map((p) => /^M(\S+) /.exec(p.getAttribute('d')!)![1]!);
    expect(starts.length).toBeGreaterThan(0);
    for (const x of starts) expect(Number.isInteger(Number(x)), x).toBe(true);
  });

  it('the pop-up hangs from a whole-pixel top edge (so nothing in it lands on a half pixel), and the palette chips are whole-pixel widths', () => {
    expect(rule('.wfe-scrim')).toMatch(/align-items: flex-start;/);
    expect(rule('.wfe-scrim')).toMatch(/padding-top: round\(down, 12vh, 1px\);/);
    expect(rule('.wfe-chip')).toMatch(/width: 120px;/);
    expect(rule('.wfe-cap')).toMatch(/width: 80px;/);
  });

  it('no editor rule scales, zooms or transforms an icon', () => {
    const block = [...css.matchAll(/[^{}]*svg[^{}]*\{[^}]*\}/g)].map((m) => m[0]).join(' ');
    expect(block).not.toMatch(/transform|scale|zoom/);
  });
});

describe('B9 item 4: the editor drop-downs are the app menu, not the browser select', () => {
  const open = async (onClose: () => void = () => undefined) => {
    render(<WorkflowEditor api={starterApi()} onClose={onClose} onRun={async () => null} />);
    fireEvent.click((await screen.findAllByTestId('wfe-block-open'))[0]!);
    return screen.findByTestId('wfe-f-agent');
  };

  it('there is no native <select> in the editor, on an agent block or a test block', async () => {
    await open();
    expect(document.querySelectorAll('[data-testid="wfe"] select')).toHaveLength(0);
    fireEvent.click(screen.getAllByTestId('wfe-block-open')[2]!);
    await screen.findByTestId('wfe-f-command');
    expect(document.querySelectorAll('[data-testid="wfe"] select')).toHaveLength(0);
  });

  it('the trigger announces a menu; opening it shows the app menu (.s2-menu rows .s2-mi) with the current value checked and focused', async () => {
    const trig = await open();
    expect(trig.getAttribute('aria-haspopup')).toBe('menu');
    expect(trig.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('wfe-f-agent-menu')).toBeNull();
    fireEvent.click(trig);
    const menu = await screen.findByTestId('wfe-f-agent-menu');
    expect(trig.getAttribute('aria-expanded')).toBe('true');
    expect(menu.className).toMatch(/\bs2-menu\b/);
    expect(menu.getAttribute('role')).toBe('menu');
    const rows = menu.querySelectorAll('[role="menuitemradio"]');
    expect(rows.length).toBe(2);
    rows.forEach((r) => expect(r.className).toMatch(/\bs2-mi\b/));
    const on = menu.querySelector('[aria-checked="true"]') as HTMLElement;
    expect(on.textContent).toBe('Default agent');
    await waitFor(() => expect(document.activeElement).toBe(on));
  });

  it('ArrowDown on the closed trigger opens it, the arrows move between rows, Escape closes only the menu and focus returns to the trigger', async () => {
    const onClose = vi.fn();
    const trig = await open(onClose);
    trig.focus();
    fireEvent.keyDown(trig, { key: 'ArrowDown' });
    const menu = await screen.findByTestId('wfe-f-agent-menu');
    const rows = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('wfe-f-agent-menu')).toBeNull());
    expect(onClose, 'the pop-up stays open').not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trig);
    expect(trig.getAttribute('aria-expanded')).toBe('false');
  });

  it('picking a row (Enter or Space on a focused row is a native click) sends the op, closes the menu and returns focus to the trigger', async () => {
    const trig = await open();
    fireEvent.click(trig);
    fireEvent.click(await screen.findByTestId('wfe-f-agent-opt-claude'));
    await waitFor(() => expect(screen.queryByTestId('wfe-f-agent-menu')).toBeNull());
    /* the op's answer remounts the inspector (new revision): focus lands on the same field of the new copy, never on <body> */
    await waitFor(() => expect(screen.getByTestId('wfe-f-agent').getAttribute('data-value')).toBe('claude'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('wfe-f-agent')));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('Tab from an open menu closes it and goes on from its trigger (Shift+Tab back), inside the pop-up, never lost behind the menu', async () => {
    const trig = await open();
    fireEvent.click(trig);
    let row = (await screen.findByTestId('wfe-f-agent-menu')).querySelector<HTMLElement>('[role="menuitemradio"]')!;
    row.focus();
    expect(fireEvent.keyDown(row, { key: 'Tab' }), 'handled, not left to the browser').toBe(false);
    expect(document.activeElement).toBe(screen.getByTestId('wfe-f-model'));
    await waitFor(() => expect(screen.queryByTestId('wfe-f-agent-menu')).toBeNull());
    fireEvent.click(trig);
    row = (await screen.findByTestId('wfe-f-agent-menu')).querySelector<HTMLElement>('[role="menuitemradio"]')!;
    row.focus();
    fireEvent.keyDown(row, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('wfe-f-prompt'));
    await waitFor(() => expect(screen.queryByTestId('wfe-f-agent-menu')).toBeNull());
  });

  it('the trigger is named by the field label and its value (aria-labelledby), not by a label that hides the value', async () => {
    const trig = await open();
    expect(trig.hasAttribute('aria-label')).toBe(false);
    const names = trig.getAttribute('aria-labelledby')!.split(' ').map((i) => document.getElementById(i)?.textContent);
    expect(names).toEqual(['Agent', 'Default agent']);
  });

  it('a press outside closes it; a second trigger closes the first (one menu at a time)', async () => {
    const trig = await open();
    fireEvent.click(trig);
    await screen.findByTestId('wfe-f-agent-menu');
    fireEvent.pointerDown(screen.getByTestId('wfe-name'));
    await waitFor(() => expect(screen.queryByTestId('wfe-f-agent-menu')).toBeNull());
    fireEvent.click(trig);
    await screen.findByTestId('wfe-f-agent-menu');
    await act(async () => { fireEvent.pointerDown(screen.getByTestId('wfe-f-model')); });
    fireEvent.click(screen.getByTestId('wfe-f-model'));
    await screen.findByTestId('wfe-f-model-menu');
    expect(screen.queryByTestId('wfe-f-agent-menu')).toBeNull();
  });

  it('the menu opens and closes with the shell\'s animation (its duration and curve), and none under reduced motion', () => {
    const r = rule('.wfe-menu.s2-menu');
    expect(r).toMatch(/animation: wfe-menu-in var\(--s2-switch-dur\) var\(--s2-switch-ease\);/);
    expect(css).toMatch(/\.wfe-menu\.s2-menu\[data-state='closing'\] \{ animation: wfe-menu-out var\(--s2-switch-dur\) var\(--s2-switch-ease\) forwards;/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.wfe-menu\.s2-menu, \.wfe-menu\.s2-menu\[data-state='closing'\] \{ animation: none; \}/);
  });

  it('the trigger is drawn like the editor\'s fields, with a 12px chevron on whole pixels', async () => {
    const trig = await open();
    expect(rule('.wfe-sel')).toMatch(/border: var\(--w-hair\) solid var\(--b-edge\);/);
    expect(rule('.wfe-sel')).toMatch(/height: var\(--control-h-lg\);/);
    const chev = trig.querySelector('svg')!;
    expect([chev.getAttribute('width'), chev.getAttribute('height'), chev.getAttribute('viewBox')]).toEqual(['12', '12', '0 0 12 12']);
  });
});

describe('B9 review fixes: layout rules', () => {
  it('the graph is not capped by the shared .ac-scope max-height, so it never scrolls inside the column', () => {
    expect(/\.wfe-graph\.ac-scope \{[^}]*\}/.exec(css)![0]).toMatch(/max-height: none;/);
  });
  it('stacked columns clip no sideways overflow (the focus-ring pad moves to the stacked wrapper)', () => {
    const m = /@media \(max-width: 679px\) \{.*\}/.exec(css)![0];
    expect(m).toMatch(/\.wfe-cols \{ overflow-x: hidden;/);
    expect(m).toMatch(/\.wfe-list, \.wfe-side \{[^}]*padding: 0; margin: 0;/);
  });
  it('the title has priority over the subtitle in a row: the subtitle shrinks first', () => {
    expect(rule('.wfe-bt')).toMatch(/max-width: 100%;/);
    expect(rule('.wfe-bt')).not.toMatch(/max-width: 60%/);
    expect(rule('.wfe-bt')).toMatch(/flex: 0 0 auto;/);
    expect(rule('.wfe-bs')).toMatch(/flex: 0 100 auto;/);
  });
  it('the saved-workflows caption takes its own row (not the 80px palette width)', () => {
    expect(css).toMatch(/\.wfe-legacy \.wfe-cap \{ flex: 1 0 100%; width: auto; \}/);
  });
  it('the first half of a pair, and of the two columns, is a whole number of pixels (round down), so triggers and chevrons sit on whole pixels', () => {
    expect(rule('.wfe-f2')).toMatch(/grid-template-columns: round\(down, calc\(\(100% - var\(--sp-8\)\) \/ 2\), 1px\) minmax\(0, 1fr\);/);
    expect(rule('.wfe-cols')).toMatch(/grid-template-columns: round\(down, calc\(\(100% - var\(--sp-16\)\) \/ 2\), 1px\) minmax\(0, 1fr\);/);
  });
});
