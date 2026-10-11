import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Program } from '@sequence/schema';

import { ActivityPane } from './ActivityPane';
import { detail } from './fixtures';
import { runControl } from './activityModel';
import { countCrossings, layoutWorkflow } from './workflowLayout';

/* The same program the e2e shots draw (e2e/r12-agents-shots.mjs). */
const node = (id: string, title: string, kind: string, extra: object = {}) => ({ id, title, kind, ...extra }) as Program['nodes'][number];
const edge = (id: string, from: string, to: string, kind: string) => ({ id, from, to, kind }) as Program['edges'][number];
const E2E: Program = {
  id: 'prog-fix',
  name: 'Fix until green',
  nodes: [node('start', 'Start', 'start'), node('plan', 'Plan the fix', 'agent'), node('loop', 'Until tests pass', 'loop', { loop: { condition: { left: 'green', op: 'falsy' }, maxIterations: 4 } }), node('edit', 'Edit the code', 'agent'), node('test', 'Run the tests', 'agent'), node('check', 'Verify against the graph', 'checker'), node('end', 'Finish', 'end')],
  edges: [edge('e1', 'start', 'plan', 'seq'), edge('e2', 'plan', 'loop', 'seq'), edge('e3', 'loop', 'edit', 'loop-body'), edge('e4', 'edit', 'test', 'seq'), edge('e5', 'test', 'loop', 'loop-back'), edge('e6', 'loop', 'check', 'seq'), edge('e7', 'check', 'end', 'seq')],
};

afterEach(cleanup);

const looping: Program = {
  id: 'p',
  name: 'Fix until green',
  nodes: [
    { id: 'start', title: 'Start', kind: 'start' },
    { id: 'loop', title: 'Until green', kind: 'loop', loop: { condition: { left: 'green', op: 'falsy' }, maxIterations: 4 } },
    { id: 'edit', title: 'Edit', kind: 'agent', agent: { prompt: 'x' } },
    { id: 'test', title: 'Test', kind: 'agent', agent: { prompt: 'y' } },
    { id: 'end', title: 'Finish', kind: 'end' },
  ],
  edges: [
    { id: 'a', from: 'start', to: 'loop', kind: 'seq' },
    { id: 'b', from: 'loop', to: 'edit', kind: 'loop-body' },
    { id: 'c', from: 'edit', to: 'test', kind: 'seq' },
    { id: 'd', from: 'test', to: 'loop', kind: 'loop-back' },
    { id: 'e', from: 'loop', to: 'end', kind: 'seq' },
  ],
};

describe('layoutWorkflow: ranks left to right, loops split off as back-edges', () => {
  it('ranks by longest forward path and flags the loop-back as a back-edge', () => {
    const g = layoutWorkflow(looping);
    const rank = Object.fromEntries(g.nodes.map((n) => [n.id, n.rank]));
    expect(rank).toMatchObject({ start: 0, loop: 1, edit: 2, test: 3 });
    /* Top to bottom: a later rank is lower on the page, and the arc's room is on the right. */
    const y = Object.fromEntries(g.nodes.map((n) => [n.id, n.y]));
    expect(y.start).toBeLessThan(y.loop!);
    expect(y.edit).toBeLessThan(y.test!);
    expect(g.edges.filter((e) => e.back).map((e) => e.id)).toEqual(['d']);
    expect(g.loops).toBe(1);
    expect(g.nodes.find((n) => n.id === 'loop')!.cap).toBe(4);
  });

  it('a cycle written as plain seq edges is still found and drawn as a back-edge', () => {
    const g = layoutWorkflow({
      nodes: [{ id: 'a', title: 'A', kind: 'agent' }, { id: 'b', title: 'B', kind: 'agent' }],
      edges: [{ id: 'x', from: 'a', to: 'b', kind: 'seq' }, { id: 'y', from: 'b', to: 'a', kind: 'seq' }],
    });
    expect(g.edges.filter((e) => e.back)).toHaveLength(1);
    expect(g.nodes.map((n) => n.rank)).toEqual([0, 1]);
  });

  it('a straight program has no loops and no room reserved under it', () => {
    const g = layoutWorkflow({ nodes: [{ id: 'a', title: 'A', kind: 'start' }, { id: 'b', title: 'B', kind: 'end' }], edges: [{ id: 'x', from: 'a', to: 'b', kind: 'seq' }] });
    expect(g.loops).toBe(0);
    const looped = layoutWorkflow(looping);
    expect(looped.height).toBeGreaterThan(g.height);
  });
});

describe('round 12: no crossings, the loop body in one column with the exit beside it, a region around what repeats', () => {
  const g = layoutWorkflow(E2E, { width: 440 });
  const n = (id: string) => g.nodes.find((x) => x.id === id)!;
  it('has no crossing edges', () => {
    expect(countCrossings(g)).toBe(0);
    expect(countCrossings(layoutWorkflow(E2E, { width: 250 }))).toBe(0);
  });
  it('keeps start, plan, loop, body and test in one column, and the exit and what follows in the next', () => {
    expect(new Set(['start', 'plan', 'loop', 'edit', 'test'].map((id) => n(id).col))).toEqual(new Set([0]));
    expect(n('check').col).toBe(1);
    expect(n('end').col).toBe(1);
    expect(n('check').rank).toBe(n('edit').rank);
  });
  it('shades exactly the steps inside the loop (the loop node and its body, not the exit)', () => {
    expect(g.regions).toHaveLength(1);
    expect([...g.regions[0]!.nodeIds].sort()).toEqual(['edit', 'loop', 'test']);
  });
  it('a branch puts its second arm beside the first, and still has no crossing', () => {
    const b = layoutWorkflow({
      nodes: [node('s', 'S', 'start'), node('b', 'B', 'branch'), node('t', 'T', 'agent'), node('f', 'F', 'agent'), node('j', 'J', 'end')],
      edges: [edge('1', 's', 'b', 'seq'), edge('2', 'b', 't', 'branch-true'), edge('3', 'b', 'f', 'branch-false'), edge('4', 't', 'j', 'seq'), edge('5', 'f', 'j', 'seq')],
    });
    expect(countCrossings(b)).toBe(0);
    expect(b.nodes.find((x) => x.id === 't')!.col).toBeLessThan(b.nodes.find((x) => x.id === 'f')!.col);
  });
});

