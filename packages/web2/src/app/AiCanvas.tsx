/**
 * AI Canvas — freeform SeqDraw plane. Charts and blocks land as movable
 * artifact frames (owner walk 2026-09-16: TLDraw-like space, not a card stack).
 * Whiteboard tab stays the sibling freehand pad. No tldraw package.
 */

import { useEffect, useMemo, useRef } from 'react';

import { SeqChartView, type ChartPart } from '../charts/SeqChartView';
import { TeachWalk } from '../charts/TeachWalk';
import { Icon } from '../chat/Icon';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import type { CanvasDoc, CanvasDocBlock, ContextChip } from '../state/types';
import { Whiteboard } from '../whiteboard/Whiteboard';
import { seqDrawKey, type WbArtifact } from '../whiteboard/whiteboardModel';
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
import { materializeCanvasArtifacts } from './materializeCanvasArtifacts';
import './aiCanvas.css';
import '../whiteboard/whiteboard.css';
import '../charts/charts.css';

export interface AiCanvasProps {
  doc: CanvasDoc;
  onAskBlock?: (block: CanvasDocBlock) => void;
  onExport?: () => void;
  storyActiveIndex?: number;
  onStoryStep?: (index: number) => void;
  /** Agent is actively writing to this canvas (board.* or canvas.write_*). */
  agentActivity?: { label: string; toolName?: string } | null;
  /**
   * Point at a chart part and ask about it. Absent ⇒ charts render exactly as
   * they did, with no affordance and nothing clickable.
   */
  onSelectPart?: (part: ChartPart) => void;
  /**
   * Has a turn happened in this session? Empty-before and empty-after are
   * DIFFERENT STATES and only the second is informative — see the empty state.
   */
  hadTurn?: boolean;
}

export function AiCanvas({
  doc,
  onAskBlock,
  storyActiveIndex = 0,
  onStoryStep,
  agentActivity = null,
  hadTurn = false,
  onSelectPart,
}: AiCanvasProps) {
  const { blocks, storyRoute } = doc;
  const charts = doc.charts ?? [];
  /* The fourth beat of the lesson, when the turn produced one. Absent on every
     turn that did not, which is most of them — see teachWalk.ts. */
  const walk = doc.teachWalk;
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
     tells the reader their lesson produced nothing when it produced this.

     Empty copy is only when neither blocks nor charts exist. */
  if (blocks.length === 0 && charts.length === 0 && !lesson && !agentActivity) {
    /* before/after testids keep the measured empty-contract: which empty it is. */
    return (
      <div
        className="ai-canvas-blocks-empty"
        data-testid={hadTurn ? 'ai-canvas-empty-after' : 'ai-canvas-empty-before'}
      >
        <p className="ai-canvas-lede-mono">
          {hadTurn
            ? 'This turn drew nothing here — ask for a chart, diagram, or markdown block.'
            : 'Ask in chat for a chart, diagram, or markdown — this surface shows what landed.'}
        </p>
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
        {/* Export HTML removed — owner walk 2026-09-16: freeform in-project only. */}
      </div>
      <div className="ai-canvas-scroll" data-testid="ai-canvas-scroll">
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
              <span className="ai-canvas-block-hd-spacer" aria-hidden="true" />
            ) : (
              <span className="ai-canvas-block-hd-kind">
                <Icon
                  name={canvasBlockIcon(block.type as AiCanvasBlockType)}
                  size={14}
                  className="ai-canvas-block-hd-icon"
                />
                <span className="ai-canvas-block-hd-title">
                  {canvasBlockHeading(block.type as AiCanvasBlockType, block.title)}
                </span>
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
            <SeqChartView
              chart={chart}
              {...(onSelectPart ? { onSelectPart } : {})}
            />
            {/*
              THE WALK RIDES THE PICTURE IT WALKS THROUGH, and only the LAST
              chart — the one the current concept drew. A walk under an earlier
              chart would name parts of a picture the reader is no longer
              looking at, and every partId was validated against the newest
              one. See teachWalk.ts for the fourth-beat argument.
            */}
            {walk && index === charts.length - 1 ? (
              <TeachWalk input={walk.input} steps={walk.steps} />
            ) : null}
          </div>
        </article>
      ))}
      </div>
    </div>
  );
}

const EMPTY_ARTIFACTS: readonly WbArtifact[] = [];

