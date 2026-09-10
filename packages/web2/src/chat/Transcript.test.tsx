import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { resolvedStyle, substituteVars } from '../../test/support/css';
import '../tokens/graphite.css';
import '../styles/base.css';
import './chat.css';
import { Transcript } from './Transcript';
import { assistantTurn, inFlight, userTurn, workRow } from './fixtures';

/**
 * ITEM 2.5 — THE TRANSCRIPT, RENDERED.
 *
 * Sheet 12.1 fixes two asymmetries and the whole lane depends on both:
 *
 *   THE USER SPEAKS IN A BOX, THE ASSISTANT DOES NOT. A request is short, so it
 *   can afford a bubble inset from the right; an answer carries prose, diffs,
 *   cards and paths, so it is plain full-width text with no bubble, no avatar
 *   and no role marker.
 *
 *   WORK IS QUIETER THAN TALK. A tool call is one 26px muted line, never an
 *   expanded log. "The model shows its work; it does not perform it."
 *
 * Both are asserted against RESOLVED token values rather than literals, so the
 * test says "the assistant lane is bound to no surface token" rather than
 * naming a colour — which would pass in one theme and fail in the other for a
 * reason that is not a defect, and would also be a second place a hue is
 * written down. (The firewall enforces the second half of that: it deliberately
 * does NOT strip comments for the hex rule, and it caught this paragraph's
 * first draft.) jsdom does not substitute custom
 * properties; test/support/css.ts supplies the substitution step and nothing
 * else.
 *
 * Cited: docs/brand/graphite/pages/12-the-agentic-surfaces.html §12.1, §12.2.
 */

function token(name: string): string {
  return substituteVars(`var(${name})`, document.documentElement);
}

const TWO_TURNS = [
  userTurn('u1', 'If I change the auth middleware, what breaks?'),
  assistantTurn('a1', 'u1', {
    text: 'Two callers, and only one of them is yours.',
    work: [
      workRow('w1', { group: 'reason', verb: 'Thought for', outcome: { kind: 'elapsed', ms: 7000 } }),
      workRow('w2', { group: 'read', verb: 'Explored 2 files', from: 'file:read' }),
    ],
  }),
];

describe('item 2.5 — the two lanes', () => {
  it('gives the user a bubble on a surface token, inset from the right', () => {
    /*
     * NON-VACUITY FOR THE ASSERTION BELOW. If this test cannot see a background
     * where one is drawn, then "the assistant has no background" proves
     * nothing. The user lane is the control group.
     */
    render(<Transcript turns={TWO_TURNS} inFlight={null} />);

    const bubble = screen.getByTestId('chat-user-bubble');
    expect(resolvedStyle(bubble, 'background-color')).toBe(token('--surface-2'));
    expect(resolvedStyle(bubble, 'align-self')).toBe('flex-end');
    expect(resolvedStyle(bubble, 'max-width')).toBe('82%');
    expect(resolvedStyle(bubble, 'border-radius')).toBe(token('--r-18'));
  });

  it('names restored turns as came-back-from-disk — words only', () => {
    /*
     * Owner Done when (P2): a reload must not look like a live answer that did
     * no work. Structural emptiness alone is silent; the surface says it.
     */
    render(
      <Transcript
        turns={[
          userTurn('restored:0', 'what does scan.ts do'),
          assistantTurn('restored:1', 'restored:0', { text: 'It walks the repo.' }),
        ]}
        inFlight={null}
      />,
    );
    const note = screen.getByTestId('chat-restored');
    expect(note.textContent).toMatch(/Came back from disk/);
    expect(screen.getByTestId('chat-user-bubble').getAttribute('data-restored')).toBe('true');
    expect(screen.getByTestId('chat-prose').getAttribute('data-restored')).toBe('true');
  });

  it('gives the user bubble a hairline border only — no left accent rule', () => {
    render(<Transcript turns={TWO_TURNS} inFlight={null} />);

    const bubble = screen.getByTestId('chat-user-bubble');
    expect(['', '0px', 'medium']).toContain(resolvedStyle(bubble, 'border-left-width'));

    const prose = screen.getByTestId('chat-prose');
    expect(['', '0px', 'medium']).toContain(resolvedStyle(prose, 'border-left-width'));
  });

  it('gives the assistant no bubble, no border, and no role marker', () => {
    render(<Transcript turns={TWO_TURNS} inFlight={null} />);

    const prose = screen.getByTestId('chat-prose');

    // No bubble: nothing paints behind the answer.
    const background = resolvedStyle(prose, 'background-color');
    expect([token('--surface-1'), token('--surface-2'), token('--surface-3')]).not.toContain(
      background,
    );

    // No border, and no 2px accent bar down the side either — sheet 12.1:
    // "the accent would immediately stop meaning anything except 'a message
    // exists'."
    expect(['', '0px', 'medium']).toContain(resolvedStyle(prose, 'border-left-width'));
    expect(['', 'none']).toContain(resolvedStyle(prose, 'border-left-style'));

    /*
     * No avatar, no name. The lane carries the words and nothing else.
     *
     * ASSERTED ON THE PARAGRAPHS, not on the container's textContent. The
     * container also holds the Copy control that sheet 12 line 551 specifies,
     * and folding a control's label into a claim about "no role marker" tests
     * two different things with one string — it broke the day Copy arrived and
     * said nothing true about either.
     */
    const words = [...prose.querySelectorAll('p')].map((p) => p.textContent).join('');
    expect(words).toBe('Two callers, and only one of them is yours.');

    /* And the thing the assertion above was actually about: no label naming
       who spoke. */
    expect(prose.textContent).not.toMatch(/assistant|sequence:|you:/i);
    expect(screen.queryByTestId('chat-role-label')).toBeNull();
    expect(screen.queryByTestId('chat-avatar')).toBeNull();
  });
});

