import fs from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SSE_GOLDEN, replayFetch } from '../../test/support/replaySse';
import { createAgentRunStore } from '../agents/agentRuns';
import { REF_INSTRUCTION, promptWithRefs } from '../askInPlace/untrustedRefs';
import '../tokens/graphite.css';
import './chat.css';
import { AgentRunsList } from './AgentRunThread';
import { assistantTurn, userTurn } from './fixtures';
import { Transcript } from './Transcript';

/**
 * WHAT THE READER POINTED AT ON A BOARD, IN THE CHAT (askInPlace/).
 *
 * The transcript shows the chip on the user's message; the agent prompt
 * receives the structured block. Two roads lead to a message (the engine's ask
 * and a connected coding agent), so both are locked.
 */

const BLOCK = '[whiteboard selection: 2 items the user pointed at; ids are the ones the board tools take]\n- r1 | rect | "Model"\n- a1 | arrow | (no label)\n[/selection]';
const CHIP = { id: 'board-ref:whiteboard:r1,a1', kind: 'board-ref' as const, ref: 'r1,a1', label: '2 items: Model, arrow', nodeKind: null, detail: BLOCK };

describe('the ask road: the user message carries the chip', () => {
  it('shows the board reference under the words, with the block as its title', () => {
    render(<Transcript turns={[userTurn('u1', 'fix the arrow into Tool call', { chips: [CHIP] }), assistantTurn('a1', 'u1', { text: 'Done.' })]} inFlight={null} />);
    const chip = screen.getByTestId('chat-user-ref');
    expect(chip.textContent).toBe('2 items: Model, arrow');
    expect(chip.getAttribute('title')).toBe(BLOCK);
    expect(chip.closest('[data-testid="chat-user-bubble"]')).not.toBeNull();
  });

  it('shows nothing extra on a message whose chips are repository context', () => {
    const node = { id: 'node:svc', kind: 'node' as const, ref: 'svc', label: 'gateway', nodeKind: null };
    render(<Transcript turns={[userTurn('u1', 'what is this', { chips: [node] })]} inFlight={null} />);
    expect(screen.queryByTestId('chat-user-ref')).toBeNull();
  });
});

describe('the agent road: the run carries the chip, the agent gets the block', () => {
  const resumed = (): Record<string, unknown>[] =>
    fs
      .readFileSync(path.join(SSE_GOLDEN, '..', 'sse-s1', 'resume-after-restart.sse.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  it('shows the words as the prompt and the reference as a chip', async () => {
    const { fetch } = replayFetch(resumed());
    const store = createAgentRunStore({ clock: () => 1000, fetch });
    const run = await store.start({ question: 'tidy this loop', sessionId: 'chat-1', refs: [{ label: CHIP.label, block: BLOCK }] }, fetch);
    expect(run.prompt).toBe('tidy this loop');
    expect(run.refs).toEqual([{ label: '2 items: Model, arrow', block: BLOCK }]);
    render(<AgentRunsList runs={[run]} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('chat-user-ref').textContent).toBe('2 items: Model, arrow');
  });

  it('sends the agent the words followed by the block, wrapped as untrusted data, so it can act on exactly those items', async () => {
    const { fetch, calls } = replayFetch(resumed());
    const store = createAgentRunStore({ clock: () => 1000, fetch });
    await store.start({ question: 'tidy this loop', sessionId: 'chat-1', refs: [{ label: CHIP.label, block: BLOCK }] }, fetch);
    const post = calls.find((c) => (c.body as { prompt?: string } | undefined)?.prompt !== undefined)!;
    expect((post.body as { prompt: string }).prompt).toBe(promptWithRefs('tidy this loop', [{ block: BLOCK }]));
    const sent = (post.body as { prompt: string }).prompt;
    expect(sent).toContain(REF_INSTRUCTION);
    expect(sent).toContain(`<untrusted_repo_content>\n${BLOCK}\n</untrusted_repo_content>`);
  });

  it('a run without a reference sends the words alone', async () => {
    const { fetch, calls } = replayFetch(resumed());
    const store = createAgentRunStore({ clock: () => 1000, fetch });
    await store.start({ question: 'just words', sessionId: 'chat-1' }, fetch);
    const post = calls.find((c) => (c.body as { prompt?: string } | undefined)?.prompt !== undefined)!;
    expect((post.body as { prompt: string }).prompt).toBe('just words');
  });
});
