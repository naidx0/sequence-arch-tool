import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type {
  FileEditProposal,
  InFlightTurn,
  ProposalId,
  Turn,
  TurnId,
  UserTurn,
} from '../state/types';
import { deriveAskLiveStatus } from './askLiveStatus';
import { formatAskMetricsDiagnosis } from './askMetricsLine';
import { Icon } from './Icon';
import { EditsLedger } from './EditsLedger';
import { PhaseCard } from './PhaseCard';
import { proseBlocks } from './proseBlocks';
import { shouldFollow } from './scrollFollow';
import { isToolDumpCode, stripToolProse, toolNameFromDump } from './stripToolProse';
import { foldTranscript, isRestoredTurnId } from './transcriptModel';
import type { TranscriptItem } from './transcriptModel';
import { ToolCallCard } from './ToolCallCard';
import { TopologyTheater } from './TopologyTheater';
import { TurnElapsed } from './TurnElapsed';
import { WorkProofStack } from './WorkProofStack';
import { WorkRowLine } from './WorkRowLine';
import {
  deriveTopologySteps,
  filterTopologyTheaterRows,
  isTopologyToolName,
  topologyTheaterActive,
  topologyToolRow,
} from './topologyTheaterModel';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 2.5 — THE TRANSCRIPT
   packages/web2/src/chat/Transcript.tsx

   Sheet 12.1: two lanes, and only one of them is a box.

     THE USER SPEAKS IN A BOX. A request is short, so it can afford a bubble
     inset from the right — 82% max, --surface-2, --r-18.

     THE ASSISTANT DOES NOT. An answer carries prose, diffs, cards and paths, so
     it is plain full-width text with no bubble, no avatar and no role marker.
     "The alternation between an inset grey rectangle and unframed text tells
     the two speakers apart from across the room, which is exactly what a role
     label, an avatar or a coloured bar would also have done — at the cost of an
     object per message, forever."

   This component holds NO rules. Every ordering, splitting and ending decision
   is in transcriptModel.ts, which has no React in it; this file walks the fold
   and picks an element per kind. The one behaviour that must live here is
   scroll-follow, because it is the only thing on the surface that needs a DOM
   measurement.
   ══════════════════════════════════════════════════════════════════════════ */

export interface TranscriptProps {
  turns: Turn[];
  inFlight: InFlightTurn | null;
  /**
   * How many tokens the configured model's window holds, when the provider
   * will say. NULL MEANS UNKNOWN and draws nothing - CANON law 4 governs this
   * line, and a meter against an invented ceiling is exactly the confident
   * wrong number it forbids. Only Ollama reports a real one today.
   */
  contextWindow?: number | null;
  /** The affordance rows: a row that opens the canvas, the rail or review. */
  onOpen?: (target: 'canvas' | 'ai-canvas' | 'rail' | 'review' | 'browser' | 'terminal', turnId: TurnId) => void;
  /**
   * Rewrite a question and ask it again.
   *
   * Absent while a turn is streaming: rewriting the question being answered
   * would leave an answer on screen to a question that is no longer there.
   */
  onEdit?: (turnId: TurnId, text: string) => void;
  /**
   * Seat-walk OpenCode boot: with no repository, the empty thread offers the
   * same attach door as the appbar — no BootSurface third pane.
   */
  onAttach?: () => void;
  /**
   * Grounded starter actions on an ATTACHED empty thread — the first-glance
   * void was the P1 audit's chat finding: one grey sentence in 900×700 of
   * black, with every door hidden behind "+" or Ctrl+K. Each starter FILLS
   * THE DRAFT (same contract as review comments: a stray click never runs an
   * agent) — the user reads, edits, and presses Send.
   */
  onStarter?: (text: string) => void;
  /**
   * Which reasoning provider is answering — shown on the live provider row so
   * the reader sees whose mind is working, not a generic spinner.
   */
  reasoningProvider?: string | null;
  /** Live edit proposals keyed by id — powers the edit ledger strip. */
  proposals?: Record<ProposalId, FileEditProposal>;
}