describe('item 2.5 — the tool row does not shout', () => {
  it('is 26px in the muted ink, at the small size, on no surface', () => {
    render(<Transcript turns={TWO_TURNS} inFlight={null} />);
    /* Reasoning disclosure collapses by default — expand to assert row chrome. */
    fireEvent.click(screen.getByTestId('chat-reason-toggle'));

    const rows = screen.getAllByTestId('chat-tool-row');
    expect(rows.length).toBe(2);

    for (const row of rows) {
      // Graphite law 3: tool rows 26px. Airy is a defect.
      expect(resolvedStyle(row, 'height')).toBe('26px');
      // --ink-3, the muted register. Not --ink-1, which is the answer's ink.
      expect(resolvedStyle(row, 'color')).toBe(token('--ink-3'));
      expect(resolvedStyle(row, 'color')).not.toBe(token('--ink-1'));
      expect(resolvedStyle(row, 'font-size')).toBe(token('--t-12'));
      // An unbordered stack row paints nothing behind itself.
      expect(['', 'transparent', 'rgba(0, 0, 0, 0)']).toContain(
        resolvedStyle(row, 'background-color'),
      );
    }
  });

  it('writes the verb in the past tense, exactly as the engine reported it', () => {
    /*
     * Sheet 12.2's Don't: "Exploring 2 files…". A present-progressive row has
     * to be rewritten a second later, "and a transcript that rewrites itself is
     * not a record of anything". The row renders WorkRow.verb verbatim and
     * appends nothing — no ellipsis, no gerund, no live status.
     */
    render(<Transcript turns={TWO_TURNS} inFlight={null} />);
    fireEvent.click(screen.getByTestId('chat-reason-toggle'));

    const rows = screen.getAllByTestId('chat-tool-row');
    for (const row of rows) {
      expect(row.textContent).not.toContain('…');
      expect(row.textContent).not.toContain('...');
      expect(row.textContent).not.toMatch(/\b\w+ing\b/);
    }
    expect(rows.map((r) => r.textContent).join(' ')).toContain('Explored 2 files');
  });

  it('spends no hue on a row that made no claim about a result', () => {
    /*
     * Sheet 12.7: eight tokens carry colour on these surfaces and a tool row is
     * not one of them — the only hue permitted inside a row is the .ok check at
     * --fits, and the exit glyph at --wont. A read row and a reason row have
     * neither, so nothing in them may be coloured.
     */
    render(<Transcript turns={TWO_TURNS} inFlight={null} />);
    fireEvent.click(screen.getByTestId('chat-reason-toggle'));

    const claims = [token('--fits'), token('--wont'), token('--spills'), token('--info'), token('--accent')];
    for (const row of screen.getAllByTestId('chat-tool-row')) {
      const painted = [row, ...Array.from(row.querySelectorAll('*'))];
      for (const el of painted) {
        expect(claims).not.toContain(resolvedStyle(el, 'color'));
      }
    }
  });
});

