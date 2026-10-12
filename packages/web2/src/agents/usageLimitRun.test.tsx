import fs from 'node:fs';
import path from 'node:path';

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SSE_GOLDEN, replayFetch } from '../../test/support/replaySse';
import { AgentRunsList } from '../chat/AgentRunThread';
import { usageLimitLine } from '../chat/RecoveryCard';
import { createAgentRunStore } from './agentRuns';

/*
 * A SPENT USAGE LIMIT IN THE PAGE: the stream the server sends for the live
 * gate4 Plan turn (analyzer acp-question.test.ts writes it to
 * sse-question/plan-question-usage-limit.sse.jsonl). Codex asked, was
 * answered, then the account's usage limit failed the turn. The run says when
 * the limit resets, in one line, and offers no Retry.
 */

type Json = Record<string, unknown>;

const RESETS_AT = 1791837379 * 1000;

const golden = (): Json[] =>
  fs
    .readFileSync(path.join(SSE_GOLDEN, '..', 'sse-question', 'plan-question-usage-limit.sse.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Json);

describe('usage limit reached', () => {
  it('the run fails as wait-until-reset, says when in one line, and offers no Retry', async () => {
    const { fetch } = replayFetch(golden());
    const store = createAgentRunStore({ clock: () => 1000, fetch });
    const run = await store.start({ question: 'Plan adding rate limiting to the gateway.', access: 'ask', intent: 'plan', sessionId: 'chat-1' }, fetch);
    expect(run.status).toBe('failed');
    expect(run.recovery).toEqual({ kind: 'wait', provider: 'codex', cause: 'usageLimit', resetsAt: RESETS_AT });
    render(<AgentRunsList runs={store.get().runs} repoRoot={null} onAnswer={() => {}} onRetry={() => {}} />);
    const card = screen.getByTestId('agent-recovery');
    expect(card.getAttribute('data-kind')).toBe('wait');
    expect(card.textContent).toMatch(/^Usage limit, resets .*\d{1,2}:36\s?[AP]\.?M\.(Continues then.*)?$/i);
    expect(within(card).queryByTestId('agent-recovery-retry')).toBeNull();
  });

  it('the line names the vendor and the reset date and time; with no time it says only that the limit is reached', () => {
    expect(usageLimitLine('Codex', Date.UTC(2026, 9, 12, 20, 36), 'en-US')).toMatch(/^Codex usage limit reached\. It resets Oct 1[23], 2026, \d{1,2}:36\s?[AP]M\.$/);
    expect(usageLimitLine('Codex', undefined)).toBe('Codex usage limit reached.');
  });
});
