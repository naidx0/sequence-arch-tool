import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProgramRunStatus } from '@sequence/api-types';

import { ActivityPane } from './ActivityPane';
import { ACTIVITY } from './anchors';
import {
  ACTIVITY_BUCKETS,
  NODE_STATES,
  RUN_STATES,
  RUN_STATUSES,
  agoLabel,
  reasonOf,
  stepsLabel,
  workflowTitle,
} from './activityModel';
import { detail, oneOfEach, summary } from './fixtures';

/* ══════════════════════════════════════════════════════════════════════════
   H8 — THE WORKFLOW RUN STATES READ AT A GLANCE
   Owner: "the activity state, I don't really understand these. It doesn't look clean."

   Each lock below is one clause of the win line: the workflow's own name as the title, one plain word per state (all
   different), one short reason, "Step N of M", relative time, no engine words in the default view, technical detail only
   behind Details, tabs in the rows' own words, the run detail in the same plain words, and no more hues than states need.
   ══════════════════════════════════════════════════════════════════════════ */

afterEach(cleanup);

const NOW = 1_700_000_060_000;
const ENGINE_WORDS = /\bengine\b|curated|Program |node:|run:|\bnodes?\b|ungrounded|completed-with|violations|\bprog-|\brun-|supervisor|scheduler|checkpoint/i;

function pane(over: Partial<Parameters<typeof ActivityPane>[0]> = {}) {
  return render(
    <ActivityPane runs={oneOfEach()} now={NOW} filter="all" onFilter={() => undefined} onOpen={() => undefined} onCloseRun={() => undefined} {...over} />,
  );
}

describe('the engine-words scan finds what it should (positive and negative controls)', () => {
  it('matches the old 0.1.6 row text and the raw log, and passes the new words', () => {
    for (const old of ['Program running', 'Program completed-with-violations', 'node:status n2 running', 'ungrounded node id: svc:invented', '1/3 nodes', 'run-mn0p1q-0123abcd']) {
      expect(old, old).toMatch(ENGINE_WORDS);
    }
    for (const plain of ['Nightly sweep', 'Done with problems', 'Step 2 of 3', '2 checks failed', 'The app closed while it ran']) {
      expect(plain, plain).not.toMatch(ENGINE_WORDS);
    }
  });
});

describe('every state has one distinct plain word', () => {
  it('words are all different, and none is a status id or engine jargon', () => {
    const words = RUN_STATUSES.map((s) => RUN_STATES[s].word);
    expect(new Set(words).size).toBe(RUN_STATUSES.length);
    for (const word of words) {
      expect(word).not.toMatch(ENGINE_WORDS);
      expect(word).not.toMatch(/-/);
    }
    expect(words).toEqual(['Running', 'Paused', 'Interrupted', 'Done', 'Done with problems', 'Failed', 'Stopped']);
  });

  it('reasons and tooltips carry no engine words either', () => {
    for (const status of RUN_STATUSES) {
      const s = RUN_STATES[status];
      expect(s.reason ?? '', status).not.toMatch(ENGINE_WORDS);
      expect(s.meaning, status).not.toMatch(ENGINE_WORDS);
    }
    for (const status of Object.keys(NODE_STATES) as (keyof typeof NODE_STATES)[]) {
      expect(NODE_STATES[status].word).not.toMatch(ENGINE_WORDS);
    }
  });

  it('spends no more hues than states need: running, paused/problems, done and failed carry a hue; interrupted and stopped stay muted', () => {
    const tone = (s: ProgramRunStatus) => RUN_STATES[s].tone;
    expect(new Set(RUN_STATUSES.map(tone))).toEqual(new Set(['active', 'stalled', 'blocked', 'done', 'failed']));
    expect(tone('interrupted')).toBe(tone('stopped'));
    expect(tone('completed-with-violations')).toBe(tone('paused'));
  });

  it('the filter tabs use the rows’ own words', () => {
    const labels = ACTIVITY_BUCKETS.map((b) => b.label);
    expect(labels).toEqual(['All', 'Paused', 'Interrupted', 'Running', 'Finished']);
    for (const label of labels.filter((l) => l !== 'All' && l !== 'Finished')) {
      expect(RUN_STATUSES.map((s) => RUN_STATES[s].word)).toContain(label);
    }
  });
});

