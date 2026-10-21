import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROGRAMS, freshWorkflowBlocks, readyBlock, type WorkflowBlock } from '@sequence/schema';

import { PREVIEW_OPEN_MS, WorkflowPreview, WorkflowPreviewHover } from './WorkflowPreview';
import { WorkflowShelf } from './WorkflowShelf';
import { flowFromBlocks, flowFromProgram } from './workflowPreviewModel';
import type { WorkflowApi } from './workflowClient';
import css from './workflowPreview.css?raw';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const loopBlocks = (): WorkflowBlock[] => [
  readyBlock('agent', 'b1'),
  { ...readyBlock('loop', 'b2'), span: 2, maxIterations: 4 },
  readyBlock('test', 'b3'),
  readyBlock('checker', 'b4'),
  readyBlock('finish', 'b5'),
];

describe('the preview flow keeps the blocks in order', () => {
  it('agent, checker, test, finish for the ready-made blocks, with the step count', () => {
    const f = flowFromBlocks(freshWorkflowBlocks());
    expect(f.steps.map((s) => s.kind)).toEqual(['agent', 'checker', 'test', 'finish']);
    expect(f.count).toBe(3);
  });

  it('a loop is a return marker after the last block it repeats, never a step', () => {
    const f = flowFromBlocks(loopBlocks());
    expect(f.steps.map((s) => s.kind)).toEqual(['agent', 'test', 'checker', 'loop', 'finish']);
    expect(f.steps[3]!.max).toBe(4);
    expect(f.count).toBe(3);
  });

  it('every built-in program yields steps and none is a start node', () => {
    for (const e of BUILTIN_PROGRAMS) {
      const f = flowFromProgram(e.build());
      expect(f.steps.length).toBeGreaterThan(0);
      expect(f.steps.some((s) => s.id === 'start')).toBe(false);
    }
    const review = flowFromProgram(BUILTIN_PROGRAMS.find((e) => e.id === 'review-loop')!.build());
    expect(review.steps.some((s) => s.kind === 'loop')).toBe(true);
  });
});