describe('round 12: the graph fits a 1024 pane (about 250px), loop arc and label included', () => {
  it('is no wider than 250px with one loop and two columns', () => {
    const g = layoutWorkflow(E2E, { width: 250 });
    expect(g.width).toBeLessThanOrEqual(250);
    const far = Math.max(...g.nodes.map((x) => x.x + x.w));
    expect(far).toBeLessThanOrEqual(250);
    expect(g.nodes.every((x) => x.x >= 26)).toBe(true);
  });
  it('widens columns when the pane has room (1440), up to a ceiling', () => {
    expect(layoutWorkflow(E2E, { width: 440 }).colW).toBeGreaterThan(layoutWorkflow(E2E, { width: 250 }).colW);
    expect(layoutWorkflow(E2E, { width: 4000 }).colW).toBe(168);
  });
  it('only a genuinely wide graph (four columns) goes past the pane and scrolls', () => {
    const wide = layoutWorkflow({
      nodes: [node('s', 'S', 'start'), node('a', 'A', 'agent'), node('b', 'B', 'agent'), node('c', 'C', 'agent'), node('d', 'D', 'agent')],
      edges: [edge('1', 's', 'a', 'parallel'), edge('2', 's', 'b', 'parallel'), edge('3', 's', 'c', 'parallel'), edge('4', 's', 'd', 'parallel')],
    }, { width: 250 });
    expect(wide.cols).toBe(4);
    expect(wide.width).toBeGreaterThan(250);
  });
});

describe('round 12: the Commandable / Locked tooltip says what is true in every state', () => {
  const cases: [Parameters<typeof runControl>[0], boolean, boolean, RegExp][] = [
    ['running', false, true, /Running now.*Pause and Cancel run/],
    ['paused', true, true, /Paused at a gate.*Resume.*checkpoint/],
    ['paused', false, false, /Paused, but it has no checkpoint/],
    ['interrupted', true, true, /process went away.*Resume/],
    ['interrupted', false, false, /process went away, and it has no checkpoint/],
    ['stopped', true, true, /Halted.*Resume continues/],
    ['stopped', false, false, /Halted.*no checkpoint/],
    ['completed', true, false, /Finished cleanly/],
    ['completed-with-violations', true, false, /checks rejected/],
    ['failed', true, false, /step errored/],
  ];
  it.each(cases)('%s (checkpoint %s) is commandable=%s', (status, cp, commandable, copy) => {
    const c = runControl(status, cp);
    expect(c.commandable).toBe(commandable);
    expect(c.copy).toMatch(copy);
    expect(c.copy).not.toMatch(/live|offered below/);
  });
  it('the chip carries that sentence', () => {
    render(
      <ActivityPane embedded runs={[{ ...detail().run, status: 'paused' }]} now={1_700_000_060_000} filter="all" onFilter={() => undefined} onOpen={() => undefined} onCloseRun={() => undefined}
        openId={detail().run.runId} open={detail({ status: 'paused' })} onResume={() => undefined} />,
    );
    const chip = screen.getByTestId('activity-run-control');
    expect(chip.getAttribute('data-control')).toBe('commandable');
    expect(chip.getAttribute('title')).toMatch(/Paused at a gate/);
  });
});

describe('the run detail draws the graph, and says whether the run can be commanded', () => {
  const open = (over: Parameters<typeof detail>[0], status: 'running' | 'completed') =>
    render(
      <ActivityPane
        embedded
        runs={[{ ...detail().run, status }]}
        now={1_700_000_060_000}
        filter="all"
        onFilter={() => undefined}
        onOpen={() => undefined}
        onCloseRun={() => undefined}
        openId={detail().run.runId}
        open={detail({ ...over, status })}
        onPause={() => undefined}
        onResume={() => undefined}
        onCancel={() => undefined}
      />,
    );

  it('draws every step as a node and the loop as a labelled return arc', () => {
    open({ program: looping }, 'running');
    expect(screen.getAllByTestId('activity-graph-node')).toHaveLength(5);
    expect(screen.getAllByTestId('activity-graph-region')).toHaveLength(1);
    const loop = screen.getByTestId('activity-graph-loop');
    expect(loop.textContent).toContain('repeat, up to 4');
    expect(screen.getByTestId('activity-graph').getAttribute('data-loops')).toBe('1');
    expect(screen.getByTestId('activity-graph').getAttribute('aria-label')).toBe('Workflow graph, 5 steps, 1 loop');
  });

  it('a running run is Commandable; a finished one is Locked', () => {
    open({}, 'running');
    expect(screen.getByTestId('activity-run-control').getAttribute('data-control')).toBe('commandable');
    cleanup();
    open({}, 'completed');
    expect(screen.getByTestId('activity-run-control').getAttribute('data-control')).toBe('locked');
  });
});
