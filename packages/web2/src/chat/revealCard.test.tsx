import fs from 'node:fs';
import path from 'node:path';

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../agents/agentRunFold';
import { createAgentRunStore, type AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { replayFetch } from '../../test/support/replaySse';
import { AgentRunView, resetKeptOpen, resetRevealedQuestions } from './AgentRunThread';
import { revealCardTop, revealScroll, STICKY_ATTR, stickyOffset } from './revealCard';
import { HOLD_EVENT, SCROLLER_ATTR } from './transcriptNav';
import { rowIndexOf, transcriptRows } from './VirtualTranscript';

/*
 * THE QUESTION CARD'S TOP, BELOW THE STICKY HEADER.
 *
 * The 2026-10-06 shot had the card's first question under the agent's sticky
 * header. jsdom has no layout, so this tests the offset (the header's own
 * measured height, never a number in the code) and the call (scroll the
 * card's TOP into view, with that margin), on arrival and through the
 * virtualized list's reveal.
 */

type Json = Record<string, unknown>;

const GOLDEN = path.resolve(__dirname, '..', '..', '..', 'acp', 'src', 'test', 'fixtures', 'replay', 'sse-question', 'plan-question.sse.jsonl');
const events = (): Json[] =>
  fs
    .readFileSync(GOLDEN, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Json);

const rect = (top: number, height: number): DOMRect => ({ height, width: 300, top, left: 0, right: 300, bottom: top + height, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

/** A scroller at `scrollerTop` holding a sticky header `h` px tall that sticks `pad` px down, as the chat column draws it. */
function scrollerWithHeader(h: number | null, scrollerTop = 0, pad = 0): { scroller: HTMLElement; done: () => void } {
  const scroller = document.createElement('div');
  scroller.setAttribute(SCROLLER_ATTR, '');
  scroller.getBoundingClientRect = () => rect(scrollerTop, 600);
  if (h !== null) {
    const header = document.createElement('div');
    header.setAttribute(STICKY_ATTR, '');
    header.getBoundingClientRect = () => rect(scrollerTop + pad, h);
    scroller.appendChild(header);
  }
  document.body.appendChild(scroller);
  return { scroller, done: () => scroller.remove() };
}

async function askedRun(): Promise<AgentRun> {
  const all = events();
  const at = all.findIndex((e) => e.type === 'acp:question' && e.pending === true);
  const { fetch } = replayFetch(all.slice(0, at + 1));
  const store = createAgentRunStore({ clock: () => 1000, fetch });
  return store.start({ question: 'Plan', access: 'ask', intent: 'plan' }, fetch);
}

/* jsdom has no scrollIntoView: give the prototype one to spy on, and take it away after. */
const hadScroll = 'scrollIntoView' in HTMLElement.prototype;
if (!hadScroll) (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = function () {};

afterEach(() => {
  resetKeptOpen();
  resetRevealedQuestions();
  vi.restoreAllMocks();
});

describe('revealCardTop', () => {
  it("scrolls the card's top into view with a scroll margin equal to the sticky header's measured height, and stops following the end", () => {
    for (const h of [33, 48]) {
      const { scroller, done } = scrollerWithHeader(h);
      const card = document.createElement('section');
      scroller.appendChild(card);
      const calls: unknown[] = [];
      card.scrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => void calls.push(arg);
      const held = vi.fn();
      scroller.addEventListener(HOLD_EVENT, held);
      expect(stickyOffset(scroller)).toBe(h);
      expect(revealCardTop(card)).toBe(h);
      expect(card.style.scrollMarginTop).toBe(`${h}px`);
      expect(calls).toEqual([{ block: 'start', behavior: 'smooth' }]);
      expect(held).toHaveBeenCalledTimes(1);
      done();
    }
  });

  it("counts the scroller's padding above a stuck header: a 32 px header 20 px down covers 52 px (the fix shot's layout)", () => {
    const { scroller, done } = scrollerWithHeader(32, 80, 20);
    const card = document.createElement('section');
    scroller.appendChild(card);
    card.scrollIntoView = () => {};
    expect(revealCardTop(card)).toBe(52);
    expect(card.style.scrollMarginTop).toBe('52px');
    done();
  });

  it('with no sticky header the margin is 0', () => {
    const { scroller, done } = scrollerWithHeader(null);
    const card = document.createElement('section');
    scroller.appendChild(card);
    card.scrollIntoView = () => {};
    expect(revealCardTop(card)).toBe(0);
    expect(card.style.scrollMarginTop).toBe('0px');
    done();
  });

  it("the virtualized list's reveal puts the row's top below the header for align top, and centres otherwise", () => {
    expect(revealScroll(7, 'top', 33)).toEqual({ index: 7, animated: true, viewPosition: 0, viewOffset: 33 });
    expect(revealScroll(7, undefined, 33)).toEqual({ index: 7, animated: true, viewPosition: 0.5 });
  });
});

describe('a question that arrives (live-recorded request)', () => {
  it('is brought into view by its top, below the sticky header, once', async () => {
    const run = await askedRun();
    const { scroller, done } = scrollerWithHeader(33);
    const seen: { id: string; margin: string; arg: unknown }[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement, arg?: boolean | ScrollIntoViewOptions) {
      seen.push({ id: this.id, margin: this.style.scrollMarginTop, arg });
    });
    const v = render(<AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} onQuestion={() => {}} />, { container: scroller.appendChild(document.createElement('div')) });
    const id = run.questions![0]!.requestId;
    expect(seen).toEqual([{ id: `agcard-${id}`, margin: '33px', arg: { block: 'start', behavior: 'smooth' } }]);
    v.rerender(<AgentRunView run={run} now={2000} repoRoot={null} onAnswer={() => {}} onQuestion={() => {}} />);
    expect(seen).toHaveLength(1);
    v.unmount();
    done();
  });

  it('an already settled question is not scrolled to', async () => {
    const run = await askedRun();
    const settled: AgentRun = { ...run, questions: run.questions!.map((q) => ({ ...q, settled: true, answeredBy: 'person' as const })) };
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(<AgentRunView run={settled} now={1000} repoRoot={null} onAnswer={() => {}} />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("in a long (virtualized) chat the reveal finds the question's row", async () => {
    const run = await askedRun();
    const rows = transcriptRows([], [run], null, []);
    const at = rowIndexOf(rows, { runId: run.id, requestId: run.questions![0]!.requestId, align: 'top' });
    expect(at).toBeGreaterThan(-1);
    const row = rows[at]!;
    expect(row.kind === 'run-group' && row.group.some((i) => i.kind === 'question')).toBe(true);
    void ({} as RunNodeEvent);
  });
});