export function Transcript({
  turns,
  inFlight,
  onStarter,
  onOpen,
  contextWindow,
  onAttach,
  reasoningProvider,
  proposals = {},
}: TranscriptProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (inFlight === null) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [inFlight]);

  const items = foldTranscript(turns, inFlight, {
    proposals,
    now: inFlight ? now : undefined,
    reasoningProvider,
  });
  const liveStatus = inFlight !== null ? deriveAskLiveStatus(inFlight, now) : null;
  const scroller = useRef<HTMLDivElement>(null);

  /*
   * SCROLL-FOLLOW THAT YIELDS TO THE READER — ported from MLH/App.tsx:223-232.
   *
   * The ref, not state: whether the reader is at the tail is measured on their
   * scroll and consumed on the next paint, and putting it in state would
   * re-render the whole transcript on every wheel event to change nothing that
   * is drawn.
   *
   * v1 has no autoscroll at all (grep across product/ for scrollTop and
   * scrollIntoView: zero hits), so a streaming answer writes itself off the
   * bottom of the screen. The adoption study calls fixing that the highest
   * user-visible-improvement-per-line item in the whole document.
   */
  const following = useRef(true);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (el) following.current = shouldFollow(el);
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  });

  return (
    <div
      ref={scroller}
      className="chat-scope transcript"
      data-testid="chat-transcript"
      onScroll={onScroll}
      /* The transcript is the record. A screen reader that has to hunt for it
         is reading the product's evidence by accident. */
      role="log"
      aria-label="Conversation"
    >
      {items.length === 0 ? (
        <EmptyThread onAttach={onAttach} onStarter={onStarter} />
      ) : (
        <div className="tcol">
          {items.map((item) => (
            <Item
              key={item.key}
              item={item}
              onOpen={onOpen}
              contextWindow={contextWindow}
              reasoningProvider={reasoningProvider}
              /*
               * THE LIVE STATUS BELONGS TO ONE TURN. Owner, 2026-09-02: a new
               * prompt's "Round 1/8 · 12s" and "Provider is slow…" were
               * painted on the PREVIOUS turn's work stack too — every stack
               * received the same derived status, because there is one
               * in-flight turn and the status was handed to every item. Each
               * turn's timing is its own; a landed turn has none.
               */
              liveStatus={
                (item.kind === 'work' || item.kind === 'prose') && inFlight !== null && item.turnId === inFlight.turnId
                  ? liveStatus
                  : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Item({
  item,
  onOpen,
  contextWindow,
  reasoningProvider,
  liveStatus,
}: {
  item: TranscriptItem;
  onOpen?: (target: 'canvas' | 'ai-canvas' | 'rail' | 'review' | 'browser' | 'terminal', turnId: TurnId) => void;
  contextWindow?: number | null;
  reasoningProvider?: string | null;
  liveStatus?: ReturnType<typeof deriveAskLiveStatus> | null;
}) {
  switch (item.kind) {
    case 'restored':
      /*
       * ONE LINE, NOT A BADGE ON EVERY BUBBLE. The honesty is that these words
       * came back without the work/evidence that would prove them — saying that
       * once at the head of the restored stretch is enough; repeating it on
       * each bubble would look like a status chrome for every message.
       */
      return (
        <p className="restored" data-testid="chat-restored">
          {item.text}
        </p>
      );

    case 'memory-trim':
      return (
        <p className="restored" data-testid="chat-memory-trimmed">
          {item.text}
        </p>
      );

    case 'user':
      return <UserBubble turn={item.turn} />;

    case 'turn-elapsed':
      return <TurnElapsed ms={item.ms} live={item.live} />;

    case 'phase':
      return <PhaseCard crumb={item.crumb} label={item.label} elapsedMs={item.ms} />;

    case 'edits':
      return <EditsLedger summary={item.summary} />;

    case 'work': {
      const theaterLive = topologyTheaterActive(item.rows, { streaming: true });
      const theaterSteps = deriveTopologySteps(item.rows);
      const stackRows = filterTopologyTheaterRows(item.rows);
      return (
        <>
          {theaterLive ? <TopologyTheater steps={theaterSteps} live /> : null}
          {stackRows.length > 0 ? (
            <WorkProofStack
              rows={stackRows}
              reasoningProvider={reasoningProvider}
              roundTimer={liveStatus?.roundTimer ?? null}
              stallNotice={liveStatus?.stallNotice ?? null}
            />
          ) : null}
        </>
      );
    }

    case 'prose': {
      /*
       * NO ROLE LABEL, NO AVATAR, NO NUMBERED GUTTER, NO ACCENT BAR. v1 does
       * all three of the first ones at once — a numbered gutter, an uppercase
       * You/Sequence label, and both lanes left-aligned full width. Sheet 12.1
       * kills the role marker before the bubble question is even asked: indigo
       * is the product's own voice, and a 2px accent bar next to every
       * paragraph spends it until it means nothing.
       *
       * DECISION 7 — THE WORK FOLDS IN HERE. The narration rows this answer
       * rests on render INSIDE the flow, after its first paragraph (the
       * artifact's B panel), not as a detached trail beside it.
       *
       * TOOL JSON IS NOT PROSE. The model often streams propose_topology /
       * canvas.write_* as fences or bare JSON meant for the board/canvas.
       * Strip that into tool-call cards so the seat never stares at the dump.
       */
      const { stripped, tools } = stripToolProse(item.text);
      const blocks = proseBlocks(stripped);
      const covered = new Set(
        item.work.flatMap((row) => {
          const called = /^Called (\S+)$/.exec(row.verb)?.[1];
          return called ? [called] : [];
        }),
      );
      const hasTopologyTool = tools.some((t) => isTopologyToolName(t.name));
      const topologyCovered = covered.has('propose_topology') || topologyToolRow(item.work) !== null;
      const theaterLive = topologyTheaterActive(item.work, {
        hasOrphanTool: hasTopologyTool && !topologyCovered,
        streaming: item.streaming,
        streamText: item.text,
      });
      const theaterLanded = theaterLive && !item.streaming;
      const theaterSteps = deriveTopologySteps(item.work, {
        streamText: item.text,
        landed: theaterLanded,
      });
      const stackRows = filterTopologyTheaterRows(item.work);
      const orphanTools = tools.filter(
        (t) => !covered.has(t.name) && !(theaterLive && isTopologyToolName(t.name)),
      );
      const inlineStack =
        stackRows.length > 0 ? (
          <WorkProofStack
            rows={stackRows}
            inline
            reasoningProvider={reasoningProvider}
            roundTimer={liveStatus?.roundTimer ?? null}
            stallNotice={liveStatus?.stallNotice ?? null}
          />
        ) : null;
      const topologyTheater = theaterLive ? (
        <TopologyTheater steps={theaterSteps} live={item.streaming} />
      ) : null;
      const toolCards =
        orphanTools.length > 0 ? (
          <div className="tool-call-cards" data-testid="chat-tool-call-cards">
            {orphanTools.map((tool) => (
              <ToolCallCard key={tool.id} tool={tool} />
            ))}
          </div>
        ) : null;

      return (
        <div
          className="prose"
          data-testid="chat-prose"
          data-streaming={item.streaming || undefined}
          data-restored={isRestoredTurnId(item.turnId) || undefined}
        >
          {topologyTheater}
          {toolCards}
          {/* BOUNDED STRUCTURE — see `proseBlocks`. Fences and paired inline
              backticks only; emphasis, lists, headings, quotes and tables are
              deliberately not parsed, because every one of their markers also
              occurs in code the model is quoting. */}
          {blocks.map((block, index) => (
            <Fragment key={index}>
              {block.kind === 'code' ? (
                isToolDumpCode(block.language, block.text) ? (
                  (() => {
                    const name = toolNameFromDump(block.text);
                    if (theaterLive && isTopologyToolName(name)) return null;
                    return (
                      <ToolCallCard
                        tool={{
                          id: `fence-${index}`,
                          name,
                        }}
                        detail={block.text}
                      />
                    );
                  })()
                ) : (
                  <pre
                    className="prose-code"
                    data-testid="chat-code"
                    data-language={block.language ?? undefined}
                  >
                    <code>{block.text}</code>
                  </pre>
                )
              ) : (
                <p>
                  {block.spans.map((span, i) =>
                    span.code ? (
                      <code key={i} className="prose-tick" data-testid="chat-tick">
                        {span.text}
                      </code>
                    ) : (
                      <span key={i}>{span.text}</span>
                    ),
                  )}
                </p>
              )}
              {index === 0 ? inlineStack : null}
            </Fragment>
          ))}
          {/* COPY — sheet 12 line 551 specifies this exact control on a
              message: `<button class="iconbtn" aria-label="Copy">` with
              `#ic-copy`. Before this, the only way an answer left the product
              was dragging a mouse across a scrolling column.

              NOT WHILE STREAMING. Copying half an answer produces a truncated
              paste the reader will not notice is truncated, and the button
              would flicker in and out as the text lands. */}
          {item.streaming ? null : <CopyButton text={stripped || item.text} />}
        </div>
      );
    }

    case 'usage':
      /*
       * TOKENS, AND NOT A PRICE. The server owns the rate table and already
       * computes cost with it; duplicating those rates here would be a second
       * source of truth that drifts the first time a provider changes one, and
       * a wrong price is worse than no price in a product the user is paying
       * for directly. CANON law 4: never invent a number.
       */
      return (
        <>
          <p className="usage" data-testid="chat-usage" data-estimated={item.estimated || undefined}>
            <span className="usage-n">{item.inputTokens.toLocaleString()}</span>
            {contextWindow ? (
              <>
                {' of '}
                <span className="usage-n">{contextWindow.toLocaleString()}</span>
              </>
            ) : null}{' '}
            in · <span className="usage-n">{item.outputTokens.toLocaleString()}</span> out
            {item.estimated ? <span className="usage-est"> · estimated</span> : null}
          </p>
          {item.metrics ? (
            (() => {
              const diagnosis = formatAskMetricsDiagnosis(item.metrics);
              return diagnosis ? (
                <p className="usage" data-testid="chat-usage-diagnosis">
                  {diagnosis}
                </p>
              ) : null;
            })()
          ) : null}
        </>
      );

    case 'coverage':
      return (
        <p className="coverage" data-testid="chat-coverage">
          {item.text}
        </p>
      );

    case 'opens': {
      const target = item.row.opens;
      /*
       * THE PICTURE IS ON ANOTHER TAB AND NOTHING SAID SO.
       *
       * A teach turn draws its chart on the AI Canvas, and the only trace in
       * the chat was this row rendered exactly like "Read a file" — one of a
       * stack of tool rows a reader scans past. Measured at the seat: the
       * reader finished the lesson, saw prose and a closing question, and had
       * no reason to look at another surface. The derived visual, the one thing
       * that moved all night, was invisible to the person it was drawn for.
       *
       * A chart row therefore reads as a SENTENCE rather than as narration. It
       * is the same row and the same destination — nothing new is claimed and
       * no second affordance is invented — it simply stops looking like a log
       * line, because what it points at is the lesson's other half rather than
       * a step on the way to it.
       */
      if (item.row.from === 'chart:proposal') {
        return (
          <button
            type="button"
            className="chart-pointer"
            data-testid="chat-chart-pointer"
            onClick={target === null ? undefined : () => onOpen?.(target, item.turnId)}
          >
            <Icon name="chart" />
            <span>Drew a chart for this — open the AI Canvas</span>
          </button>
        );
      }
      return (
        <WorkRowLine
          row={item.row}
          bordered
          onOpen={target === null ? undefined : () => onOpen?.(target, item.turnId)}
        />
      );
    }

    case 'ending':
      /* A TURN ALWAYS ENDS IN WORDS. Muted, one line, in the tool-row register:
         it is a record of how the turn finished, not the assistant speaking,
         and it spends no hue even when the reason is a failure. */
      return (
        <div className="ending" data-testid="chat-ending" data-reason={item.reason}>
          <Icon name={item.reason === 'error' ? 'alert' : 'clock'} />
          <span>{item.text}</span>
        </div>
      );
  }
}


/**
 * THE EMPTY STATE IS A SCREEN, NOT A MESSAGE — centred rather than
 * bottom-anchored (MLH/shell.css:1178-1189). It names the affordance the
 * placeholder also names, because a person who has not typed yet is reading
 * here and not there. When nothing is attached, it also offers the attach
 * door — OpenCode boot puts attach in chat, not in a third empty pane.
 */
/** Three doors a first-time reader can walk through without knowing the product.
 *  Every one is GROUNDED — it asks about the attached repo, invents nothing —
 *  and every one fills the draft rather than sending, so the reader stays in
 *  charge of the turn. */
const STARTERS: readonly { label: string; ask: string }[] = [
  {
    label: 'Draw the architecture',
    ask: 'Draw a compact overview of this architecture on the board',
  },
  {
    label: 'What breaks easily?',
    ask: 'Which parts of this system does the most depend on — what breaks the most if it changes?',
  },
  {
    label: 'Explain a flow',
    ask: 'Walk me through what happens on the main entry path of this repo, step by step, citing files',
  },
];

function EmptyThread({
  onAttach,
  onStarter,
}: {
  onAttach?: () => void;
  onStarter?: (text: string) => void;
}) {
  return (
    <div className="emptychat" data-testid="chat-empty">
      <Icon name="board" size={16} />
      <span>
        {onAttach
          ? 'Ask anything to start. Attach a repository when you want answers grounded in what is actually there.'
          : 'Ask about this repo. Every answer names the evidence it came from.'}
      </span>
      {onAttach ? (
        <button
          type="button"
          className="emptychat-attach"
          data-testid="chat-empty-attach"
          onClick={onAttach}
        >
          Open a repository
        </button>
      ) : null}
      {!onAttach && onStarter ? (
        <div className="emptychat-starters" data-testid="chat-starters">
          {STARTERS.map((s) => (
            <button
              key={s.label}
              type="button"
              className="emptychat-starter"
              data-testid="chat-starter"
              title={s.ask}
              onClick={() => onStarter(s.ask)}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}


/**
 * COPY ONE MESSAGE.
 *
 * Sheet 12 line 551 draws it as an `iconbtn` with `aria-label="Copy"`, which is
 * what this is.
 *
 * IT SAYS WHETHER IT WORKED. `navigator.clipboard` is absent on an insecure
 * origin and can be denied by permission policy, so a button that always
 * flashed "Copied" would lie in exactly the case the reader most needs the
 * truth — they would paste nothing and not know why. Both outcomes are shown,
 * and the failure names the reason.
 */
function CopyButton({ text }: { text: string }) {
  const [said, setSaid] = useState<'idle' | 'done' | 'failed'>('idle');

  useEffect(() => {
    if (said === 'idle') return undefined;
    /* Back to idle, so the label does not sit there claiming a copy that
       happened a minute ago and may since have been overwritten. */
    const timer = setTimeout(() => setSaid('idle'), 1600);
    return () => clearTimeout(timer);
  }, [said]);

  return (
    <button
      type="button"
      className="prose-copy"
      data-testid="chat-copy"
      data-said={said}
      aria-label={said === 'done' ? 'Copied' : 'Copy this message'}
      onClick={() => {
        const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
        if (!clip?.writeText) {
          setSaid('failed');
          return;
        }
        void clip.writeText(text).then(
          () => setSaid('done'),
          () => setSaid('failed'),
        );
      }}
    >
      <Icon name={said === 'done' ? 'check' : 'copy'} size={12} />
      <span className="prose-copy-word">
        {said === 'done' ? 'Copied' : said === 'failed' ? 'Cannot copy here' : 'Copy'}
      </span>
    </button>
  );
}

/**
 * THE USER'S OWN QUESTION, REWRITABLE.
 *
 * `send` appends and never mutates, so a typo was permanent: the only remedy
 * was to ask a corrected question underneath the wrong one and leave both in
 * the thread — where both then went to the model as history, so it saw the
 * mistake as well as the correction.
 *
 * The control is on the USER'S turns only. Rewriting an assistant answer and
 * re-sending it as a question is a different act entirely, and one this
 * product should not offer at all: it would put words in the model's mouth and
 * then quote them back as though it had said them.
 */
function UserBubble({ turn }: { turn: UserTurn }) {
  return (
    <div
      className="userbubble"
      data-testid="chat-user-bubble"
      data-restored={isRestoredTurnId(turn.id) || undefined}
    >
      {turn.text}
    </div>
  );
}
