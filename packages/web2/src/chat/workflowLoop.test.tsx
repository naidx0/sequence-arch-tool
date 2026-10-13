import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { takeActivityLaunch } from '../activity/activityLaunch';
import { takeAgentsViewRequest } from '../agents/agentsSection';
import { createStore, StoreProvider } from '../state';
import { ProseMessage } from './ProseMessage';
import { parseWorkflowFence, WORKFLOW_FENCE_MAX_STEPS } from './workflowFence';

/*
 * B12: a workflow loop drawn inline. A ```workflow fence in prose is a small JSON spec; the chat draws its
 * steps with the loop-back edge and offers Run and Open in Workflows. Invalid input stays the raw block.
 */

const SPEC = {
  name: 'Fix until green',
  steps: [
    { id: 'plan', label: 'Plan the fix' },
    { id: 'edit', label: 'Edit' },
    { id: 'test', label: 'Run tests' },
  ],
  loop: { from: 'test', to: 'edit', until: 'tests pass' },
};
const fence = (v: unknown) => '```workflow\n' + (typeof v === 'string' ? v : JSON.stringify(v)) + '\n```';

beforeEach(() => {
  takeActivityLaunch();
  takeAgentsViewRequest();
});

describe('parseWorkflowFence', () => {
  it('accepts a well-formed loop', () => {
    expect(parseWorkflowFence(JSON.stringify(SPEC))).toEqual(SPEC);
  });
  it('rejects what it cannot draw honestly', () => {
    const bad: unknown[] = [
      'not json',
      [],
      { ...SPEC, name: '' },
      { ...SPEC, steps: [SPEC.steps[0]] },
      { ...SPEC, steps: Array.from({ length: WORKFLOW_FENCE_MAX_STEPS + 1 }, (_, i) => ({ id: `s${i}`, label: 'x' })) },
      { ...SPEC, steps: [SPEC.steps[0], SPEC.steps[0]] },
      { ...SPEC, steps: [{ id: 'a b', label: 'x' }, { id: 'b', label: 'y' }] },
      { ...SPEC, loop: { from: 'test', to: 'nope' } },
      { ...SPEC, loop: { from: 'plan', to: 'test' } },
    ];
    for (const b of bad) expect(parseWorkflowFence(typeof b === 'string' ? b : JSON.stringify(b)), JSON.stringify(b)).toBeNull();
  });
});

function draw(text: string) {
  const store = createStore({});
  render(
    <StoreProvider store={store}>
      <ProseMessage text={text} />
    </StoreProvider>,
  );
  return store;
}

describe('the chat draws a workflow fence', () => {
  it('renders the steps and the loop-back edge in a card', () => {
    draw('Here is the loop.\n\n' + fence(SPEC));
    const card = screen.getByTestId('chat-workflow-inline');
    expect(screen.getAllByTestId('chat-workflow-step').map((n) => n.textContent)).toEqual(['Plan the fix', 'Edit', 'Run tests']);
    expect(screen.getByTestId('chat-workflow-loop').textContent).toContain('tests pass');
    expect(card.textContent).not.toContain('"steps"');
  });

  it('Open in Workflows brings the Agents surface forward on its Workflows tab', () => {
    const store = draw(fence(SPEC));
    fireEvent.click(screen.getByTestId('chat-workflow-open'));
    expect(takeAgentsViewRequest()).toBe('workflows');
    expect(store.getState().session.surfaceFocus).toBe('agents');
  });

  it('Run hands the existing author form the loop as its instruction', () => {
    draw(fence(SPEC));
    fireEvent.click(screen.getByTestId('chat-workflow-run'));
    const launch = takeActivityLaunch();
    expect(launch?.name).toBe('Fix until green');
    expect(launch?.instruction).toContain('Plan the fix');
    expect(launch?.instruction).toContain('until tests pass');
    expect(takeAgentsViewRequest()).toBe('workflows');
  });

  it('invalid JSON shows the raw block, not a card', () => {
    draw(fence('{"name": "x", "steps": ['));
    expect(screen.queryByTestId('chat-workflow-inline')).toBeNull();
    expect(document.body.textContent).toContain('"steps"');
  });

  it('labels are text, never markup', () => {
    draw(fence({ ...SPEC, steps: [{ id: 'a', label: '<img src=x onerror=alert(1)>' }, SPEC.steps[1]], loop: null }));
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getAllByTestId('chat-workflow-step')[0]!.textContent).toContain('<img');
  });
});

describe('B12 review fixes', () => {
  it('two cards on one page use different arrowhead ids, and the drawing never scales above its own size', () => {
    const store = createStore();
    render(
      <StoreProvider store={store}>
        <ProseMessage text={`${fence(SPEC)}

${fence({ ...SPEC, name: 'Second' })}`} />
      </StoreProvider>,
    );
    const svgs = [...document.querySelectorAll('[data-testid="chat-workflow-inline"] svg[viewBox]')];
    expect(svgs.length).toBe(2);
    const ids = svgs.map((g) => g.querySelector('marker')!.getAttribute('id'));
    expect(new Set(ids).size).toBe(2);
    for (const g of svgs) expect(g.getAttribute('width')).toBe(g.getAttribute('viewBox')!.split(' ')[2]);
  });
});