describe('the default view of the list', () => {
  it('has no engine words anywhere in the rows or the tabs, and no row is titled by its status', () => {
    const { container } = pane();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(ENGINE_WORDS);
    for (const row of screen.getAllByTestId(ACTIVITY.row)) {
      expect(row.textContent).not.toMatch(ENGINE_WORDS);
      expect(within(row).getByTestId(ACTIVITY.rowProgram).textContent).not.toMatch(/^Program\b|-/);
    }
  });

  it('each row reads "<name>, <one status word>, <reason>, Step N of M, <time ago>" (the dots between are drawn by CSS)', () => {
    pane();
    const row = (status: string) => screen.getAllByTestId(ACTIVITY.row).find((r) => r.dataset.status === status)!;
    expect(row('running').textContent).toBe('Nightly sweepRunningStep 2 of 3Started 1m ago');
    expect(row('paused').textContent).toBe('Release notesPausedWaiting for you to resumeStep 2 of 31m ago');
    expect(row('interrupted').textContent).toContain('The app closed while it ran');
    expect(row('completed-with-violations').textContent).toContain('2 checks failed');
    expect(row('failed').textContent).toContain('A step failed');
    expect(row('stopped').textContent).toContain('Ended before the last step');
    // every state draws its word: none is left to the icon alone
    for (const r of screen.getAllByTestId(ACTIVITY.row)) {
      const word = RUN_STATES[r.dataset.status as ProgramRunStatus].word;
      expect(within(r).getByTestId(ACTIVITY.rowState).textContent).toBe(word);
    }
  });

  it('never prints the run id or program id as text or in a tooltip (data-run-id is the test hook, not a reading)', () => {
    const runs = oneOfEach();
    const { container } = pane({ runs });
    const readable = [container.textContent ?? '', ...[...container.querySelectorAll('[title]')].map((n) => n.getAttribute('title') ?? '')].join(' | ');
    for (const run of runs) {
      expect(readable).not.toContain(run.runId);
      expect(readable).not.toContain(run.programId);
    }
  });
});

describe('the pieces', () => {
  it('titles a workflow by its name; a slug the engine fell back to is read as words, an empty name is "Untitled workflow"', () => {
    expect(workflowTitle({ programName: 'Nightly sweep', programId: 'prog-sweep' })).toBe('Nightly sweep');
    expect(workflowTitle({ programName: 'prog-release-notes', programId: 'prog-release-notes' })).toBe('Release notes');
    expect(workflowTitle({ programName: '  ', programId: 'x' })).toBe('Untitled workflow');
  });

  it('progress is "Step N of M" while going and "N of M steps done" once ended; null with no denominator', () => {
    expect(stepsLabel(summary({ status: 'running', nodesTotal: 3, nodesDone: 0 }))).toBe('Step 1 of 3');
    expect(stepsLabel(summary({ status: 'running', nodesTotal: 3, nodesDone: 3 }))).toBe('Step 3 of 3');
    // A clean Done run may have run fewer steps than declared (a branch follows one arm): it never says "1 of 3 steps done".
    expect(stepsLabel(summary({ status: 'completed', nodesTotal: 3, nodesDone: 3 }))).toBe('3 steps ran');
    expect(stepsLabel(summary({ status: 'completed', nodesTotal: 3, nodesDone: 1 }))).toBe('1 step ran');
    expect(stepsLabel(summary({ status: 'completed-with-violations', nodesTotal: 3, nodesDone: 2 }))).not.toMatch(/of/);
    expect(stepsLabel(summary({ status: 'completed', nodesTotal: 3, nodesDone: 0 }))).toBeNull();
    expect(stepsLabel(summary({ status: 'failed', nodesTotal: 3, nodesDone: 1 }))).toBe('1 of 3 steps done');
    expect(stepsLabel(summary({ status: 'stopped', nodesTotal: 3, nodesDone: 2 }))).toBe('2 of 3 steps done');
    expect(stepsLabel(summary({ nodesTotal: 0 }))).toBeNull();
  });

  it('the reason names a count only where the run carries one', () => {
    expect(reasonOf({ status: 'completed-with-violations', violations: ['a'] })).toBe('1 check failed');
    expect(reasonOf({ status: 'completed-with-violations', violations: ['a', 'b', 'c'] })).toBe('3 checks failed');
    expect(reasonOf({ status: 'completed-with-violations' })).toBe('A check rejected the result');
    expect(reasonOf({ status: 'running' })).toBeNull();
    expect(reasonOf({ status: 'completed' })).toBeNull();
  });

  it('time is relative: just now, minutes, hours, days ago', () => {
    const run = summary({ status: 'completed', startedAt: 0, finishedAt: 1_000_000 });
    expect(agoLabel(run, 1_000_000 + 4_000)).toBe('just now');
    expect(agoLabel(run, 1_000_000 + 5 * 60_000)).toBe('5m ago');
    expect(agoLabel(run, 1_000_000 + 2 * 3_600_000)).toBe('2h ago');
    expect(agoLabel(run, 1_000_000 + 3 * 86_400_000)).toBe('3d ago');
    expect(agoLabel(summary({ startedAt: 0 }), 90_000)).toBe('Started 1m ago');
    expect(agoLabel(summary({ startedAt: 0 }), 3_000)).toBe('Started just now');
  });
});

