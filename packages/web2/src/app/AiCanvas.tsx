/**
 * AI Canvas — typed artifact blocks via native tool writers.
 * Human pan/zoom + point-to-ask; no freeform stickies.
 */

import { useEffect, useRef, useState } from 'react';

import { SeqChartView } from '../charts/SeqChartView';
import { Icon } from '../chat/Icon';
import { useAppState, useStore } from '../state/connect';
import type { CanvasDoc, CanvasDocBlock } from '../state/types';
import { AiCanvasBlockBody } from './AiCanvasBlockBody';
import {
  blockNamesItself,
  canvasBlockNames,
  canvasBlockHeading,
  canvasBlockIcon,
  canvasBlockStatusLabel,
  canvasToolLabel,
  type AiCanvasBlockType,
} from './aiCanvasBlockMeta';
import { activeStoryBlockId, CanvasStoryNav } from './CanvasStoryNav';
import { canvasBlockChip } from './canvasBlockChip';
import { downloadCanvasHtml } from './canvasExportHtml';
import './aiCanvas.css';

export interface AiCanvasProps {
  doc: CanvasDoc;
  onAskBlock?: (block: CanvasDocBlock) => void;
  onExport?: () => void;
  storyActiveIndex?: number;
  onStoryStep?: (index: number) => void;
  /** tldraw-style: agent is actively writing to this canvas. */
  agentActivity?: { label: string; toolName?: string } | null;
  /**
   * Has a turn happened in this session? Empty-before and empty-after are
   * DIFFERENT STATES and only the second is informative — see the empty state.
   */
  hadTurn?: boolean;
}

