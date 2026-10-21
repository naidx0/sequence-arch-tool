import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CONTEXT_FULL_AT, CONTEXT_WARN_AT } from './ContextRing';
import { AUTO_COMPACT_FULL_AT, AUTO_COMPACT_WARN_AT } from '../agents/agentRuns';
import { CompactNotice, compactNoticeText, type CompactNoticeRun } from './CompactNotice';

const run = (over: Partial<CompactNoticeRun> = {}): CompactNoticeRun => ({ id: 'c', status: 'done', error: null, items: [], summarizedTurns: 12, ...over });

describe('the compaction line', () => {
  it('says how many earlier turns were summarized', () => {
    expect(compactNoticeText(run())).toBe('Conversation compacted: 12 earlier turns summarized');
    expect(compactNoticeText(run({ summarizedTurns: 1 }))).toBe('Conversation compacted: 1 earlier turn summarized');
    expect(compactNoticeText(run({ summarizedTurns: undefined }))).toBe('Conversation compacted: earlier turns summarized');
  });
  it('is honest when it is running, failed or stopped', () => {
    expect(compactNoticeText(run({ status: 'running' }))).toBe('Compacting the conversation');
    expect(compactNoticeText(run({ status: 'failed', error: 'Compaction failed: agent exited. The conversation is unchanged.' }))).toMatch(/unchanged/);
    expect(compactNoticeText(run({ status: 'failed', stopped: true, error: 'Stopped.' }))).toBe('Compaction stopped. The conversation is unchanged.');
  });
  it('shows the summary behind a button, only when the agent left one', () => {
    const { rerender } = render(<CompactNotice run={run()} />);
    expect(screen.queryByTestId('compact-notice-toggle')).toBeNull();
    rerender(<CompactNotice run={run({ items: [{ kind: 'message', id: 'm0', text: 'The API moved to v2.' }] })} />);
    expect(screen.queryByTestId('compact-notice-summary')).toBeNull();
    fireEvent.click(screen.getByTestId('compact-notice-toggle'));
    expect(screen.getByTestId('compact-notice-summary').textContent).toBe('The API moved to v2.');
    expect(screen.getByTestId('compact-notice-toggle').textContent).toBe('Hide summary');
  });
  it('uses no middle dot', () => {
    const { container } = render(<CompactNotice run={run()} />);
    expect(container.textContent).not.toContain('\u00b7');
  });
});

describe('the auto compact lines match the context ring', () => {
  it('warn and full are the ring\'s', () => {
    expect(AUTO_COMPACT_WARN_AT).toBe(CONTEXT_WARN_AT);
    expect(AUTO_COMPACT_FULL_AT).toBe(CONTEXT_FULL_AT);
  });
});