describe('the opened run, in the same plain words', () => {
  function opened(over: Parameters<typeof detail>[0] = {}) {
    const base = detail(over);
    return pane({ runs: [summary()], openId: base.run.runId, open: base });
  }

  it('lists the steps with plain words and no engine kinds, and hides everything technical until Details is opened', () => {
    const { container } = opened({
      error: 'the executor refused: no model configured',
      violations: ['ungrounded node id: svc:invented'],
      notes: [{ nodeId: 'n2', kind: 'loop-cap-reached' }],
    });
    const panel = screen.getByTestId(ACTIVITY.detail);
    const steps = screen.getAllByTestId(ACTIVITY.detailNode).map((n) => n.textContent);
    expect(steps).toEqual(['DoneStart', 'RunningAsk the agent', 'Not startedCheck the claims']);

    // Closed: no id, no event name, no checker line, no note, no raw status.
    expect(panel.textContent).not.toMatch(/node:status|run:started|ungrounded|loop-cap-reached|executor refused|run-mn0p1q|prog-sweep/);
    expect(screen.queryAllByTestId(ACTIVITY.detailEvent)).toHaveLength(0);
    expect(screen.queryByTestId('activity-details')).toBeNull();
    const toggle = screen.getByTestId('activity-details-toggle');
    expect(toggle.textContent).toBe('Details');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.ac-event-type')).toBeNull();

    // Open: the raw detail is there, exactly as the engine wrote it.
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const details = screen.getByTestId('activity-details');
    expect(details.textContent).toContain('run-mn0p1q-0123abcd');
    expect(details.textContent).toContain('prog-sweep');
    expect(details.textContent).toContain('ungrounded node id: svc:invented');
    expect(details.textContent).toContain('loop-cap-reached');
    expect(details.textContent).toContain('the executor refused: no model configured');
    expect(screen.getAllByTestId(ACTIVITY.detailEvent).map((e) => e.dataset.eventType)).toContain('node:status');

    // And closing it hides them again.
    fireEvent.click(toggle);
    expect(screen.queryByTestId('activity-details')).toBeNull();
  });

  it('the control chip says what it means, not "Commandable"/"Locked"', () => {
    opened();
    const chip = screen.getByTestId('activity-run-control');
    expect(chip.textContent).toBe('Controls available');
    cleanup();
    const base = detail({ status: 'completed' });
    pane({ runs: [summary({ status: 'completed' })], openId: base.run.runId, open: base });
    expect(screen.getByTestId('activity-run-control').textContent).toBe('Read only');
  });
});