describe('item 2.5 — a turn always ends in words', () => {
  it('renders a named ending rather than a blank answer', () => {
    render(
      <Transcript
        turns={[
          userTurn('u1', 'fix it'),
          assistantTurn('a1', 'u1', { text: '', work: [workRow('w1', { group: 'run', verb: 'Ran the suite' })] }),
        ]}
        inFlight={null}
      />,
    );

    const ending = screen.getByTestId('chat-ending');
    expect(ending.textContent?.trim().length).toBeGreaterThan(0);
    // It is a record, not an alarm: the muted register, no verdict hue.
    expect(resolvedStyle(ending, 'color')).toBe(token('--ink-3'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   COPY A MESSAGE — sheet 12 line 551 specifies this control:
   `<button class="iconbtn" aria-label="Copy">` with `#ic-copy`.

   Before it, the only way an answer left this product was dragging a mouse
   across a scrolling column. There were zero clipboard calls anywhere in the
   package.
   ══════════════════════════════════════════════════════════════════════════ */
describe('copying an answer', () => {
  function withClipboard(impl: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: impl },
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('copies the message text, and says it did', async () => {
    const copied: string[] = [];
    withClipboard(async (text) => void copied.push(text));

    render(<Transcript turns={TWO_TURNS} inFlight={null} />);
    fireEvent.click(screen.getByTestId('chat-copy'));

    await waitFor(() => {
      expect(copied).toEqual(['Two callers, and only one of them is yours.']);
      expect(screen.getByTestId('chat-copy').getAttribute('data-said')).toBe('done');
    });
  });

  it('SAYS SO WHEN IT CANNOT COPY, rather than claiming it did', async () => {
    /*
     * `navigator.clipboard` is absent on an insecure origin and can be denied
     * by permission policy. A button that always flashed "Copied" would lie in
     * exactly the case the reader most needs the truth — they would paste
     * nothing and have no idea why.
     */
    withClipboard(async () => {
      throw new Error('denied');
    });

    render(<Transcript turns={TWO_TURNS} inFlight={null} />);
    fireEvent.click(screen.getByTestId('chat-copy'));

    await waitFor(() => {
      const btn = screen.getByTestId('chat-copy');
      expect(btn.getAttribute('data-said')).toBe('failed');
      expect(btn.textContent).toMatch(/cannot copy/i);
    });
  });

  it('says so when there is no clipboard API at all', async () => {
    /* Not a rejected promise — the object simply is not there. */
    render(<Transcript turns={TWO_TURNS} inFlight={null} />);
    fireEvent.click(screen.getByTestId('chat-copy'));
    await waitFor(() =>
      expect(screen.getByTestId('chat-copy').getAttribute('data-said')).toBe('failed'),
    );
  });

  it('offers NO copy control while the answer is still streaming', () => {
    /*
     * Copying half an answer produces a truncated paste the reader will not
     * notice is truncated, and the control would flicker in and out as the
     * text lands.
     */
    render(
      <Transcript
        turns={[]}
        inFlight={{ id: 't1', text: 'Half a sen', work: [], evidence: {}, usage: null } as never}
      />,
    );
    expect(screen.queryByTestId('chat-copy')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE TURN COST.

   A bring-your-own-key product whose tool loop makes several provider calls
   per turn, and no number appeared anywhere. The server summed real usage
   across rounds and streamed it; the store folded it onto the turn; nothing
   rendered it.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the cost of a turn', () => {
  const withUsage = (usage: unknown) =>
    [
      { id: 'u1', role: 'user', text: 'q', intents: [], chips: [], contextLines: [], surface: null, at: 1 },
      {
        id: 'a1',
        role: 'assistant',
        replyTo: 'u1',
        text: 'an answer',
        work: [],
        effect: null,
        coverage: null,
        evidence: {},
        usage,
        at: 2,
      },
    ] as never;

  /*
   * Max, 2026-08-24: "I can see many tokens were used, but I can't see my
   * context window." He was right that it was missing, and the number turned
   * out to matter: the model he runs reports a 1,048,576-token window, so the
   * 76,661-token prompts he was watching used about 7% of it. Without the
   * denominator the figure reads as alarming and means nothing.
   */
  it('draws the denominator when the provider said what it is', () => {
    render(
      <Transcript
        turns={withUsage({ inputTokens: 76_661, outputTokens: 614, estimated: true })}
        inFlight={null}
        contextWindow={1_048_576}
      />,
    );
    expect(screen.getByTestId('chat-usage').textContent).toMatch(/76,661 of 1,048,576 in/);
  });

  it('DRAWS NO METER WHEN THE LIMIT IS UNKNOWN', () => {
    /*
     * The half that matters. Only Ollama reports a real window; no
     * OpenAI-compatible route exposes one. CANON law 4 - never invent a number -
     * makes silence the only honest answer here, and a default ceiling would be
     * precisely the confident wrong figure this product exists to catch.
     */
    for (const unknown of [undefined, null]) {
      const { unmount } = render(
        <Transcript
          turns={withUsage({ inputTokens: 12345, outputTokens: 678, estimated: false })}
          inFlight={null}
          contextWindow={unknown}
        />,
      );
      const text = screen.getByTestId('chat-usage').textContent ?? '';
      expect(text).toMatch(/12,345 in/);
      expect(text).not.toMatch(/ of /);
      unmount();
    }
  });

  it('shows tokens in and out', () => {
    render(
      <Transcript
        turns={withUsage({ inputTokens: 12345, outputTokens: 678, estimated: false })}
        inFlight={null}
      />,
    );
    const usage = screen.getByTestId('chat-usage');
    /* Grouped, because a reader comparing two turns should not have to count
       digits. */
    expect(usage.textContent).toMatch(/12,345/);
    expect(usage.textContent).toMatch(/678/);
  });

  it('SAYS WHEN THE NUMBER IS ESTIMATED', () => {
    /* A counted token and a guessed one are different claims, and a reader
       paying for one of them is entitled to know which they are looking at. */
    render(
      <Transcript
        turns={withUsage({ inputTokens: 10, outputTokens: 2, estimated: true })}
        inFlight={null}
      />,
    );
    const usage = screen.getByTestId('chat-usage');
    expect(usage.getAttribute('data-estimated')).toBe('true');
    expect(usage.textContent).toMatch(/estimated/i);
  });

  it('shows NOTHING when the turn carries no usage', () => {
    /*
     * A turn answered from cache, or interrupted before a provider call, has
     * no cost. Rendering "0 tokens" would be a measurement nobody made.
     */
    render(<Transcript turns={withUsage(null)} inFlight={null} />);
    expect(screen.queryByTestId('chat-usage')).toBeNull();
  });

  it('shows no PRICE, because the client has no rate table', () => {
    /*
     * The server owns the rates and already computes cost with them.
     * Duplicating them here would be a second source of truth that drifts the
     * first time a provider changes one — and a wrong price is worse than no
     * price in a product the user pays for directly.
     */
    render(
      <Transcript
        turns={withUsage({ inputTokens: 10, outputTokens: 2, estimated: false })}
        inFlight={null}
      />,
    );
    expect(screen.getByTestId('chat-usage').textContent).not.toMatch(/[$£€]/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   CODE IN AN ANSWER, RENDERED.

   The parser is tested in proseBlocks.test.ts; these assert it reaches the
   DOM, because a correct parser wired to nothing is the failure pattern this
   whole round has been about.
   ══════════════════════════════════════════════════════════════════════════ */
describe('an answer containing code', () => {
  const withText = (text: string) =>
    [
      { id: 'u1', role: 'user', text: 'q', intents: [], chips: [], contextLines: [], surface: null, at: 1 },
      {
        id: 'a1',
        role: 'assistant',
        replyTo: 'u1',
        text,
        work: [],
        effect: null,
        coverage: null,
        evidence: {},
        usage: null,
        at: 2,
      },
    ] as never;

  it('renders a fence as a code block, not as backticks in a paragraph', () => {
    render(<Transcript turns={withText('Try:\n\n```ts\nconst a = 1;\n```')} inFlight={null} />);
    const code = screen.getByTestId('chat-code');
    expect(code.textContent).toBe('const a = 1;');
    expect(code.getAttribute('data-language')).toBe('ts');
    /* The backticks themselves must not survive into the text. */
    expect(screen.getByTestId('chat-prose').textContent).not.toContain('```');
  });

  it('turns propose_topology JSON into Drawing on Architecture theater when settled', () => {
    const dump =
      '```sequence-tool\n{"id":"d1","name":"propose_topology","args":{"title":"Org","nodes":[],"edges":[]}}\n```';
    render(<Transcript turns={withText(dump)} inFlight={null} />);
    expect(screen.queryByTestId('chat-code')).toBeNull();
    expect(screen.queryByTestId('chat-tool-call-card')).toBeNull();
    const theater = screen.getByTestId('chat-topology-theater');
    expect(theater.getAttribute('data-live')).toBe('false');
    expect(theater.textContent).toMatch(/Drawing on Architecture/);
  });

  it('turns mid-stream json fences with propose_topology into a card', () => {
    const partial =
      'skills are YAML manifests.\n```json\n{"id":"d1","name":"propose_topology","args":{"nodes":[{"id":"proposal:cli","label":"CLI"},{"id":"proposal:ollama"';
    render(<Transcript turns={withText(partial)} inFlight={null} />);
    expect(screen.queryByTestId('chat-code')).toBeNull();
    /* Settled partial dump still shows theater, not a code dump. */
    expect(screen.getByTestId('chat-topology-theater').textContent).toMatch(
      /Drawing on Architecture/,
    );
    expect(screen.getByTestId('chat-prose').textContent).toMatch(/skills are YAML/);
    expect(screen.getByTestId('chat-prose').textContent).not.toMatch(/proposal:cli/);
    expect(screen.getByTestId('chat-prose').textContent).not.toMatch(/"args"/);
  });

  it('shows topology theater while propose_topology streams — not a duplicate tool row', () => {
    const partial =
      '```json\n{"id":"d1","name":"propose_topology","args":{"nodes":[{"id":"proposal:cli"';
    render(
      <Transcript
        turns={[userTurn('u1', 'draw the org')]}
        inFlight={inFlight({
          text: partial,
          phase: 'streaming',
          work: [
            workRow('w1', {
              from: 'tool:start',
              verb: 'Called propose_topology',
              status: 'running',
            }),
          ],
        })}
      />,
    );

    const theater = screen.getByTestId('chat-topology-theater');
    expect(theater.textContent).toMatch(/Drawing on Architecture/);
    expect(theater.textContent).toMatch(/Topology tool called/);
    expect(theater.textContent).toMatch(/Building nodes/);
    expect(screen.queryByTestId('chat-tool-call-card')).toBeNull();
    expect(screen.queryByTestId('chat-tool-row')).toBeNull();
    expect(theater.querySelector('[data-step="nodes"][data-status="running"]')).toBeTruthy();
  });

  it('settled process-sequence dump shows theater, never raw JSON', () => {
    const dump = JSON.stringify({
      kind: 'process-sequence',
      title: 'Local agent harness',
      nodes: [
        { id: 'proposal:core', label: 'Harness Core', kind: 'service' },
        { id: 'proposal:ollama', label: 'Ollama', kind: 'service' },
      ],
      edges: [
        { id: 'e1', from: 'proposal:core', to: 'proposal:ollama', family: 'call' },
      ],
    });
    render(
      <Transcript
        turns={[
          userTurn('u1', 'make a diagram'),
          assistantTurn('a1', 'u1', { text: `Here is the shape.\n${dump}\nDone.` }),
        ]}
        inFlight={null}
      />,
    );
    expect(screen.queryByTestId('chat-code')).toBeNull();
    expect(screen.queryByTestId('chat-tool-call-card')).toBeNull();
    const theater = screen.getByTestId('chat-topology-theater');
    expect(theater.getAttribute('data-live')).toBe('false');
    expect(theater.textContent).toMatch(/Drawing on Architecture/);
    expect(theater.querySelectorAll('[data-status="done"]').length).toBe(4);
    expect(screen.getByTestId('chat-prose').textContent).not.toMatch(/process-sequence/);
    expect(screen.getByTestId('chat-prose').textContent).not.toMatch(/proposal:core/);
  });

  it('renders an inline path as a code chip', () => {
    render(<Transcript turns={withText('open `src/scan.ts` now')} inFlight={null} />);
    expect(screen.getByTestId('chat-tick').textContent).toBe('src/scan.ts');
  });

  it('A CODE BLOCK SCROLLS IN ITS OWN BOX', () => {
    /* A long line inside an answer must never widen the chat column — the
       column is a reading measure and a horizontal scrollbar on the page is
       how it stops being one. */
    render(<Transcript turns={withText('```\n' + 'x'.repeat(400) + '\n```')} inFlight={null} />);
    expect(resolvedStyle(screen.getByTestId('chat-code'), 'overflow-x')).toBe('auto');
  });

  it('LEAVES A DIFF ALONE — no bullets, no emphasis', () => {
    /* The guard's own warning, asserted on the rendered DOM: a removal line is
       not a bullet, and `**` in a glob is not bold. */
    const diff = '- const old = 1;\n+ const next = 2;\nmatch src/**/*.ts';
    render(<Transcript turns={withText(diff)} inFlight={null} />);
    const prose = screen.getByTestId('chat-prose');
    expect(prose.querySelector('li')).toBeNull();
    expect(prose.querySelector('strong')).toBeNull();
    expect(prose.querySelector('em')).toBeNull();
    expect(prose.textContent).toContain('src/**/*.ts');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   REWRITING A QUESTION.

   `send` appends and never mutates, so a typo was permanent — the only remedy
   was to ask a corrected question underneath the wrong one and leave both in
   the thread, where both then went to the model as history.
   ══════════════════════════════════════════════════════════════════════════ */
describe('editing a question', () => {
  it('does not offer an edit control on sent user bubbles', () => {
    render(<Transcript turns={TWO_TURNS} inFlight={null} onEdit={vi.fn()} />);
    expect(screen.queryByTestId('chat-edit')).toBeNull();
  });
});

/* --------------------------------------------------------------------------
   DECISION 7 — THE TRAIL FOLDS INLINE, AND WORK IN PROGRESS IS ALIVE.
   docs/OWNER-PLAN-2026-08-24c.md §1 Decision 7; docs/design-refs/
   tool-trail-detached-vs-inline.html panel B; sheets 12.2/12.3/12.7 as amended.
   -------------------------------------------------------------------------- */
describe('Decision 7 — the tool trail folds inline', () => {
  it('RENDERS THE ROWS INSIDE THE ANSWER BLOCK, not as a sibling trail', () => {
    /*
     * LOCK. Panel B's shape is a DOM fact: each row's nearest answer ancestor
     * is the prose block itself, and no `.toolstack` sits beside the answer
     * in the column any more.
     */
    render(<Transcript turns={TWO_TURNS} inFlight={null} />);
    fireEvent.click(screen.getByTestId('chat-reason-toggle'));

    const prose = screen.getByTestId('chat-prose');
    for (const row of screen.getAllByTestId('chat-tool-row')) {
      expect(row.closest('[data-testid="chat-prose"]')).toBe(prose);
    }

    // The detached grouping is gone: nothing outside the answer holds rows.
    const detached = document.querySelector('.tcol > .toolstack');
    expect(detached).toBeNull();
  });

  it('keeps the four-slot row legible inline — 26px, muted ink, left rule', () => {
    render(<Transcript turns={TWO_TURNS} inFlight={null} />);
    fireEvent.click(screen.getByTestId('chat-reason-toggle'));

    const stack = document.querySelector('[data-testid="chat-prose"] .toolstack');
    expect(stack).not.toBeNull();
    // Panel B: an indented block with a rule on its left edge.
    expect(resolvedStyle(stack as Element, 'border-left-width')).not.toBe('0px');

    for (const row of screen.getAllByTestId('chat-tool-row')) {
      expect(resolvedStyle(row, 'height')).toBe('26px');
      expect(resolvedStyle(row, 'color')).toBe(token('--ink-3'));
    }
  });

  it('keeps the opensrow affordance OUTSIDE and BELOW the answer', () => {
    const turns = [
      userTurn('u1', 'what breaks'),
      assistantTurn('a1', 'u1', {
        text: 'Two callers.',
        work: [workRow('w1', { verb: 'Read the graph' }), workRow('w2', { opens: 'canvas' })],
      }),
    ];
    render(<Transcript turns={turns} inFlight={null} onOpen={() => {}} />);

    const opens = screen.getByTestId('chat-opens-row');
    expect(opens.closest('[data-testid="chat-prose"]')).toBeNull();
    // Narration folded in; the door stays a door.
    expect(screen.getAllByTestId('chat-tool-row').length).toBe(1);
  });

  it('topology proposal opens row calls onOpen(canvas) when pressed', () => {
    const opened: Array<'canvas' | 'ai-canvas' | 'rail' | 'review' | 'browser' | 'terminal'> = [];
    const turns = [
      userTurn('u1', 'add a rate limiter'),
      assistantTurn('a1', 'u1', {
        text: 'I put a limiter in front of the gateway.',
        work: [
          workRow('w1', { verb: 'Read the attached graph' }),
          workRow('w2', {
            group: 'change',
            verb: 'Proposed architecture',
            identifier: 'Add a rate limiter',
            from: 'topology:proposal',
            opens: 'canvas',
            outcome: { kind: 'count', n: 1, unit: 'nodes' },
          }),
        ],
      }),
    ];
    render(
      <Transcript
        turns={turns}
        inFlight={null}
        onOpen={(target) => opened.push(target)}
      />,
    );

    const opens = screen.getByTestId('chat-opens-row');
    expect(opens.textContent).toMatch(/Proposed architecture/);
    expect(opens.textContent).toMatch(/Add a rate limiter/);
    fireEvent.click(opens);
    expect(opened).toEqual(['canvas']);
  });
});

describe('Decision 7 — the living row', () => {
  const LIVE = workRow('w1', {
    status: 'running',
    from: 'file:read',
    verb: 'Read a file',
    identifier: 'session.ts',
  });

  const PROVIDER_LIVE = workRow('w0', {
    status: 'running',
    from: 'provider:start',
    verb: 'Reasoned',
    identifier: null,
    group: 'reason',
  });

  it('shows a live reasoning tool row — braille + wash, no agent bar', () => {
    render(
      <Transcript
        turns={[userTurn('u1', 'go')]}
        inFlight={inFlight({ text: '', phase: 'streaming', work: [PROVIDER_LIVE] })}
        reasoningProvider="ox-alpha"
      />,
    );
    const row = screen.getByTestId('chat-tool-row');
    expect(row.className).toContain('wash');
    expect(row.textContent).toMatch(/Reasoning with ox-alpha/);
    expect(screen.getByTestId('chat-reasoning-glyph').className).toContain('braille');
    expect(screen.queryByTestId('chat-agent-run')).toBeNull();
    expect(screen.queryByTestId('chat-reason-body')).toBeNull();
  });

  it('shows Round k/n · elapsed during a live provider turn (A2.7)', () => {
    const startedAt = Date.now() - 12_000;
    render(
      <Transcript
        turns={[userTurn('u1', 'go')]}
        inFlight={inFlight({
          text: '',
          phase: 'streaming',
          work: [PROVIDER_LIVE],
          providerRound: 1,
          roundCap: 8,
          startedAt,
          lastActivityAt: startedAt + 1_000,
        })}
      />,
    );
    expect(screen.getByTestId('chat-round-timer').textContent).toMatch(/Round 1\/8 · 1\d+s/);
  });

  it('shows a calm provider stall line after quiet (A2.8)', () => {
    const now = Date.now();
    render(
      <Transcript
        turns={[userTurn('u1', 'go')]}
        inFlight={inFlight({
          text: '',
          phase: 'streaming',
          work: [PROVIDER_LIVE],
          providerRound: 1,
          roundCap: 8,
          startedAt: now - 60_000,
          lastActivityAt: now - 35_000,
        })}
      />,
    );
    expect(screen.getByTestId('chat-provider-stall').textContent).toBe('Provider is slow…');
  });

  it('paints the live Round/stall status on the in-flight turn ONLY — never on a landed one (owner, 2026-09-02)', () => {
    /*
     * "On the previous prompt, it's also saying '60 seconds provider lost', so
     * those are synced. The reasoning and taking process for each problem
     * should be independent from the other." One in-flight turn, one derived
     * status — and it was handed to every work stack in the transcript.
     */
    const now = Date.now();
    render(
      <Transcript
        turns={[
          userTurn('u1', 'first question'),
          assistantTurn('a1', 'u1', {
            text: '',
            work: [workRow('w1', { group: 'run', verb: 'Ran the suite' })],
          }),
          userTurn('u2', 'second question'),
        ]}
        inFlight={inFlight({
          turnId: 't2',
          replyTo: 'u2',
          text: '',
          phase: 'streaming',
          work: [PROVIDER_LIVE],
          providerRound: 1,
          roundCap: 8,
          startedAt: now - 60_000,
          lastActivityAt: now - 35_000,
        })}
      />,
    );
    const timers = screen.getAllByTestId('chat-round-timer');
    const stalls = screen.getAllByTestId('chat-provider-stall');
    expect(timers.length, 'one live turn ⇒ one round timer').toBe(1);
    expect(stalls.length, 'one live turn ⇒ one stall line').toBe(1);
    // And it sits AFTER the second question, not on the landed first turn.
    const secondQuestion = screen.getByText('second question');
    expect(secondQuestion.compareDocumentPosition(timers[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides reasoning chrome once prose has arrived', () => {
    render(
      <Transcript
        turns={[userTurn('u1', 'go')]}
        inFlight={inFlight({ text: 'Half a sentence', phase: 'streaming', work: [] })}
      />,
    );
    expect(screen.queryByTestId('chat-agent-run')).toBeNull();
    expect(screen.queryByTestId('chat-reason-fold')).toBeNull();
  });

  it('NAMES the running call in the present progressive, from the real event', () => {
    render(
      <Transcript
        turns={[userTurn('u1', 'go')]}
        inFlight={inFlight({ text: '', phase: 'streaming', work: [LIVE] })}
      />,
    );

    const live = screen.getByTestId('chat-tool-row');
    expect(live.getAttribute('data-live')).toBe('true');
    expect(live.className).not.toContain('wash');
    expect(live.textContent).toContain('Exploring session.ts…');
    expect(live.querySelector('[data-icon="file"]')).toBeTruthy();
    expect(screen.queryByTestId('chat-ascii-load')).toBeNull();
    // And it does not wear the past-tense words at the same time.
    expect(live.textContent).not.toContain('Read a file');
  });

  it('is REPLACED by the past-tense row on landing — never appended', () => {
    const landed = workRow('w1', {
      status: 'done',
      from: 'file:read',
      verb: 'Read a file',
      identifier: 'session.ts',
    });
    const { rerender } = render(
      <Transcript
        turns={[userTurn('u1', 'go')]}
        inFlight={inFlight({ text: '', phase: 'streaming', work: [LIVE] })}
      />,
    );
    rerender(
      <Transcript
        turns={[
          userTurn('u1', 'go'),
          assistantTurn('a1', 'u1', { text: 'Session auth wins.', work: [landed] }),
        ]}
        inFlight={null}
      />,
    );

    const rows = screen.getAllByTestId('chat-tool-row');
    // One row, same slot inside the answer flow — replaced, not appended.
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent).toContain('Read a file');
    expect(rows[0]!.getAttribute('data-live')).toBeNull();
    expect(rows[0]!.closest('[data-testid="chat-prose"]')).not.toBeNull();
    // No live residue anywhere in the transcript.
    expect(screen.getByTestId('chat-transcript').textContent).not.toContain('…');
  });

  it('SHIMMERS THE WHOLE STATUS LINE, and stops under prefers-reduced-motion', () => {
    /*
     * jsdom cannot run animations, but it parses the sheet this surface ships,
     * so both halves are assertable where they are written: the base rule that
     * animates the live line (non-vacuity), and the reduce block that stills
     * it without hiding it.
     */
    const rules = walkRules(document.styleSheets);
    const animated = rules.find(
      (r) => r.selectorText?.includes('.toolrow.live .name') && /shimmer/.test(r.cssText),
    );
    expect(animated, 'the base shimmer rule is missing').toBeTruthy();

    // Other sheets carry their own global reduce blocks; the lock is that the
    // block covering THIS surface's living row stills it.
    const reduce = findMediaBlocks(document.styleSheets).find((m) =>
      m.cssText.includes('.toolrow.live'),
    );
    expect(reduce, 'no reduced-motion media query covers the live row').toBeTruthy();
    expect(reduce!.cssText).toContain('animation: none');
  });

  it('holds the contrast floor AT REST — both gradient endpoints ≥ 4.5:1 in dark', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    try {
      // The endpoints the shipped rule paints with, read from the sheet itself.
      const rule = walkRules(document.styleSheets).find(
        (r) => r.selectorText?.includes('.toolrow.live .name') && /shimmer/.test(r.cssText),
      )!;
      /* jsdom does not expand the background-image shorthand onto
         CSSStyleDeclaration, so read the declared text. */
      const painted = rule.cssText;
      expect(painted).toContain('--ink-2');
      expect(painted).toContain('--ink-1');

      const ground = substituteVars('var(--bg-base)', document.documentElement);
      for (const name of ['--ink-2', '--ink-1']) {
        const ink = substituteVars(`var(${name})`, document.documentElement);
        const ratio = contrast(ink, ground);
        expect(ratio, `${name} measured ${ratio}:1`).toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      document.documentElement.removeAttribute('data-theme');
    }
  });
});

/* -- helpers --------------------------------------------------------------- */

interface StyleRuleLike {
  selectorText?: string;
  cssText: string;
  style?: CSSStyleDeclaration;
}

function walkRules(sheets: StyleSheetList | StyleSheet[]): StyleRuleLike[] {
  const out: StyleRuleLike[] = [];
  for (const sheet of Array.from(sheets)) {
    const list = (sheet as CSSStyleSheet).cssRules;
    if (!list) continue;
    for (const rule of Array.from(list)) {
      if ('selectorText' in rule) out.push(rule as unknown as StyleRuleLike);
      if ('cssRules' in rule) out.push(...walkRules([(rule as unknown as CSSStyleSheet)]));
    }
  }
  return out;
}

function findMediaBlocks(sheets: StyleSheetList | StyleSheet[]): CSSMediaRule[] {
  const out: CSSMediaRule[] = [];
  for (const sheet of Array.from(sheets)) {
    const list = (sheet as CSSStyleSheet).cssRules;
    if (!list) continue;
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion')) {
        out.push(rule);
      }
    }
  }
  return out;
}

function channels(color: string): [number, number, number, number] | null {
  const rgb = color.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return [parts[0]!, parts[1]!, parts[2]!, parts.length > 3 ? parts[3]! : 1];
  }
  const hex = color.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!hex) return null;
  const h = hex[1]!;
  const at = (i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return [at(0), at(1), at(2), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const f = channels(fg)!;
  const b = channels(bg)!;
  const over: [number, number, number] = [
    f[0] * f[3] + b[0] * (1 - f[3]),
    f[1] * f[3] + b[1] * (1 - f[3]),
    f[2] * f[3] + b[2] * (1 - f[3]),
  ];
  const l1 = luminance(over);
  const l2 = luminance([b[0], b[1], b[2]]);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

describe('starter chips — three grounded doors on the attached empty thread (P1 audit)', () => {
  it('renders the chips when attached, and a click fills the draft (never sends)', () => {
    const drafted: string[] = [];
    render(
      <Transcript
        turns={[]}
        inFlight={null}
        onStarter={(text) => drafted.push(text)}
      />,
    );
    const chips = screen.getAllByTestId('chat-starter');
    expect(chips.length).toBe(3);
    fireEvent.click(chips[0]!);
    expect(drafted.length).toBe(1);
    expect(drafted[0]).toMatch(/compact overview.*on the board/i);
  });

  it('unattached: the attach door renders and the chips do not', () => {
    render(<Transcript turns={[]} inFlight={null} onAttach={() => {}} onStarter={() => {}} />);
    expect(screen.getByTestId('chat-empty-attach')).toBeTruthy();
    expect(screen.queryAllByTestId('chat-starter').length).toBe(0);
  });
});
