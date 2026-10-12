import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentRun } from '../agents/agentRuns';
import type { Turn } from '../state/types';
import { DecisionCard } from './DecisionCard';
import { composeAnswer, detectDecisions, planFromText, planRowsFromEntries } from './decisionModel';
import { latestDecision } from './decisionSource';
import { keptOpen } from './keptOpen';

/* G6: a finished turn that ends with questions or options gets a card whose chips answer them.
   Positive controls: each shape the agents really write. Negative controls: answers that must NOT get a card. */

const QUESTIONS = `I read the cache layer. Before I change it I need two decisions.

1. Should the cache be per user or shared?
2. Keep the old \`/v1/items\` route? (yes / no)
3. Which store: **SQLite** or Redis?

Tell me and I will start.`;

const OPTIONS = `There are three ways to do this. Which would you prefer?

- **Option A** - patch the parser in place
- **Option B** - rewrite the tokenizer
- **Option C** - leave it and add a test`;

describe('detectDecisions', () => {
  it('reads numbered questions with their inline options', () => {
    const d = detectDecisions(QUESTIONS)!;
    expect(d.kind).toBe('questions');
    expect(d.questions.map((q) => q.n)).toEqual([1, 2, 3]);
    /* a should-question with no written options is yes or no */
    expect(d.questions[0]!.options.map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(d.questions[1]!.options.map((o) => o.label)).toEqual(['yes', 'no']);
    expect(d.questions[2]!.options.map((o) => o.label)).toEqual(['SQLite', 'Redis']);
  });

  it('reads a lead line and a list of options as one question', () => {
    const d = detectDecisions(OPTIONS)!;
    expect(d.kind).toBe('options');
    expect(d.questions).toHaveLength(1);
    expect(d.questions[0]!.text).toMatch(/Which would you prefer\?/);
    expect(d.questions[0]!.options.map((o) => o.label)).toEqual(['Option A', 'Option B', 'Option C']);
    /* a bare "Option A" is sent with what it stands for */
    expect(d.questions[0]!.options[0]!.send).toBe('Option A: patch the parser in place');
  });

  it('reads sub-bullets as the options of a numbered question', () => {
    const d = detectDecisions('Two things first:\n\n1. How should errors surface?\n   - Throw\n   - Return a result\n2. Which runtime?\n   - Node 20\n   - Node 22\n');
    expect(d!.questions.map((q) => q.options.map((o) => o.label))).toEqual([['Throw', 'Return a result'], ['Node 20', 'Node 22']]);
  });

  it('finds nothing in answers that ask nothing', () => {
    expect(detectDecisions('I fixed it.')).toBeNull();
    expect(detectDecisions('Findings:\n\n1. The parser drops tabs\n2. The cache never expires\n3. The route is unused')).toBeNull();
    /* H2 changed this contract: an answer that ENDS with a yes/no question put to the person gets Yes and No
       (a pick and a confirm, so it costs nothing to ignore); a bare question that is not put to them does not. */
    expect(detectDecisions('Do you want me to continue?')!.questions[0]!.options.map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(detectDecisions('Is it fast? Yes.')).toBeNull();
    expect(detectDecisions('Why does it fail?')).toBeNull();
    /* the list is not at the end */
    expect(detectDecisions('1. Should it be shared?\n2. Or per user?\n\nThen I wrote a long paragraph afterwards that goes on and on about the design and what I intend to do next, in detail, at length, so it is no longer the tail of the answer and the questions were already settled before it, with every consequence spelled out. And more words so the closing is long.')).toBeNull();
  });

  it('ignores a list inside a code fence', () => {
    expect(detectDecisions('Run this:\n\n```\n1. Should it be shared?\n2. Per user?\n```')).toBeNull();
    expect(detectDecisions('Run this:\n\n```\n1. Should it be shared?\n2. Per user?')).toBeNull();
  });

  it('composes one answer as itself and several numbered', () => {
    /* M1 changed this contract: each answer travels with its question (see 'M1: what a chip sends'). */
    const d = detectDecisions(QUESTIONS)!;
    expect(composeAnswer(d, { 1: 'Yes' })).toBe('1. Should the cache be per user or shared? Yes');
    expect(composeAnswer(d, {})).toBeNull();
    const one = detectDecisions(OPTIONS)!;
    expect(composeAnswer(one, { 1: 'Option B' })).toBe('Which would you prefer? Option B');
  });

  it('reads the plan an answer writes out in words, and not a list of questions', () => {
    const text = '## Plan\n\n1. Add the cache\n2. Invalidate on write\n3. Test both\n\nThree decisions:\n\n1. Per user or shared?\n2. Keep the old route?';
    expect(planFromText(text).map((r) => r.text)).toEqual(['Add the cache', 'Invalidate on write', 'Test both']);
    expect(planFromText('Questions I have:\n\n1. Which plan do you prefer?\n2. Which approach?')).toEqual([]);
    expect(planFromText('No list here, just a plan in a sentence.')).toEqual([]);
    const a = turn('t1', 'assistant', text, 5);
    expect(latestDecision([a], [], false)!.plan).toHaveLength(3);
  });

  it('maps ACP plan entries to checklist rows', () => {
    expect(planRowsFromEntries([{ content: 'Read it', status: 'completed' }, { content: 'Change it', status: 'in_progress' }, { content: 'Test it', status: 'pending' }, { content: ' ', status: 'pending' }]).map((r) => r.status)).toEqual(['done', 'active', 'pending']);
  });
});

/* H2 (0.1.5 review): ten ordinary answers that must NOT get a card, and five that must. */
const NO: Record<string, string> = {
  n1_summary_findings: `I looked at the auth module. Here is what I found:\n\n1. The token refresh runs on every request.\n2. The cache key ignores the tenant.\n3. Errors are swallowed in middleware.ts.`,
  n2_steps_done: `Done. I made these changes:\n\n- Added a retry to fetchUser\n- Removed the dead export\n- Updated the test\n\nAll 42 tests pass.`,
  n3_rhetorical_question_items: `Why is the build slow? A few reasons:\n\n1. Why does tsc run twice? Because both the root and the package call it.\n2. Is the cache used? No, the cache dir is wiped on CI.\n\nI fixed both.`,
  n4_howto: `To run it locally:\n\n1. Install deps with pnpm install\n2. Build with pnpm -r build\n3. Start with pnpm app\n\nThat's it.`,
  n5_which_explanation: `Which file handles routing? It's repoServer.ts. The relevant handlers are:\n\n- /api/attach\n- /api/detach\n- /api/recent`,
  n6_faq: `Common questions:\n\n- Does it work offline? Yes, everything except the update check.\n- Can I use my own model? Yes, set the provider in Settings.\n- Is my code uploaded? No.`,
  n7_let_me_know_findings: `Let me know if you want me to dig further. The three hotspots are:\n\n1. graphCache.ts\n2. askPipeline.ts\n3. terminal.ts`,
  n8_plan_no_question: `Here is my plan:\n\n1. Read the schema\n2. Add the migration\n3. Write the test\n\nStarting now.`,
  n9_options_comparison_no_ask: `What are the options for state management? There are several:\n\n- Redux: mature, verbose\n- Zustand: small, hooks-first\n- Jotai: atomic\n\nWe already use Zustand in web2, so I kept it.`,
  n10_trailing_question_items_answered: `Review notes:\n\n1. Should this be async? It already is, fine.\n2. Is the lock released on error? Yes, in the finally.\n3. Does it leak the handle? No.\n\nLooks good to merge.`,
};
const YES: Record<string, { text: string; questions: number }> = {
  y1: { text: `I can fix this two ways. Which do you prefer?\n\n1. **Patch the parser** - smallest diff\n2. **Rewrite the tokenizer** - cleaner, larger`, questions: 1 },
  y2: { text: `Before I start, a few questions:\n\n1. Should the cache be per user?\n2. Keep the old route or remove it?\n3. Which database (Postgres / SQLite)?`, questions: 3 },
  y3: { text: `Plan:\n\n1. Add the endpoint\n2. Wire the client\n3. Ship\n\nShould I go ahead with this plan?\n\n- Yes, go\n- No, change it first`, questions: 1 },
  y4: { text: `Do you want me to also update the docs?`, questions: 1 },
  y5: { text: `Pick the layout:\n\na) Vertical stack\nb) Two columns\nc) Tabs`, questions: 1 },
};

describe('H2: a card only when the answer ends by asking', () => {
  for (const [k, v] of Object.entries(NO)) {
    it(`no card: ${k}`, () => {
      expect(detectDecisions(v)).toBeNull();
    });
  }
  for (const [k, v] of Object.entries(YES)) {
    it(`a card: ${k}`, () => {
      const d = detectDecisions(v.text);
      expect(d).not.toBeNull();
      expect(d!.questions).toHaveLength(v.questions);
      for (const q of d!.questions) expect(q.options.length).toBeGreaterThanOrEqual(2);
    });
  }
  it('what/which in a lead asks only when the lead ends with "?"', () => {
    expect(detectDecisions('Here is which files changed:\n\n- a.ts\n- b.ts')).toBeNull();
    expect(detectDecisions('Which files should I change?\n\n- a.ts\n- b.ts')).not.toBeNull();
  });
  it('a question followed by more sentences is not the ask', () => {
    expect(detectDecisions('Should I keep going? I already did, and it passes.')).toBeNull();
    expect(detectDecisions('Which do you prefer?\n\n1. A thing\n2. B thing\n\nI went with A, it is done.')).toBeNull();
  });
});

describe('M1: what a chip sends', () => {
  it('sends the whole option, not the shortened chip label', () => {
    const long = 'Move the cache into a per-tenant map keyed by the session id so that two users never see each other\'s entries, then drop the global';
    const d = detectDecisions(`Which approach should I take?\n\n1. ${long}\n2. Keep the global cache`)!;
    const o = d.questions[0]!.options[0]!;
    expect(o.label.length).toBeLessThanOrEqual(70);
    expect(o.send).toBe(long);
  });

  it('an either/or question keeps its verb on both sides, and is not Yes/No', () => {
    const y2 = detectDecisions(YES.y2!.text)!;
    expect(y2.questions[1]!.options.map((o) => o.send)).toEqual(['Keep the old route', 'Remove it']);
    const ship = detectDecisions('One thing to settle:\n\n1. Should we ship today or wait for the review on Monday?')!;
    expect(ship.questions[0]!.options.map((o) => o.send)).toEqual(['Ship today', 'Wait for the review on Monday']);
    /* the shapes that already worked still do */
    expect(detectDecisions(QUESTIONS)!.questions[2]!.options.map((o) => o.send)).toEqual(['SQLite', 'Redis']);
  });

  it('the answer sent carries each question with its answer', () => {
    const d = detectDecisions(QUESTIONS)!;
    expect(composeAnswer(d, { 1: 'Yes', 3: 'SQLite' })).toBe('1. Should the cache be per user or shared? Yes\n3. Which store: SQLite or Redis? SQLite');
    const one = detectDecisions(OPTIONS)!;
    expect(composeAnswer(one, { 1: 'Option B: rewrite the tokenizer' })).toBe('Which would you prefer? Option B: rewrite the tokenizer');
  });

  it('chips with the same label are distinct buttons (keys are not labels)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const set = { kind: 'options' as const, lead: null, questions: [{ n: 1, text: 'Which one?', options: [{ label: 'Same start...', detail: null, send: 'Same start, then one' }, { label: 'Same start...', detail: null, send: 'Same start, then two' }] }] };
    const onSend = vi.fn();
    render(<DecisionCard source={{ id: 'turn:dup', set, plan: [] }} onSend={onSend} />);
    expect(screen.getAllByTestId('decision-option')).toHaveLength(2);
    expect(errors.mock.calls.some((c) => /same key/i.test(String(c[0])))).toBe(false);
    fireEvent.click(screen.getAllByTestId('decision-option')[1]!);
    fireEvent.click(screen.getByTestId('decision-send'));
    expect(onSend).toHaveBeenCalledWith('Which one? Same start, then two');
    errors.mockRestore();
    keptOpen.clear();
  });
});

const turn = (id: string, role: 'user' | 'assistant', text: string, at: number): Turn => ({ id, role, text, at, todos: [], work: [], evidence: { tools: [] }, chips: [] }) as unknown as Turn;
const run = (over: Partial<AgentRun>): AgentRun =>
  ({ id: 'r1', sessionId: 's', agentRef: 'codex', nodeId: null, nodeLabel: null, prompt: 'p', status: 'done', startedAt: 10, endedAt: 20, items: [], approvals: [], error: null, ...over }) as AgentRun;

describe('latestDecision', () => {
  it('reads Sequence\'s last answer, and not once the person has replied or a turn runs', () => {
    const a = turn('t2', 'assistant', OPTIONS, 20);
    expect(latestDecision([turn('t1', 'user', 'how?', 10), a], [], false)?.id).toBe('turn:t2');
    expect(latestDecision([a, turn('t3', 'user', 'B', 30)], [], false)).toBeNull();
    expect(latestDecision([a], [], true)).toBeNull();
  });

  it('reads the agent run\'s last message and its plan; an open question or approval holds it back', () => {
    const items = [
      { kind: 'plan', id: 'p', entries: [{ content: 'Step one', status: 'completed' }, { content: 'Step two', status: 'pending' }], startedAt: 1, endedAt: 2 },
      { kind: 'message', id: 'm', text: QUESTIONS },
    ] as AgentRun['items'];
    const src = latestDecision([turn('t1', 'user', 'go', 5)], [run({ items })], false)!;
    expect(src.id).toBe('run:r1');
    expect(src.plan.map((p) => p.text)).toEqual(['Step one', 'Step two']);
    expect(latestDecision([], [run({ items, status: 'running' })], false)).toBeNull();
    expect(latestDecision([], [run({ items, approvals: [{ decision: null } as never] })], false)).toBeNull();
    /* work after the words means the words were not the ending */
    expect(latestDecision([], [run({ items: [...items, { kind: 'tool', id: 't', title: 'x' } as never] })], false)).toBeNull();
  });
});

describe('DecisionCard', () => {
  afterEach(() => keptOpen.clear());
  const source = (text: string, plan = [] as ReturnType<typeof planRowsFromEntries>) => ({ id: 'turn:x', set: detectDecisions(text)!, plan });

  it('H2: a single question is a pick and then a confirm; one stray click sends nothing', () => {
    const onSend = vi.fn();
    render(<DecisionCard source={source(OPTIONS)} onSend={onSend} />);
    const send = screen.getByTestId('decision-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getAllByTestId('decision-option')[1]!);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('decision-option')[1]!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(String(onSend.mock.calls[0]![0])).toMatch(/Option B: rewrite the tokenizer$/);
    /* a second click cannot send twice */
    fireEvent.click(screen.getAllByTestId('decision-option')[0]!);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('collects several answers and sends them numbered, once', () => {
    const onSend = vi.fn();
    render(<DecisionCard source={source(QUESTIONS)} onSend={onSend} />);
    const send = screen.getByTestId('decision-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const opts = screen.getAllByTestId('decision-option');
    fireEvent.click(opts[1]!); /* question 1: No */
    fireEvent.click(opts[4]!); /* question 3: SQLite */
    fireEvent.click(opts[4]!); /* un-pick */
    fireEvent.click(opts[5]!); /* question 3: Redis */
    expect(opts[1]!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('1. Should the cache be per user or shared? No\n3. Which store: SQLite or Redis? Redis');
  });

  it('shows the plan steps as a checklist', () => {
    render(<DecisionCard source={source(OPTIONS, planRowsFromEntries([{ content: 'Read it', status: 'completed' }, { content: 'Change it', status: 'pending' }]))} onSend={() => {}} />);
    const rows = screen.getByTestId('decision-plan').querySelectorAll('li');
    expect([...rows].map((r) => r.getAttribute('data-status'))).toEqual(['done', 'pending']);
  });

  it('dismisses with the x and with Escape, and stays dismissed', () => {
    const { unmount } = render(<DecisionCard source={source(OPTIONS)} onSend={() => {}} />);
    fireEvent.click(screen.getByTestId('decision-dismiss'));
    expect(screen.queryByTestId('decision-card')).toBeNull();
    unmount();
    render(<DecisionCard source={source(OPTIONS)} onSend={() => {}} />);
    expect(screen.queryByTestId('decision-card')).toBeNull();
    keptOpen.clear();
    render(<DecisionCard source={source(OPTIONS)} onSend={() => {}} />);
    fireEvent.keyDown(screen.getByTestId('decision-card'), { key: 'Escape' });
    expect(screen.queryByTestId('decision-card')).toBeNull();
  });

  it('picks with a number key when there is one question, and sends only on the confirm; chips are real buttons', () => {
    const onSend = vi.fn();
    render(<DecisionCard source={source(OPTIONS)} onSend={onSend} />);
    for (const b of screen.getAllByTestId('decision-option')) expect(b.tagName).toBe('BUTTON');
    fireEvent.keyDown(screen.getByTestId('decision-card'), { key: '3' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('decision-send'));
    expect(String(onSend.mock.calls[0]![0])).toMatch(/Option C: leave it and add a test$/);
  });

  it('draws nothing when no question has an option to click', () => {
    const set = { kind: 'questions' as const, lead: null, questions: [{ n: 1, text: 'How big is it?', options: [] }] };
    const { container } = render(<DecisionCard source={{ id: 'turn:y', set, plan: [] }} onSend={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
