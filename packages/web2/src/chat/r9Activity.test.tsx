import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentRun } from '../agents/agentRuns';
import { AsciiSpinner, SPINNER_FRAMES, SPINNER_STILL } from './ChatStatus';
import { STEP_MS } from '../shell2/ActivityLoader';
import { sessionTokens } from './sessionTokens';
const collector = vi.hoisted(() => vi.fn());
vi.mock('../agents/agentRuns', async importOriginal => ({ ...await importOriginal<object>(), tokenTotalsBySession: collector }));

const run = (over: Partial<AgentRun> & { lastEventAt?: number; stalled?: { since: number; reason: string } | null } = {}): AgentRun => ({
  id: 'r', sessionId: 's', agentRef: 'claude', nodeId: null, nodeLabel: null,
  prompt: 'Fix it', status: 'running', startedAt: 1000, endedAt: null,
  items: [{ kind: 'message', id: 'm', text: 'Reading the code.' }], approvals: [], error: null, ...over,
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('holds the spinner while the tab is hidden and for reduced motion, resumes visibly', () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const { unmount } = render(<AsciiSpinner />);
  const glyph = () => screen.getByTestId('s2-ascii-spinner').textContent;
  act(() => void vi.advanceTimersByTime(STEP_MS));
  expect(glyph()).toBe(SPINNER_FRAMES[1]);
  hidden.mockReturnValue(true);
  act(() => void vi.advanceTimersByTime(900));
  expect(glyph()).toBe(SPINNER_FRAMES[1]);
  hidden.mockReturnValue(false);
  act(() => void vi.advanceTimersByTime(STEP_MS));
  expect(glyph()).not.toBe(SPINNER_FRAMES[1]);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
  render(<AsciiSpinner />);
  act(() => void vi.advanceTimersByTime(900));
  expect(glyph()).toBe(SPINNER_STILL);
  expect(screen.getByTestId('s2-ascii-spinner').getAttribute('data-still')).toBe('true');
  vi.unstubAllGlobals();
});

it('delegates session totals to the runtime collector without counting context', () => {
  const tokens = { scope: 'turn' as const, inputTokens: 20, outputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0 };
  const runs = [Object.assign(run(), { tokens }), Object.assign(run(), { id: 'r2', tokens }), run()];
  collector.mockReturnValue({ s: { inputTokens: 50, outputTokens: 15, cachedReadTokens: 13, cachedWriteTokens: 0 } });
  expect(sessionTokens(runs, 's')).toEqual({ input: 50, output: 15, cache: 13, measured: 2, turns: 3 });
  expect(collector).toHaveBeenCalledWith(runs);
  collector.mockReturnValue({});
  expect(sessionTokens([run()], 's')).toBeNull();
});

it('retains input/output when cache is unavailable, never substitutes context usage', () => {
  const r = Object.assign(run(), { tokens: { scope: 'turn' as const, inputTokens: 20, outputTokens: 10, cachedReadTokens: null, cachedWriteTokens: null }, usage: { used: 9999, size: 10000, cost: null } });
  collector.mockReturnValue({ s: r.tokens });
  expect(sessionTokens([r], 's')).toEqual({ input: 20, output: 10, cache: null, measured: 1, turns: 1 });
});

it('uses shared cumulative thread totals rather than summing live samples', () => {
  const first = Object.assign(run(), { tokens: { scope: 'thread' as const, threadId: 't', inputTokens: 20, outputTokens: 10, cachedReadTokens: null, cachedWriteTokens: null } });
  const second = Object.assign(run(), { id: 'r2', tokens: { scope: 'thread' as const, threadId: 't', inputTokens: 30, outputTokens: 15, cachedReadTokens: 5, cachedWriteTokens: null } });
  collector.mockReturnValue({ s: second.tokens });
  expect(sessionTokens([first, second], 's')).toEqual({ input: 30, output: 15, cache: null, measured: 2, turns: 2 });
  expect(collector).toHaveBeenCalledWith([first, second]);
});