export function AiCanvas({
  doc,
  onAskBlock,
  onExport,
  storyActiveIndex = 0,
  onStoryStep,
  agentActivity = null,
  hadTurn = false,
}: AiCanvasProps) {
  const { blocks, storyRoute } = doc;
  const charts = doc.charts ?? [];
  /* One name per block, computed over the whole document so two blocks of the
     same kind cannot announce themselves identically — see `canvasBlockNames`.

     KEYED BY ID, NOT BY POSITION, and a mutation is why. Indexing the name array
     with the map's index reads correctly until something reorders the map without
     reordering the names — then every block wears its neighbour's name and the
     labels still look plausible in document order. Binding by id makes that
     mismatch unrepresentable rather than merely untested. */
  const documentNames = canvasBlockNames(blocks);
  const nameById = new Map(blocks.map((b, i) => [b.id, documentNames[i]!]));

  /*
   * THE LESSON'S OWN SENTENCE, WHICH NOTHING USED TO READ.
   *
   * `teach:step` writes `canvasDoc.teachStep` with a caption and the nodes the
   * step lights. `ConnectedBoard` consumes `litNodeIds` to dim the Architecture
   * board — and `caption` was read by NOTHING. The engine produced the one
   * sentence explaining the step, the store kept it, and no surface drew it: a
   * field the engine fills and the product discards, which is the same defect
   * class CANON names for a field nothing sets.
   *
   * IT BELONGS HERE BECAUSE THIS IS WHERE THE LEARNER LANDS. The chart paints
   * on the AI Canvas and the "Drew a chart" work row opens `'ai-canvas'` — that
   * row used to open the Architecture board, a surface that has never rendered
   * a chart, and it was fixed for exactly this reason. Sending the caption to
   * the board instead would re-create that split: the picture on one surface,
   * the sentence about it on another.
   *
   * NOT DRAWN WHEN IT WOULD REPEAT A CHART. If the model puts the same words in
   * the step caption and in the chart's own caption or title, this would print
   * them twice — "a row that repeats its own name", the owner's standing
   * dislike that `docs/owner-feedback-log.md` records as recurring "in new
   * costumes". Compared on trimmed, case-folded text, because the duplicate
   * that matters is the one a reader sees, not the one that matches byte for
   * byte.
   */
  const teachCaption = doc.teachStep?.caption?.trim() ?? '';
  const said = (s: string | undefined | null) => (s ?? '').trim().toLowerCase();
  const echoesAChart = charts.some(
    (c) => said(c.caption) === said(teachCaption) || said(c.title) === said(teachCaption),
  );
  const lesson = teachCaption && !echoesAChart ? teachCaption : '';
  const activeBlockId = storyRoute ? activeStoryBlockId(doc, storyActiveIndex) : null;
  const blockRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (!activeBlockId) return;
    const el = blockRefs.current[activeBlockId];
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [activeBlockId]);

  /* A CHART IS CONTENT. The empty state used to key on `blocks` alone, so a
     doc holding nothing but charts painted "Ask in chat to populate this
     surface" over the charts it was holding.

     SO IS A LESSON CAPTION, for the same reason and by the same mistake: a
     teach step whose chart was refused still carries the sentence explaining
     the concept, and "Ask in chat to populate this surface" printed over it
     tells the reader their lesson produced nothing when it produced this. */
  if (blocks.length === 0 && charts.length === 0 && !lesson && !agentActivity) {
    return (
      <div className="ai-canvas ai-canvas-empty" data-testid="ai-canvas">
        <div className="ai-canvas-empty-inner">
          <Icon name="spark" size={14} className="ai-canvas-empty-icon" />
          <p className="ai-canvas-lede">
            AI Canvas renders typed blocks — markdown, mermaid, HTML, React, and SVG — through native
            tool writers.
          </p>
          {/*
            EMPTY-BEFORE AND EMPTY-AFTER ARE DIFFERENT STATES, and saying the
            same thing in both was the defect. "Ask in chat to populate this
            surface" is correct advice before a turn — the writers are enabled
            whenever this pane is visible. AFTER a turn that drew nothing it is
            advice the reader has already followed, and repeating it reads as a
            broken surface rather than an honest one.

            MEASURED, by the sequence lane on granite42-hermes Q4_K_M: the model
            called a drawing tool on 5 of 296 turns — 1.7%. So a turn ending
            with nothing drawn is the COMMON case, not an edge, and the surface
            has to have words for it.

            The second line names the lever that actually works rather than
            repeating the one that did not: asking for a diagram in so many
            words also turns the canvas belt on from any surface
            (`isDrawishAskQuestion`), so it is a real instruction and not a
            consolation.
          */}
          {hadTurn ? (
            <p className="ai-canvas-lede-mono" data-testid="ai-canvas-empty-after">
              The last answer drew nothing here. Ask for a diagram, chart or sketch and it will.
            </p>
          ) : (
            <p className="ai-canvas-lede-mono" data-testid="ai-canvas-empty-before">
              Ask in chat to populate this surface.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ai-canvas" data-testid="ai-canvas">
      {agentActivity ? (
        <div className="ai-canvas-agent" data-testid="ai-canvas-agent" role="status">
          <Icon name="spark" size={14} className="ai-canvas-agent-icon" />
          <span className="ai-canvas-agent-label">{agentActivity.label}</span>
          {agentActivity.toolName ? (
            <span className="ai-canvas-agent-tool mono">{agentActivity.toolName}</span>
          ) : null}
        </div>
      ) : null}
      {lesson ? (
        /*
          THE STEP'S SENTENCE, ABOVE THE PICTURE IT DESCRIBES. `role="note"` and
          not `role="status"`: the agent-activity strip above is a live region
          because it changes while the reader watches, whereas this is settled
          prose that a screen reader should meet in document order rather than
          have announced over whatever else is being read.
        */
        <p className="ai-canvas-lesson" data-testid="ai-canvas-lesson" role="note">
          {lesson}
        </p>
      ) : null}
      <div className="ai-canvas-toolbar" data-testid="ai-canvas-toolbar">
        {storyRoute && onStoryStep ? (
          <CanvasStoryNav route={storyRoute} activeIndex={storyActiveIndex} onStep={onStoryStep} />
        ) : null}
        {/*
          EXPORT IS NOT THE POINT OF THIS SURFACE — owner, 2026-09-02: "this
          does NOT help people learn, we need to SEE the breakdown on our app,
          not create exportable htmls all the time". It was the only labelled
          button in the toolbar, so on a canvas whose job is to SHOW a lesson
          the loudest control was the one that leaves the app.

          Demoted, not deleted: `downloadCanvasHtml` is still one click away.
          It is now a quiet icon control — no label text, no filled chrome — and
          the words live in the accessible name and the tooltip, where a control
          nobody is being steered towards belongs.
        */}
        {onExport ? (
          <button
            type="button"
            className="ai-canvas-export-quiet"
            data-testid="ai-canvas-export"
            onClick={onExport}
            title="Export HTML"
            aria-label="Export HTML"
          >
            <Icon name="download" size={12} />
          </button>
        ) : null}
      </div>
      {blocks.map((block) => (
        <article
          key={block.id}
          ref={(el) => {
            blockRefs.current[block.id] = el;
          }}
          className={`ai-canvas-block${block.status === 'live' ? ' ai-canvas-block-live' : ''}${block.status === 'pending' ? ' ai-canvas-block-pending-wrap' : ''}${activeBlockId === block.id ? ' ai-canvas-block-story-active' : ''}`}
          /*
             NAMED, because an unnamed <article> is a landmark a reader cannot
             navigate to. Eight blocks announced "article" eight times; dropping
             the redundant kind bar for the eye removed the only text naming a
             self-naming block for everyone else. The name comes from the
             heading the content already carries.

             NAMED ACROSS THE DOCUMENT, not per block. Two untitled diagrams both
             fall back to the kind heading, so a per-block name reads "Mermaid,
             Mermaid" and the landmark list stops distinguishing them — the
             defect above, one word better. Uniqueness is a property of the set,
             so the set computes the names.
          */
          aria-label={nameById.get(block.id)}
          data-canvas-block={block.type}
          data-canvas-status={block.status ?? 'landed'}
          data-testid={`ai-canvas-block-${block.type}${block.status === 'pending' ? '-pending' : ''}`}
        >
          <header className="ai-canvas-block-hd">
            {/*
              CONTENT THAT NAMES ITSELF IS NOT LABELLED AGAIN —
              docs/AI-CANVAS-IS-A-DOCUMENT.md §3, which is the chart block's own
              rule a few lines below ("NO BLOCK HEADER, and that is deliberate")
              applied to the rest. A markdown block opening `# Plan` draws an
              <h2>Plan</h2> and was then wrapped in a bar reading
              "Markdown · Plan": the title twice, the second one chrome.

              THE HEADER ROW STAYS EITHER WAY, because "Ask about this" and the
              status live in it. Only the redundant kind line goes.
            */}
            {blockNamesItself(block) ? (
              <span className="ai-canvas-block-hd-kind ai-canvas-block-hd-quiet" aria-hidden="true">
                <Icon
                  name={canvasBlockIcon(block.type as AiCanvasBlockType)}
                  size={14}
                  className="ai-canvas-block-hd-icon"
                />
              </span>
            ) : (
              <span className="ai-canvas-block-hd-kind">
                <Icon
                  name={canvasBlockIcon(block.type as AiCanvasBlockType)}
                  size={14}
                  className="ai-canvas-block-hd-icon"
                />
                <span>{canvasBlockHeading(block.type as AiCanvasBlockType, block.title)}</span>
              </span>
            )}
            <span className="ai-canvas-block-hd-actions">
              {onAskBlock ? (
                <button
                  type="button"
                  className="ai-canvas-ask-block"
                  data-testid={`ai-canvas-ask-${block.id}`}
                  onClick={() => onAskBlock(block)}
                >
                  Ask about this
                </button>
              ) : null}
              <span className="ai-canvas-block-hd-status">
                {canvasBlockStatusLabel(block.status ?? 'landed')}
              </span>
            </span>
          </header>
          <div className="ai-canvas-block-body">
            {block.status === 'pending' ? (
              <div className="ai-canvas-block-pending" data-testid="ai-canvas-block-pending">
                <div className="ai-canvas-block-pending-shimmer" aria-hidden />
                <p className="ai-canvas-block-pending-label">Agent is drawing…</p>
              </div>
            ) : (
              <AiCanvasBlockBody block={block} />
            )}
          </div>
        </article>
      ))}
      {/*
        THE CHARTS THE MODEL ASKED FOR, FINALLY PAINTED.

        `propose_chart` → `chart:proposal` → `session.canvasDoc.charts` was a
        complete pipeline whose last link was missing: `SeqChartView` and its
        eight family renderers had ZERO callers, so every validated spec landed
        in state and was never drawn. This is that caller.

        They render in ARRIVAL ORDER, after the blocks, in the same article
        chrome the blocks use — no new styling, because `charts.css` already
        owns the inside of the frame and Graphite owns the frame.

        `knownNodeIds` is deliberately NOT passed. The server validates every
        `nodeId` against the real graph before the event is emitted (see the
        `chart:proposal` case in state/store.ts), while this client's
        `session.graph` may be from a different or staler scan — re-checking
        here would refuse charts the server accepted, which is a worse failure
        than the one the check guards against. A caller that ever renders a
        chart the server did not validate this session — an import, a replayed
        transcript, a pasted spec — MUST pass it.
      */}
      {charts.map((chart, index) => (
        <article
          key={`chart-${index}-${chart.kind}`}
          className="ai-canvas-block"
          /* The chart draws its own <figcaption>; the LANDMARK still needs a
             name, and "article" is not one. */
          aria-label={chart.title ? `Chart · ${chart.title}` : 'Chart'}
          data-canvas-block="chart"
          data-canvas-status="landed"
          data-testid="ai-canvas-chart"
        >
          {/*
            NO BLOCK HEADER, and that is deliberate. `ChartFrame` already draws
            the chart's own `<figcaption>` with its title and caption, so an
            `ai-canvas-block-hd` above it would print the title twice — the
            owner's standing dislike, "a row that repeats its own name", which
            docs/owner-feedback-log.md records as recurring "in new costumes".
            The kind rides the frame's accessible name, not a second chip.
          */}
          <div className="ai-canvas-block-body">
            <SeqChartView chart={chart} />
          </div>
        </article>
      ))}
    </div>
  );
}

/** Store-connected AI Canvas — reads `session.canvasDoc`. */
export function ConnectedAiCanvas() {
  const state = useAppState();
  const store = useStore();
  const [storyIndex, setStoryIndex] = useState(0);
  const doc = state.session.canvasDoc;
  const inFlight = state.session.inFlight;

  const agentActivity = (() => {
    if (!inFlight) return null;
    const runningCanvas = inFlight.work.find(
      (r) => r.status === 'running' && /^Called canvas\.write_/.test(r.verb),
    );
    if (runningCanvas) {
      const toolName = /^Called (\S+)$/.exec(runningCanvas.verb)?.[1];
      return {
        label: toolName ? canvasToolLabel(toolName) : 'Drawing on AI Canvas…',
        toolName,
      };
    }
    if (doc.blocks.some((b) => b.status === 'live' || b.status === 'pending')) {
      return { label: 'Drawing on AI Canvas…' };
    }
    return null;
  })();

  useEffect(() => {
    const max = (doc.storyRoute?.steps.length ?? 1) - 1;
    if (storyIndex > max) setStoryIndex(Math.max(0, max));
  }, [doc.storyRoute, storyIndex]);

  return (
    <AiCanvas
      doc={doc}
      agentActivity={agentActivity}
      hadTurn={state.session.turns.length > 0}
      storyActiveIndex={storyIndex}
      onStoryStep={setStoryIndex}
      onAskBlock={(block) => {
        store.dispatch({ type: 'composer/chip-add', chip: canvasBlockChip(block) });
        store.dispatch({ type: 'composer/focus' });
      }}
      onExport={() => downloadCanvasHtml(doc)}
    />
  );
}