/** Store-connected AI Canvas — SeqDraw freeform plane; charts/blocks as frames. */
export function ConnectedAiCanvas() {
  const state = useAppState();
  const store = useStore();
  const doc = state.session.canvasDoc;
  const inFlight = state.session.inFlight;
  const artifacts = useMemo(() => materializeCanvasArtifacts(doc), [doc]);

  /*
   * ARTIFACTS FROM THE THREAD THE READER JUST LEFT ARE NOT THIS THREAD'S.
   *
   * On a session switch the rail flips `activeId` first (optimistic, so the
   * highlight does not wait on the network) and the store's `canvasDoc` is
   * replaced a moment later. In between, this component re-keys the SeqDraw
   * pad to the NEW id while `doc` — and so `artifacts` — is still the OLD
   * thread's. `Whiteboard`'s append effect then persists those frames into
   * the new key, and nothing ever removes them: the next thread opens onto
   * the previous one's AI Canvas (owner walk 2026-09-17).
   *
   * THE DOC SAYS WHOSE IT IS. This was a ref comparing the previous render's
   * (activeId, doc) pair — an inference about identity from two renders, which
   * cannot answer the question on the FIRST render of a remount and says
   * nothing at all about a doc hydrated for a third thread. `forSession` is
   * the answer rather than a proxy for it (`state/types.ts`).
   */
  const activeId = state.session.activeId;
  const agentItems = doc.forSession === activeId ? artifacts : EMPTY_ARTIFACTS;

  const agentActivity = (() => {
    if (!inFlight) return null;
    const runningCanvas = inFlight.work.find(
      (r) =>
        r.status === 'running' &&
        (/^Called canvas\.write_/.test(r.verb) || /^Called propose_chart/.test(r.verb)),
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

  const renderArtifact = (item: WbArtifact) => {
    if (item.ref.type === 'chart') {
      const chart = doc.charts?.[item.ref.index];
      if (!chart) return <p className="wb-artifact-missing">Chart gone</p>;
      return (
        <div className="wb-artifact-chart" data-testid="ai-canvas-chart">
          <SeqChartView
            chart={chart}
            onSelectPart={(part) => {
              store.dispatch({ type: 'composer/chip-add', chip: chartPartChip(part) });
              store.dispatch({ type: 'composer/focus' });
            }}
          />
          {doc.teachWalk && item.ref.index === (doc.charts?.length ?? 0) - 1 ? (
            <TeachWalk input={doc.teachWalk.input} steps={doc.teachWalk.steps} />
          ) : null}
        </div>
      );
    }
    const blockId = item.ref.blockId;
    const block = doc.blocks.find((b) => b.id === blockId);
    if (!block) return <p className="wb-artifact-missing">Block gone</p>;
    return (
      <div className="wb-artifact-block" data-testid={`ai-canvas-block-${block.type}`}>
        <AiCanvasBlockBody block={block} />
      </div>
    );
  };

  return (
    <div className="ai-canvas-host ai-canvas-plane" data-testid="ai-canvas">
      {/* Pane chrome already names "AI Canvas" — do not repeat the title here. */}
      {agentActivity ? (
        <div className="ai-canvas-agent" data-testid="ai-canvas-agent" role="status">
          <Icon name="spark" size={14} className="ai-canvas-agent-icon" />
          <span className="ai-canvas-agent-label">{agentActivity.label}</span>
          {agentActivity.toolName ? (
            <span className="ai-canvas-agent-tool mono">{agentActivity.toolName}</span>
          ) : null}
        </div>
      ) : null}
      <div className="ai-canvas-seqdraw" data-testid="ai-canvas-seqdraw">
        <Whiteboard
          repoRoot={groundedRepoRoot(state)}
          storageKey={seqDrawKey(state.session.activeId)}
          agentItems={agentItems}
          renderArtifact={renderArtifact}
          onDocChange={(drawing) => store.dispatch({ type: 'session/canvas-drawing', doc: drawing })}
        />
      </div>
    </div>
  );
}

/**
 * One clicked part of a drawing, as a composer chip.
 *
 * `ref` is the item's own id and NOT a repository id — a teaching chart has no
 * repository behind it. `ContextChipKind`'s note says why that is allowed and
 * `connect.tsx` is where the difference is honoured: a `chart-part` gets a
 * self-describing line rather than being folded in with the grounded scope.
 *
 * `nodeId` is carried in the id when the item IS grounded, so a chart drawn
 * over a scanned repo still points at the real node; `nodeKind` stays null
 * because the chip's glyph comes from what it is (a part of a drawing), not
 * from what it happens to stand for.
 */
function chartPartChip(part: ChartPart): ContextChip {
  return {
    id: `chart-part:${part.nodeId ?? part.itemId}`,
    kind: 'chart-part',
    ref: part.itemId,
    label: part.label,
    nodeKind: null,
  };
}