describe('the preview card', () => {
  it('draws the steps in order with name, purpose, count, Open and Launch', () => {
    const onLaunch = vi.fn();
    const onOpen = vi.fn();
    render(<WorkflowPreview name="My loop" purpose="Does the thing." blocks={loopBlocks()} onLaunch={onLaunch} onOpen={onOpen} />);
    expect(screen.getAllByTestId('wfp-step').map((e) => e.getAttribute('data-kind'))).toEqual(['agent', 'test', 'checker', 'loop', 'finish']);
    expect(screen.getByText('My loop')).toBeTruthy();
    expect(screen.getByText('Does the thing.')).toBeTruthy();
    expect(screen.getByTestId('wfp-count').textContent).toBe('3 steps');
    fireEvent.click(screen.getByTestId('wfp-launch'));
    fireEvent.click(screen.getByTestId('wfp-open'));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('loads a saved workflow by id', async () => {
    vi.useRealTimers();
    const api = { get: vi.fn(async () => ({ ok: true as const, body: { name: 'Saved one', blocks: freshWorkflowBlocks() } })) } as unknown as WorkflowApi;
    render(<WorkflowPreview workflowId="wf-1" api={api} />);
    expect(await screen.findByText('Saved one')).toBeTruthy();
    expect(screen.getAllByTestId('wfp-step')).toHaveLength(4);
  });
});

describe('the polished card (Graphite)', () => {
  it('draws each step with the glyph of its kind from the app icon set, and a plain step as a dot', () => {
    render(<WorkflowPreview name="My loop" blocks={loopBlocks()} />);
    const glyph = (kind: string) => screen.getAllByTestId('wfp-step').find((e) => e.getAttribute('data-kind') === kind)!.querySelector('svg')?.getAttribute('data-icon');
    expect(glyph('agent')).toBe('agents');
    expect(glyph('test')).toBe('bolt');
    expect(glyph('checker')).toBe('check');
    expect(glyph('finish')).toBe('target');
    cleanup();
    render(<WorkflowPreview name="Shared" program={BUILTIN_PROGRAMS[0]!.build()} />);
    for (const li of screen.getAllByTestId('wfp-step')) {
      const kind = li.getAttribute('data-kind');
      if (kind === 'step') expect(li.querySelector('.wfp-dot')).toBeTruthy();
      else expect(li.querySelector('svg[data-icon]')).toBeTruthy();
    }
  });

  it('the loop-back is one marked row with the return glyph and how many times, never counted as a step', () => {
    render(<WorkflowPreview name="My loop" blocks={loopBlocks()} />);
    const loop = screen.getAllByTestId('wfp-step').find((e) => e.getAttribute('data-kind') === 'loop')!;
    expect(loop.querySelector('svg')!.getAttribute('data-icon')).toBe('undo');
    expect(loop.textContent).toBe('Loops back, up to 4');
    expect(screen.getByTestId('wfp-count').textContent).toBe('3 steps');
  });

  it('the header carries the name, the step count and the purpose; Open and Launch are kit buttons', () => {
    render(<WorkflowPreview name="My loop" purpose="Does the thing." blocks={loopBlocks()} onLaunch={() => undefined} onOpen={() => undefined} />);
    const head = screen.getByText('My loop').closest('.wfp-head')!;
    expect(head.contains(screen.getByTestId('wfp-count'))).toBe(true);
    expect(screen.getByText('Does the thing.').className).toBe('wfp-purpose');
    expect(screen.getByTestId('wfp-open').className).toContain('s2-btn');
    expect(screen.getByTestId('wfp-launch').className).toContain('s2-btn');
  });

  it('draws no boxes of its own: the glass belongs to the popover, and a step has no border', () => {
    const card = /\.wfp-card\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(card).not.toMatch(/border:|background:|box-shadow:/);
    const step = /\.wfp-step\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(step).not.toMatch(/border/);
    expect(css).not.toContain('·');
  });
});

describe('hover intent', () => {
  const host = () => (
    <WorkflowPreviewHover name="X" blocks={freshWorkflowBlocks()} onLaunch={() => undefined}>
      <button type="button">Row</button>
    </WorkflowPreviewHover>
  );

  it('does not open on a quick pass, opens after the delay, closes when the pointer leaves', () => {
    render(host());
    const h = screen.getByTestId('wfp-host');
    fireEvent.pointerEnter(h);
    act(() => void vi.advanceTimersByTime(PREVIEW_OPEN_MS - 50));
    expect(screen.queryByTestId('wfp-card')).toBeNull();
    fireEvent.pointerLeave(h);
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('wfp-card')).toBeNull();

    fireEvent.pointerEnter(h);
    act(() => void vi.advanceTimersByTime(PREVIEW_OPEN_MS + 10));
    expect(screen.getByTestId('wfp-card')).toBeTruthy();
    fireEvent.pointerLeave(h);
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.queryByTestId('wfp-card')).toBeNull();
  });

  it('keyboard focus opens it at once, Tab reaches Launch, Escape closes', () => {
    render(host());
    fireEvent.focus(screen.getByText('Row'));
    expect(screen.getByTestId('wfp-card')).toBeTruthy();
    expect(screen.getByTestId('wfp-launch').tagName).toBe('BUTTON');
    fireEvent.keyDown(screen.getByText('Row'), { key: 'Escape' });
    expect(screen.queryByTestId('wfp-card')).toBeNull();
  });
});

describe('the shelf', () => {
  it('lists every built-in and launching one hands its program to the run path', () => {
    const onLaunch = vi.fn();
    const api = { list: vi.fn(async () => ({ ok: true as const, body: [] })) } as unknown as WorkflowApi;
    render(<WorkflowShelf onLaunch={onLaunch} api={api} />);
    expect(screen.getAllByTestId('shelf-builtin')).toHaveLength(BUILTIN_PROGRAMS.length);
    const row = screen.getAllByTestId('shelf-builtin').find((e) => e.getAttribute('data-builtin-id') === 'review-loop')!;
    fireEvent.focus(row);
    fireEvent.click(screen.getByTestId('wfp-launch'));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch.mock.calls[0]![0].id).toBe('review-loop');
  });
});
