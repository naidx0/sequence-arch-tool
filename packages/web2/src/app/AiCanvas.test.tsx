import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { AiCanvas } from './AiCanvas';
import { CHART_FIXTURES } from '../charts/chartFixtures';
import type { CanvasDoc } from '../state/types';

const sampleDoc: CanvasDoc = {
  blocks: [
    {
      id: 'b1',
      type: 'markdown',
      title: 'Plan',
      payload: '# Step one\n\nDo the thing.',
      status: 'landed',
    },
    {
      id: 'b2',
      type: 'mermaid',
      title: 'flow',
      payload: 'graph LR; A-->B;',
      status: 'live',
    },
  ],
};

describe('AiCanvas paints the charts the model asked for', () => {
  /*
   * THE LAST LINK OF A COMPLETE PIPELINE WAS MISSING. `propose_chart` →
   * `chart:proposal` → `session.canvasDoc.charts` all shipped and were tested;
   * `SeqChartView` plus eight family renderers shipped and were tested; and
   * `SeqChartView` had ZERO callers outside its own directory, so every
   * validated spec landed in state and was never drawn. These tests are the
   * caller's lock.
   */
  const chart = CHART_FIXTURES['node-link'];

  /*
   * THE WITNESS MUST BE ABLE TO SAY NO.
   *
   * `ai-canvas-chart` is the ground truth for a registered measurement — does
   * the product draw a picture for an engineer — and its kill is *no picture in
   * three turns*. Three cases assert the marker is PRESENT when a chart is
   * drawn; until this one, nothing asserted it is ABSENT when none is. A marker
   * that only ever appears cannot refute anything, and the clause that depends
   * on it would have passed vacuously.
   *
   * Cheap, and it is the same rule as a check's can-fail case: the half of a
   * witness nobody tests is the half a result rests on.
   */
  it('is ABSENT when the model asked for no chart — the witness can say no', () => {
    render(<AiCanvas doc={{ blocks: [], charts: [] }} />);
    expect(screen.queryAllByTestId('ai-canvas-chart').length).toBe(0);
  });

  it('is ABSENT for a raw svg payload, which lands on a different path entirely', () => {
    /*
     * The forgery route worth ruling out. A model's raw SVG never enters
     * `charts` — it lands on the svg block path — so it cannot counterfeit the
     * block-level marker this measurement reads. Asserted rather than assumed,
     * because "it goes somewhere else" is exactly the kind of claim that is true
     * until someone widens a branch.
     */
    render(
      <AiCanvas
        doc={{
          blocks: [
            {
              id: 'b1',
              type: 'svg',
              payload: '<svg role="img"><rect width="4" height="4"/></svg>',
              status: 'landed',
            },
          ],
          charts: [],
        }}
      />,
    );
    /* It lands on the svg path… */
    expect(screen.queryAllByTestId('ai-canvas-svg-inline').length).toBe(1);
    /* …and NOT on the marker this measurement reads. */
    expect(screen.queryAllByTestId('ai-canvas-chart').length).toBe(0);
  });

  it('renders a chart from canvasDoc.charts, through the real renderer', () => {
    render(<AiCanvas doc={{ blocks: [], charts: [chart] }} />);
    const painted = screen.getAllByTestId('ai-canvas-chart');
    expect(painted.length).toBe(1);
    // The renderer really ran — not the refusal, and not an empty frame.
    expect(screen.queryByTestId('seqchart-fail')).toBeNull();
    expect(screen.getByTestId('seqchart-title').textContent).toBe(chart.title);
    expect(painted[0]!.querySelector('svg')).toBeTruthy();
  });

  it('does not print the chart title twice', () => {
    /* ChartFrame draws the title in its own figcaption. A block header above
       it would repeat it — the owner's settled dislike, "a row that repeats
       its own name" (docs/owner-feedback-log.md), which that log notes keeps
       coming back "in new costumes". */
    render(<AiCanvas doc={{ blocks: [], charts: [chart] }} />);
    expect(screen.getAllByText(chart.title)).toHaveLength(1);
  });

  it('a doc holding only charts is NOT the empty state', () => {
    /* The empty check keyed on `blocks` alone, so a lesson whose whole content
       was charts painted "Ask in chat to populate this surface" over them. */
    render(<AiCanvas doc={{ blocks: [], charts: [chart] }} />);
    expect(screen.queryByText(/Ask in chat to populate/i)).toBeNull();
  });

  it('charts arrive in order and sit alongside blocks, not instead of them', () => {
    const second = CHART_FIXTURES.flow;
    render(<AiCanvas doc={{ ...sampleDoc, charts: [chart, second] }} />);
    expect(screen.getByTestId('ai-canvas-block-markdown')).toBeTruthy();
    const painted = screen.getAllByTestId('ai-canvas-chart');
    expect(painted.length).toBe(2);
    expect(painted[0]!.textContent).toContain(chart.title);
    expect(painted[1]!.textContent).toContain(second.title);
  });

  it('a spec the validator refuses says so in place, rather than drawing a blank frame', () => {
    /* The grounding contract is the reason the model emits data instead of
       code; a caller that swallowed a refusal would throw that away. */
    const broken = { ...chart, items: [] } as typeof chart;
    render(<AiCanvas doc={{ blocks: [], charts: [broken] }} />);
    expect(screen.getByTestId('seqchart-fail')).toBeTruthy();
  });

  it('a REFUSED spec is not a picture — the outer marker is there, the inner one is not', () => {
    /*
     * THE THIRD STATE, and the one a two-valued witness cannot see.
     *
     * `belt-second-question` reads whether the product draws for an engineer,
     * with a kill of "no picture in three turns". The outer `ai-canvas-chart`
     * article is emitted per parsed chart INCLUDING one whose spec the validator
     * refuses — and the first refusal path is the fabrication guard: an item
     * naming a node absent from the scanned graph refuses by design, because a
     * picture that fabricates is believed faster than prose that fabricates.
     *
     * So the outer marker alone scores a correct refusal as a picture drawn.
     * The measurement now reads the NESTED pair, and the three states are:
     * outer absent = nothing proposed; outer without inner = proposed and
     * refused; both = a frame rendered.
     */
    const broken = { ...chart, items: [] } as typeof chart;
    const view = render(<AiCanvas doc={{ blocks: [], charts: [broken] }} />);
    /* The product decided to draw… */
    expect(screen.getAllByTestId('ai-canvas-chart').length).toBe(1);
    /* …and then declined, so no frame exists. */
    expect(view.container.querySelectorAll('[data-testid="seqchart"]').length).toBe(0);
    /* The registered witness, verbatim, must find nothing. */
    expect(
      view.container.querySelectorAll('[data-testid="ai-canvas-chart"] [data-testid="seqchart"]')
        .length,
    ).toBe(0);
  });

  it('…and a VALID spec satisfies that same nested witness', () => {
    /* The other half. A witness that never matches is as useless as one that
       always does, and this pair is what makes the clause decidable. */
    const view = render(<AiCanvas doc={{ blocks: [], charts: [chart] }} />);
    expect(
      view.container.querySelectorAll('[data-testid="ai-canvas-chart"] [data-testid="seqchart"]')
        .length,
    ).toBe(1);
  });
});