describe('no engine words in the loading, empty, error and graph states either', () => {
  const props = { now: NOW, filter: 'all' as const, onFilter: () => undefined, onOpen: () => undefined, onCloseRun: () => undefined };
  it('loading, unanswered, empty and refused states', () => {
    for (const over of [
      { runs: null, loading: true },
      { runs: null },
      { runs: [] },
      { runs: null, failure: 'no repository attached' },
      { runs: [summary()], filter: 'blocked' as const },
    ]) {
      const { container } = render(<ActivityPane {...props} {...over} />);
      expect(container.textContent ?? '', JSON.stringify(over)).not.toMatch(ENGINE_WORDS);
      cleanup();
    }
    const { container } = render(<ActivityPane {...props} runs={null} />);
    expect(container.textContent).toContain('Couldn’t load runs. Try Refresh.');
  });
  it('the opened run while loading or unanswered', () => {
    for (const loading of [true, false]) {
      const { container } = render(<ActivityPane {...props} runs={[summary()]} openId="x" open={null} openLoading={loading} />);
      expect(container.textContent ?? '').not.toMatch(ENGINE_WORDS);
      cleanup();
    }
  });
  it('the run graph labels steps by title only: no machine kind (start, agent, checker) in text or tooltip', () => {
    const base = detail();
    const { container } = render(<ActivityPane {...props} runs={[summary()]} openId={base.run.runId} open={base} />);
    const nodes = [...container.querySelectorAll('[data-testid="activity-graph-node"]')];
    expect(nodes.length).toBe(3);
    for (const n of nodes) {
      expect((n.textContent ?? '').toLowerCase()).not.toMatch(/\b(start|agent|checker)\b.*\b(start|agent|checker)\b/);
      expect(n.querySelector('.ac-gnode-k')).toBeNull();
      expect(n.getAttribute('title')).not.toMatch(/\((start|agent|checker)\)/);
    }
    expect(nodes[2]!.getAttribute('title')).toBe('Check the claims: Not started');
  });
});

describe('robustness and small honesty points', () => {
  it('an unknown future status draws a muted fallback row with the raw status as its word, and does not crash', () => {
    const odd = summary({ status: 'quarantined' as unknown as ProgramRunStatus });
    pane({ runs: [odd] });
    const row = screen.getByTestId(ACTIVITY.row);
    expect(within(row).getByTestId(ACTIVITY.rowState).textContent).toBe('quarantined');
    expect(row.dataset.tone).toBe('neutral');
    cleanup();
    const base = detail();
    pane({ runs: [odd], openId: odd.runId, open: { ...base, run: { ...base.run, status: odd.status } } });
    expect(screen.getByTestId('activity-run-control').textContent).toBe('Read only');
  });
  it('Start run is disabled with a plain reason when told no agent is connected, enabled otherwise', () => {
    pane({ runs: [], authoring: true, onStart: () => undefined, onAuthorCancel: () => undefined, startBlockedReason: 'Connect an agent first' });
    const start = screen.getByTestId(ACTIVITY.authorStart) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.title).toBe('Connect an agent first');
    cleanup();
    pane({ runs: [], authoring: true, onStart: () => undefined, onAuthorCancel: () => undefined });
    fireEvent.change(screen.getByTestId(ACTIVITY.authorInstruction), { target: { value: 'tidy the docs' } });
    expect((screen.getByTestId(ACTIVITY.authorStart) as HTMLButtonElement).disabled).toBe(false);
  });
  it('the headline adds up to the tabs: "1 paused, 1 interrupted"', () => {
    const { container } = pane();
    expect(container.querySelector('.ac-needs')?.textContent).toBe('1 paused, 1 interrupted');
  });
  it('a long workflow name carries its full text in a title', () => {
    const name = 'Review every pull request that touches the billing service and summarise the risks';
    pane({ runs: [summary({ programName: name })] });
    expect(screen.getByTestId(ACTIVITY.rowProgram).getAttribute('title')).toBe(name);
  });
  it('the facts after the word are one line, so no dot is stranded at a wrapped line start', () => {
    const css = readFileSync(resolve(__dirname, 'activity.css'), 'utf8');
    expect(css).toMatch(/\.ac-scope \.ac-meta \{\s*flex-wrap: nowrap;/);
  });
});