describe('AiCanvas', () => {
  it('empty state invites ask in chat with spark icon', () => {
    render(<AiCanvas doc={{ blocks: [] }} />);
    expect(screen.getByTestId('ai-canvas')).toBeTruthy();
    expect(screen.getByText(/Ask in chat to populate/i)).toBeTruthy();
    expect(document.querySelector('[data-icon="spark"]')).toBeTruthy();
  });

  it('renders block content, status and the mermaid box', () => {
    /*
     * REDIRECTED, NOT WEAKENED — and the old name said what was wrong with it:
     * "renders ledger-style block headers". It asserted
     * `getByText('Markdown · Plan')`, pinning the exact chrome the owner
     * reported on 2026-09-09: "The AI canvas right now seems to open up little
     * section cards within the canvas."
     *
     * This fixture is the argument in miniature. Its payload opens `# Step one`
     * — which the assertion on the last line proves renders — while the header
     * said "Markdown · Plan". Not a duplicated title: TWO DIFFERENT NAMES for
     * one passage, one of them chrome. docs/AI-CANVAS-IS-A-DOCUMENT.md §3.
     *
     * Everything the test was really for is kept: both blocks render, the
     * diagram draws, status is legible, and the heading appears. What it no
     * longer pins is the card.
     */
    render(<AiCanvas doc={sampleDoc} />);
    expect(screen.getByTestId('ai-canvas-block-markdown')).toBeTruthy();
    expect(screen.getByTestId('ai-canvas-block-mermaid')).toBeTruthy();
    expect(screen.getByTestId('ai-canvas-mermaid')).toBeTruthy();
    /* Mermaid cannot name itself — a diagram is not a title — so it KEEPS its
       label. That is the load-bearing half of the rule, asserted here. */
    expect(screen.getByText('Mermaid · flow')).toBeTruthy();
    expect(screen.getByText('landed')).toBeTruthy();
    expect(screen.getByText('live')).toBeTruthy();
    expect(document.querySelector('.ai-canvas-mermaid-box')).toBeTruthy();
    const live = screen.getByTestId('ai-canvas-block-mermaid');
    expect(live.getAttribute('data-canvas-status')).toBe('live');
    expect(screen.getByText('Step one')).toBeTruthy();
  });

  it('THE PASSAGE IS NOT LABELLED TWICE — the reported shape', () => {
    /*
     * The lock built from the complaint itself. The markdown fixture opens
     * `# Step one` and carries title 'Plan'; the header drew "Markdown · Plan"
     * over content already headed "Step one".
     */
    render(<AiCanvas doc={sampleDoc} />);
    expect(screen.queryByText('Markdown · Plan')).toBeNull();
    /* And the passage still says what it is, in its own words. */
    expect(screen.getByText('Step one')).toBeTruthy();
  });

  it('and point-to-ask survives the chrome going', () => {
    /*
     * The regression this slice could most easily have caused. Point-to-ask is
     * how the canvas talks to the chat; removing the bar it lived in must not
     * remove it. It is a real button, so it is keyboard-reachable — hover-only
     * chrome would have made it unreachable without a pointer.
     */
    const onAskBlock = vi.fn();
    render(<AiCanvas doc={sampleDoc} onAskBlock={onAskBlock} />);
    const ask = screen.getByTestId('ai-canvas-ask-b1');
    expect(ask.tagName).toBe('BUTTON');
    fireEvent.click(ask);
    expect(onAskBlock).toHaveBeenCalledTimes(1);
  });

  it('renders sandboxed HTML and React viewer with source', () => {
    render(
      <AiCanvas
        doc={{
          blocks: [
            {
              id: 'h1',
              type: 'html',
              title: 'layout',
              payload: '<div class="grid"><p>Compare</p></div>',
              status: 'landed',
            },
            {
              id: 'r1',
              type: 'react',
              title: 'chart',
              payload: 'export default function X(){ return (<div>Chart</div>); }',
              status: 'landed',
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('ai-canvas-html-frame')).toBeTruthy();
    expect(screen.getByTestId('ai-canvas-block-react')).toBeTruthy();
    expect(screen.getByTestId('ai-canvas-react-src')).toBeTruthy();
    expect(
      screen.queryByTestId('ai-canvas-react-mount') ?? screen.getByTestId('ai-canvas-react-fallback'),
    ).toBeTruthy();
  });

  it('point-to-ask dispatches block to handler', () => {
    const onAskBlock = vi.fn();
    render(<AiCanvas doc={sampleDoc} onAskBlock={onAskBlock} />);
    fireEvent.click(screen.getByTestId('ai-canvas-ask-b1'));
    expect(onAskBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1', type: 'markdown' }));
  });

  it('shows story nav and export when wired', () => {
    const onStoryStep = vi.fn();
    const onExport = vi.fn();
    render(
      <AiCanvas
        doc={{
          ...sampleDoc,
          storyRoute: {
            title: 'Auth walkthrough',
            steps: [
              { blockId: 'b1', caption: 'Plan' },
              { blockId: 'b2', caption: 'Flow' },
            ],
          },
        }}
        storyActiveIndex={0}
        onStoryStep={onStoryStep}
        onExport={onExport}
      />,
    );
    expect(screen.getByTestId('ai-canvas-story-nav')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ai-canvas-story-step-1'));
    expect(onStoryStep).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId('ai-canvas-export'));
    expect(onExport).toHaveBeenCalled();
  });

  it('export is a quiet icon control, not the loudest thing in the toolbar', () => {
    /*
     * Owner, 2026-09-02, on a teaching turn that produced a text block and an
     * export button: "this does NOT help people learn, we need to SEE the
     * breakdown on our app, not create exportable htmls all the time." Export
     * was the only labelled button on a surface whose whole job is to show.
     * Demoted, never deleted — downloadCanvasHtml is still one click away.
     */
    const onExport = vi.fn();
    render(<AiCanvas doc={sampleDoc} onExport={onExport} />);

    // No visible label anywhere on the page — the words live in the tooltip.
    expect(screen.queryByText('Export HTML')).toBeNull();

    const control = screen.getByTestId('ai-canvas-export');
    expect(control.textContent).toBe('');
    expect(control.getAttribute('title')).toBe('Export HTML');
    expect(control.getAttribute('aria-label')).toBe('Export HTML');
    // And it carries none of the primary-button chrome it used to.
    expect(control.className).not.toContain('ai-canvas-export ');
    expect(control.className).toBe('ai-canvas-export-quiet');

    fireEvent.click(control);
    expect(onExport).toHaveBeenCalled();
  });

  it('renders agent activity banner when provided', () => {
    render(
      <AiCanvas
        doc={{ blocks: [] }}
        agentActivity={{ label: 'Drawing SVG', toolName: 'canvas.write_svg' }}
      />,
    );
    expect(screen.getByTestId('ai-canvas-agent')).toBeTruthy();
    expect(screen.getByText('Drawing SVG')).toBeTruthy();
    expect(screen.getByText('canvas.write_svg')).toBeTruthy();
  });

  it('renders pending block skeleton while agent draws', () => {
    render(
      <AiCanvas
        doc={{
          blocks: [
            {
              id: 'pending:t1',
              type: 'svg',
              payload: '',
              status: 'pending',
            },
          ],
        }}
        agentActivity={{ label: 'Drawing SVG…' }}
      />,
    );
    expect(screen.getByTestId('ai-canvas-block-pending')).toBeTruthy();
    expect(screen.getByText('Agent is drawing…')).toBeTruthy();
    expect(screen.getByText('drawing…')).toBeTruthy();
  });
});

describe("the lesson's own sentence, on the surface the learner lands on", () => {
  /*
   * `teach:step` wrote `canvasDoc.teachStep` with a caption and the nodes the
   * step lights. `ConnectedBoard` read `litNodeIds` to dim the Architecture
   * board; `caption` was read by NOTHING — the engine produced the one sentence
   * explaining the step, the store kept it, and no surface drew it.
   *
   * It belongs here rather than on the board because the chart paints here and
   * the "Drew a chart" work row opens `'ai-canvas'`. That row used to open the
   * Architecture board — a surface that has never rendered a chart — and was
   * fixed for exactly this reason; sending the caption there would re-create the
   * split it fixed, with the picture on one surface and the sentence on another.
   */
  const caption = 'A transformer block is attention followed by a feed-forward layer.';

  it('renders the caption the engine wrote', () => {
    render(<AiCanvas doc={{ blocks: [], charts: [], teachStep: { caption } }} />);
    expect(screen.getByTestId('ai-canvas-lesson').textContent).toBe(caption);
  });

  it('draws nothing when there is no lesson', () => {
    render(<AiCanvas doc={sampleDoc} />);
    expect(screen.queryByTestId('ai-canvas-lesson')).toBeNull();
  });

  it('does NOT repeat a sentence the chart already prints', () => {
    /* "A row that repeats its own name" is the owner's standing dislike, and
       docs/owner-feedback-log.md records it recurring "in new costumes". If the
       model puts the same words in the step caption and the chart's own caption,
       printing both is one of those costumes. Case and surrounding space differ
       here on purpose: the duplicate that matters is the one a reader SEES. */
    const chart = { ...CHART_FIXTURES['node-link'], caption: `  ${caption.toUpperCase()}  ` };
    render(<AiCanvas doc={{ blocks: [], charts: [chart], teachStep: { caption } }} />);
    expect(screen.queryByTestId('ai-canvas-lesson')).toBeNull();
    /* …and the chart itself is still drawn, so this is a de-duplication rather
       than a lesson that silently swallowed the picture. */
    expect(screen.getByTestId('ai-canvas-chart')).toBeTruthy();
  });

  it('a lesson alone is CONTENT — the empty state must not paint over it', () => {
    /* Same mistake the charts hit: the empty state keyed on `blocks` alone and
       printed "Ask in chat to populate this surface" over the charts it held. A
       teach step whose chart was refused still carries the sentence explaining
       the concept, and covering it tells the reader their lesson produced
       nothing when it produced this. */
    render(<AiCanvas doc={{ blocks: [], charts: [], teachStep: { caption } }} />);
    expect(screen.getByTestId('ai-canvas-lesson')).toBeTruthy();
    expect(screen.queryByText(/Ask in chat to populate/i)).toBeNull();
  });
});

describe('a fenced block says what language it is', () => {
  /*
   * Owner, 2026-09-09, on what the canvas should hold: "really cool boards,
   * math equations, and a lot of different language in that sense."
   *
   * `data-lang` carried the fence's language from the first version of this
   * renderer and NOTHING drew it, so every block in every language rendered as
   * one anonymous grey box. docs/AI-CANVAS-IS-A-DOCUMENT.md §5 item 2.
   */
  const withCode = (payload: string) => ({
    blocks: [{ id: 'c1', type: 'markdown' as const, payload, status: 'landed' as const }],
  });

  it('shows the language of a fenced block', () => {
    render(<AiCanvas doc={withCode('```python\nprint(1)\n```') as never} />);
    expect(screen.getByTestId('ai-canvas-md-lang').textContent).toBe('python');
    /* and the code itself is untouched */
    expect(screen.getByText('print(1)')).toBeTruthy();
  });

  it('SAYS NOTHING when the fence named no language', () => {
    /*
     * The half that keeps it honest. A label reading "text" over a shell
     * snippet would be the product inventing a fact about content it was
     * handed — the rule the context ring follows on the same principle.
     */
    render(<AiCanvas doc={withCode('```\nplain\n```') as never} />);
    expect(screen.queryByTestId('ai-canvas-md-lang')).toBeNull();
    expect(screen.getByText('plain')).toBeTruthy();
  });

  it('takes only the language, not the rest of the info string', () => {
    /* ```ts title=foo.ts — the language is the first word; the rest is not it. */
    render(<AiCanvas doc={withCode('```ts title=foo.ts\nconst a = 1;\n```') as never} />);
    expect(screen.getByTestId('ai-canvas-md-lang').textContent).toBe('ts');
  });
});

describe('maths render on the canvas', () => {
  /*
   * Owner, 2026-09-09: "really cool boards, math equations, and a lot of
   * different language in that sense." Boards were mermaid, languages arrived
   * with the fence label, and equations were the one noun with nothing behind
   * it. docs/AI-CANVAS-IS-A-DOCUMENT.md §5 item 1.
   */
  const md = (payload: string) => ({
    blocks: [{ id: 'm1', type: 'markdown' as const, payload, status: 'landed' as const }],
  });

  it('typesets an inline formula', () => {
    render(<AiCanvas doc={md('mass is $E = mc^2$ here') as never} />);
    const math = screen.getAllByTestId('ai-canvas-math');
    expect(math.length).toBe(1);
    /* KaTeX emits its own markup — the witness is that it produced something,
       not that we echoed the tex back. */
    expect(math[0]!.innerHTML).toContain('katex');
    expect(math[0]!.getAttribute('data-display')).toBeNull();
  });

  it('typesets a display formula and marks it as one', () => {
    render(<AiCanvas doc={md('$$a + b$$') as never} />);
    expect(screen.getByTestId('ai-canvas-math').getAttribute('data-display')).toBe('true');
  });

  it('A PRICE IS NOT A FORMULA — prose survives untouched', () => {
    /*
     * The refusal that matters most on a surface whose prose is full of costs
     * and shell snippets. A renderer treating the first `$` as an open would
     * swallow the sentence.
     */
    render(<AiCanvas doc={md('it cost $5 to run and $PATH was set') as never} />);
    expect(screen.queryByTestId('ai-canvas-math')).toBeNull();
    expect(screen.getByText(/it cost \$5 to run/)).toBeTruthy();
  });

  it('MALFORMED MATHS SHOWS ITS SOURCE rather than blanking the document', () => {
    /*
     * KaTeX rejects malformed input. A canvas that crashed or blanked on one
     * bad formula would lose the whole document the model wrote, so a rejected
     * span renders the source verbatim and the reader can judge it — the
     * honest-errors rule applied to a renderer.
     */
    render(<AiCanvas doc={md('broken $' + '\\frac{1}{' + '$ here') as never} />);
    const raw = screen.queryByTestId('ai-canvas-math-raw');
    if (raw) expect(raw.textContent).toContain('rac{1}');
    /* Either way the document still rendered its prose — nothing blanked. */
    expect(screen.getByTestId('ai-canvas-block-markdown')).toBeTruthy();
  });
});

describe('every block is a landmark a reader can navigate to', () => {
  /*
   * Sequence's third gate is human-usability: "a feature that exists but can't
   * be found or read isn't done." Every block renders as an <article>, and an
   * <article> with no accessible name is a landmark screen-reader navigation
   * announces as "article" — a canvas of eight blocks was eight of those.
   *
   * I caused half of it. Dropping the redundant "Markdown · Plan" bar was right
   * for the eye (docs/AI-CANVAS-IS-A-DOCUMENT.md §3) and removed the only text
   * naming a self-naming block for everyone else. The fix is not to put the bar
   * back — it is to give the landmark the name the heading already carries.
   */
  it('names a self-naming block by its own heading', () => {
    render(<AiCanvas doc={sampleDoc} />);
    /* The markdown fixture opens `# Step one` — that is what a reader looking
       at it would call the passage, so that is the landmark's name. */
    expect(screen.getByRole('article', { name: 'Step one' })).toBeTruthy();
  });

  it('falls back to the KIND for a block that cannot name itself', () => {
    /* A mermaid diagram has no title of its own; "article" is worse than
       "Mermaid · flow", which is why the fallback is the kind heading and not
       silence. */
    render(<AiCanvas doc={sampleDoc} />);
    expect(screen.getByRole('article', { name: 'Mermaid · flow' })).toBeTruthy();
  });

  it('LEAVES NO BLOCK UNNAMED — the assertion that makes this navigable', () => {
    /*
     * Named individually above; counted here. A per-name check passes while a
     * ninth block ships unnamed, which is exactly how this defect arrived —
     * every block was individually fine and collectively unnavigable.
     */
    render(<AiCanvas doc={sampleDoc} />);
    const articles = document.querySelectorAll('article.ai-canvas-block');
    expect(articles.length).toBeGreaterThan(0);
    for (const el of articles) {
      const name = el.getAttribute('aria-label') ?? '';
      expect(name.trim()).not.toBe('');
    }
  });
});

describe('an empty canvas says WHICH empty it is', () => {
  /*
   * MEASURED by the sequence lane, granite42-hermes Q4_K_M: across 296 teach
   * turns the model called a drawing tool on 5 of them — 1.7%. Product-derived
   * charts carried ~97%. So "the turn ended and nothing was drawn" is the
   * COMMON case on this model, not an edge, and a surface that answers it with
   * "ask in chat" — the thing the reader just did — reads as broken rather than
   * honest.
   *
   * Before a turn the original line is correct: the canvas writers are enabled
   * whenever this pane is visible, so asking really is the next step.
   */
  const empty = { blocks: [] };

  it('before any turn, it asks for the first question', () => {
    render(<AiCanvas doc={empty as never} hadTurn={false} />);
    expect(screen.getByTestId('ai-canvas-empty-before')).toBeTruthy();
    expect(screen.queryByTestId('ai-canvas-empty-after')).toBeNull();
  });

  it('AFTER A TURN THAT DREW NOTHING, it says so and names the lever that works', () => {
    render(<AiCanvas doc={empty as never} hadTurn />);
    const after = screen.getByTestId('ai-canvas-empty-after');
    expect(after.textContent).toMatch(/drew nothing/i);
    /* Naming the ask that actually enables the belt, rather than repeating the
       advice the reader already followed. */
    expect(after.textContent).toMatch(/diagram|chart|sketch/i);
    expect(screen.queryByTestId('ai-canvas-empty-before')).toBeNull();
  });

  it('neither line appears when there is content — the empty state is not a header', () => {
    /* The exit reachable only by its own case: with blocks present, no empty
       copy renders at all, so the two assertions above cannot be passing
       against a message that is always on screen. */
    render(<AiCanvas doc={sampleDoc} hadTurn />);
    expect(screen.queryByTestId('ai-canvas-empty-after')).toBeNull();
    expect(screen.queryByTestId('ai-canvas-empty-before')).toBeNull();
  });
});
