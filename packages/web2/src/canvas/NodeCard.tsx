/* ══════════════════════════════════════════════════════════════════════════
   THE ARCHITECTURE NODE CARD — item 3.3
   packages/web2/src/canvas/NodeCard.tsx

   Authored fresh against docs/brand/graphite/pages/02-the-architecture-node.html
   (the chassis) and pages/03-node-kinds-without-hue.html (the six silhouettes).
   Nothing here is ported: "pure modules are inherited, rendered chrome is not."

   THE ONE SENTENCE THE WHOLE CARD SERVES: tone and elevation buy the
   separation, so the border never has to. The card is --surface-2 through
   --arch-tone, --e1, and a border that is --edge in EVERY RESTING STATE. A card
   the same colour as the ground it lies on has only its outline left to argue
   with, and an outline loud enough to win that argument has stopped being
   chrome and become a claim.

   HEIGHT IS CONTENT. Width is fixed at --arch-card-w because a board reads as a
   board when its columns line up; height is not fixed and must not be. A card
   with a summary is taller than a card without, and that difference is a
   READING of the graph rather than noise in it. A ONE-LINE CARD IS A ONE-LINE
   CARD — which is why every slot below is conditional and why none of them
   reserves room it is not using.
   ══════════════════════════════════════════════════════════════════════════ */

import { Handle, Position } from '@xyflow/react';
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';

import { BoardIcon } from './BoardIcon.js';
import { cardWidth } from './cardBox.js';
import { displayLabel, labelNote } from './displayLabel.js';
import { glanceWithSource } from './glanceLine.js';
import {
  type KindPresentation,
  silhouetteClass,
  silhouetteLabel,
  silhouetteOf,
} from './kinds.js';
import { roleIconFor } from './roleIconMap.js';
import { glanceFont, measureWithCanvas } from './textFit.js';
import { visibilityAtWithSubtitleBoost } from './lod.js';
import type { LodRung } from '../state/types';

/**
 * WHAT THE CARD IS ALLOWED TO SAY, and it is exactly what the analyzer knows.
 *
 * Every field is nullable that can be absent, and nothing is defaulted into
 * existence. Graphite law 4 — never invent a number — applies here more than
 * anywhere: "every count on a node card is a placeholder. Members, callers,
 * callees, functions, lines — the engine computes all of them, and a plausible
 * number in a specimen is the exact failure Law 4 exists to prevent." So a
 * count reaches this component or it is not drawn; there is no zero.
 */
export interface BoardNode {
  id: string;
  /** `.nd-t`. The node's own name — the only thing on the card in --ink-1. */
  label: string;
  /**
   * The title as drawn at the far rungs: the full name wrapped to two lines,
   * shortened in the middle past that, at the board's one title size
   * (titleFit.ts). Absent ⇒ the full name. Never a shorter label
   * (coordinator ruling, round 3).
   */
  shortLabel?: string;
  /** The full title as drawn at the near rungs: the name wrapped to two lines
   *  at word breaks, shortened in the middle past that (titleFit.ts). Absent
   *  where it could not be measured: the name as is. */
  titleText?: string;
  /** The card's width in flow units (`cardWidth`), when it is not the fixed
   *  --arch-card-w. The board sets it from the same box ELK laid out. */
  cardW?: number;
  /** Far-zoom title fit: card content width over the title's measured width
   *  (Board.tsx `farFit`). Caps how far the far title is counter-scaled. */
  farFit?: number;
  /** The definition line's room, in its own (unscaled) px at the rung the card
   *  is drawn at: the words' column at 100%, less on the far rungs where the
   *  row is counter-scaled. Board.tsx sets it; absent, the line takes the
   *  summary and the stylesheet cuts it. */
  defRoom?: number;
  /** `.nd-s`. ONE line of summary, and absent when there is none. */
  subtitle: string | null;
  /**
   * WHAT THE SCAN KNOWS ABOUT THE THING, as one short line ("ts, express,
   * 6 files"; "redis, broker"), built by the host from the scanned node's own
   * metadata (`scanFacts.ts`). The card's definition line falls back to it when
   * there is no summary. Absent: the card says the kind word, and nothing is
   * invented to fill the line.
   */
  facts?: string | null;

  present: KindPresentation;
  /**
   * The literal schema kind, printed in the mono tag.
   *
   * Sheet 07: `module` and `package` share one silhouette and one icon BY
   * DECISION and are told apart by the schema kind printed here. Collapsing
   * either onto the other's word would assert a deployed thing about a package.
   */
  schemaKind: string;
  /**
   * How the analyzer knows this node exists.
   *
   * `traced` — it followed the thing in the source. `declared` — a manifest or
   * a config said so and the source could not confirm it. Declared is
   * --unknown and NEVER --wont, because a claim nobody could check has not
   * failed at anything. The two words are the edge proof vocabulary verbatim,
   * so a node and the connectors leaving it never disagree about what proof
   * means. `null` when the analyzer has nothing further to say — and then the
   * card has no footer at all, and is shorter for it.
   */
  provenance: 'traced' | 'declared' | null;
  /**
   * The one count on the right of the footer, already rendered as text by
   * whoever computed it. AT MOST ONE PROVENANCE TAG AND ONE COUNT: two tags and
   * the card has become a legend.
   */
  count: { label: string; value: string } | null;
  /**
   * THE NAMES THE COUNT ABOVE IS A COLLAPSE OF — the document's `detail.parts`,
   * in the document's own order, or absent.
   *
   * Nothing in the plain card reads it: at rest the card shows a title and one
   * line, and on selection it shows the numeral. Visual mode's strip is the
   * first reader (`visualMeta.ts`). `null` and not `[]` — see `project.ts`.
   */
  parts?: readonly string[] | null;
  /**
   * DRAWN, OR FOUND — and this one does not wait for a click.
   *
   * `provenance` above answers "what KIND of proof" and is drawn in the footer,
   * which only opens on the selected card. So an accepted proposal node — one
   * a model invented, which `docEdit` deliberately gives no `evidenceRef` —
   * was pixel-identical to a service the scanner proved on disk: same solid
   * border, same icon, same silhouette, in every subsequent glance, screenshot
   * and share. The dashed ghost border DID say so, and it is driven by
   * `proposalProjection.addedNodeIds`, which Accept clears — so the one signal
   * that distinguished an invention was exactly the state that ended the moment
   * the invention became part of the document.
   *
   * This is the same fact as a PERSISTENT one, off the same `evidenceRef` test
   * `generateGate` already uses. `false` is a positive statement that nothing on
   * disk points at this node; `undefined` is a projector that did not say, which
   * is what every hand-built fixture is, and it draws exactly what it drew
   * before.
   */
  grounded?: boolean;
  /**
   * THE ENDPOINT'S OWN ENGLISH, one bullet long, or absent.
   *
   * POST /api/annotate returns per-node bullets (`Record<id, string[]>`); the
   * host hands THIS node's first line here and nothing is invented when it
   * answers nothing. It draws at the rungs where `.nd-s` draws — the same
   * ladder row, the same room (see `cardHeight`).
   *
   * IT DOES REPLACE THE SCAN'S OWN SUBTITLE, and this comment used to say the
   * opposite. `glanceWithSource` returns the annotation FIRST and falls back to
   * the subtitle, so on any repository with a provider key bound the model's
   * sentence is the one on the card. The word "grounded" is gone from the line
   * above for the same reason: `parseAnnotations` validates that the KEY is a
   * node id the request asked about and never checks the STRING against any
   * evidence at all. That is why the card marks it — see the `.nd-s-ai` tag in
   * the render below.
   */
  annotation?: string | null;
  /** DIFF ON THE MAP (views/DiffView.tsx): what the branch did to this box.
   *  `removed` is a ghost: the branch deleted the module, the scan has none. */
  change?: 'added' | 'changed' | 'removed';
  /** Live program-run status overlay (agent-workflow launch). */
  runStatus?: 'pending' | 'running' | 'done' | 'failed' | 'waiting_human';
  /** COMPOSITE BOARD: the expanded group this card is drawn inside. */
  parentId?: string;
  /** COMPOSITE BOARD: set on an expanded group, which draws as a frame around
   *  its members. `shown` of `total` members are on the board. */
  group?: { shown: number; total: number; tests?: number };
}

/**
 * WHERE THE NODE STANDS IN THE PATH BEING READ — Decision 6, sheet 06 §06.1.
 * The dot carries STATE and never kind: selected → --accent, on-path → --info,
 * off-path → --st-neutral hollow. Null means no path/selection reading is live
 * and the card has no dot at all — rest stays at rest.
 */
export type DotState = 'selected' | 'onpath' | 'offpath';

export interface NodeCardProps {
  node: BoardNode;
  selected: boolean;
  /** Playback, explicit path-focus, and — by Decision 6 — explicit selection. */
  dimmed: boolean;
  /**
   * The status dot's state, derived by the host from the selection and the dim.
   * Absent at rest: the sheet says the dot carries "where the node stands in
   * the path being read", and with nothing being read there is no answer.
   */
  dot?: DotState | null;
  rung: LodRung;
  onSelect: (id: string, additive: boolean) => void;
  /**
   * Right-click. Optional because the card is also rendered by the specimen
   * page and by tests that are about the chassis, not about editing — and a
   * required callback there would make every one of them declare a handler for
   * a gesture it is not exercising.
   */
  onMenu?: (id: string, at: { x: number; y: number }) => void;
  /**
   * GO INSIDE THIS NODE. Optional: a board with no interior to show supplies
   * nothing and the card simply does not react to a double-click.
   *
   * The card does not know whether the node HAS an interior — that is the
   * scan's answer and it is decided by the owner, which is why this fires
   * unconditionally and the owner refuses when there is nothing inside.
   */
  onOpen?: (id: string) => void;
  /** Scan says children exist — show expand icon (double-click still works). */
  openable?: boolean;
  /**
   * S4 — this card is PROPOSED, not found.
   *
   * Drawn dashed, which is the one visual difference that reads as "not real
   * yet" without spending a hue. A ghost tinted with the accent would say the
   * product endorses it; a ghost at low opacity would say it is unimportant.
   * Dashed says provisional, which is what it is.
   */
  ghost?: boolean;
  /**
   * The far title yields to a neighbour's (see `farLabels.ts`). Painted
   * transparent, not removed: hovering the card brings it back.
   */
  labelYields?: boolean;
  /**
   * VISUAL MODE'S META STRIP, HANDED IN RATHER THAN BUILT HERE.
   *
   * The MADR's binding decision is that Visual is "a renderer over the existing
   * Projection", so it must not fork the card: one chassis, one silhouette, one
   * selection behaviour, one set of handles. A second card component would be
   * two answers to "what does a node look like", which is the defect
   * `project.ts`'s header opens by refusing.
   *
   * IT IS A SLOT AND NOT A FLAG so that nothing visual-only is reachable from
   * this module. The host passes a lazily-loaded element
   * (`visual/VisualMetaStrip.tsx`); a reader who turns Visual off never
   * evaluates it and never downloads it.
   *
   * IT REPLACES `.nd-ft` RATHER THAN JOINING IT. The footer already draws
   * provenance and the count, behind a selection; the strip draws those plus
   * the kind word at rest. Rendering both would print provenance twice on a
   * selected card, and `cardBox.ts` reserves room for exactly one row.
   */
  meta?: ReactNode;
  /**
   * ANATOMY'S WALL — the node's own children, packed inside its footprint.
   *
   * A SLOT, LIKE `meta`, AND FOR THE SAME TWO REASONS: nothing anatomy-only is
   * reachable from this module (the host passes a lazily-loaded element, so a
   * reader who never opens one never downloads it), and there is still exactly
   * one card component. A second card for "the opened one" would be two
   * answers to "what does a node look like".
   *
   * IT IS A THIRD GESTURE AND IT TOUCHES NEITHER OF THE OTHER TWO. `onOpen`
   * above is a MENU action and still REPLACES the view, one level at a time —
   * the board's standing ruling, enforced here, in `BoardMenu`, in
   * `ConnectedBoard.openedService`, and locked by `boardMenuRendered.test.tsx`.
   * A plain click is still selection. This slot adds no board node, no board
   * edge, no second structural level and no crumb trail: it draws ONE node's
   * contents inside that node. See `anatomy.ts` for the full reasoning, and
   * docs/COMPETITIVE-GAPS-2026-08-22.md §33 for the crumb trail that was built
   * and reverted for crossing that line.
   *
   * IT JOINS THE CARD RATHER THAN REPLACING ANYTHING, unlike `meta`. The strip
   * is one row about this node; the wall is a picture of what is inside it, and
   * they answer different questions. `cardBox` reserves room for both.
   */
  anatomy?: ReactNode;
}

/**
 * THE EIGHT HANDLES, AND WHY THEY ARE HERE AT ALL.
 *
 * Sheet 02.6 says a card that is not connectable renders ZERO handles, none in
 * the markup. @xyflow/react 12.11.2 makes that impossible: it measures every
 * edge endpoint off handle bounds in the DOM, and `EdgeWrapper` returns null
 * before the custom edge ever mounts when there is no handle to measure.
 * Delete these eight and every edge on the board disappears. board.css carries
 * the full evidence trail; `NodeCard.test.tsx` carries the lock.
 *
 * All three connectable props are false on every one. <Handle> defaults ALL
 * THREE to true and never reads the board's `nodesConnectable`, so without
 * these the nubs are live connection starters that happen to be un-clickable —
 * one `visibility` regression away from a board that drags connection lines it
 * will never accept.
 */
/**
 * The eight nubs, as ONE list.
 *
 * Exported because `Board.tsx` must DECLARE the same eight on every node object
 * — see the note there. Two lists that must agree is how an edge silently stops
 * being drawn, so there is one.
 */
export const HANDLE_SIDES: ReadonlyArray<[Position, string]> = [
  [Position.Top, 't'],
  [Position.Right, 'r'],
  [Position.Bottom, 'b'],
  [Position.Left, 'l'],
];

function InertHandles() {
  return (
    <>
      {HANDLE_SIDES.map(([position, key]) => (
        <Handle
          key={`s-${key}`}
          id={`s-${key}`}
          type="source"
          position={position}
          isConnectable={false}
          isConnectableStart={false}
          isConnectableEnd={false}
        />
      ))}
      {HANDLE_SIDES.map(([position, key]) => (
        <Handle
          key={`t-${key}`}
          id={`t-${key}`}
          type="target"
          position={position}
          isConnectable={false}
          isConnectableStart={false}
          isConnectableEnd={false}
        />
      ))}
    </>
  );
}

/** The kind, said on hover now that the key is gone: "Service", or "Entry · Service" for the entry position. */
function kindTitle(present: KindPresentation): string {
  const base = silhouetteLabel(present.kind);
  return present.entry ? `Entry, ${base}` : base;
}

/** Icon glyph — role heuristics on label; entry keeps base kind. */
function headerIcon(label: string, present: KindPresentation): ReturnType<typeof roleIconFor> {
  return roleIconFor(label, present);
}

/** Three words or more, and not a comma list of short tags. */
function isSentence(text: string): boolean {
  const t = text.trim();
  if (/^[\w.-]+$/.test(t)) return false;
  if (t.split(/\s+/).length < 3) return false;
  return !/^[\w-]+( [\w-]+)?(, [\w-]+( [\w-]+)?)+$/.test(t);
}

/** Whether a definition fits its line whole (UX audit, 2026-10-06: on
 *  codeforge 10 of 11 were cut at the fit). Measured in the line's own face
 *  where the board measured its room; a character count where it could not. */
function fitsDefinition(text: string, room: number | undefined): boolean {
  /* Unmeasured (no room handed in, or no 2D context): the line takes it and
     the stylesheet cuts it with an ellipsis, the whole of it in the tooltip. */
  if (room === undefined) return true;
  const ink = measureWithCanvas(text, glanceFont());
  /* No 2D context (jsdom) but a room: --t-11 Inter averages about 6.2px a
     character, which is what a test can reason with. */
  return Number.isFinite(ink) ? ink <= room : text.length * 6.2 <= room;
}

export function NodeCard({
  node,
  selected,
  dimmed,
  dot = null,
  rung,
  onSelect,
  onMenu,
  onOpen,
  openable = false,
  ghost,
  labelYields = false,
  meta = null,
  anatomy = null,
}: NodeCardProps) {
  const silhouette = silhouetteOf(node.present);
  /* First glance: icon + title + one English line. Kind tag, provenance and
     counts open when the card is selected (progressive disclosure). */
  const detail = selected;
  const glance = glanceWithSource(node.subtitle, node.annotation);
  const line = glance?.text ?? null;
  const show = visibilityAtWithSubtitleBoost(rung, Boolean(line));
  /* THE DEFINITION (Decision 49, Jaden: "a small definition under each
     title... in the reserved second line where it fits"). The summary when
     the scan or the assistant wrote one, else the scan's own facts about the
     thing, else the kind word. The card reserves its line under the two
     title lines (cardBox.ts CARD_TEXT_H), so it never moves a neighbour. */
  /* WHICH LINE, IN ORDER (UX audit, 2026-10-06: shopfront's cards read
     "default", "server", "worker", file stems, and 4 of 11 were cut off).
     A summary that is a sentence and fits the line comes first; then the
     scan's facts; then a longer summary (cut, with the whole of it in the
     tooltip); the kind word last. A single bare token is a stem, not a
     definition, and loses to the facts and the kind word. */
  const summary = glance ? { ...glance, text: glance.text.replace(/\s*\u00b7\s*/g, ', ') } : null;
  /* A summary earns the line only as a sentence: not a bare stem ("worker"),
     not a list of tags ("plan mode, replay"; "main, subscriber"). */
  const sentence = summary !== null && isSentence(summary.text);
  const fits = (text: string) => fitsDefinition(text, node.defRoom);
  const factsFirst = node.facts ? node.facts.split(', ')[0]! : null;
  const said: { text: string; source: 'scan' | 'ai' | 'facts' | 'kind' } =
    summary && sentence && fits(summary.text)
      ? summary
      : node.facts && fits(node.facts)
        ? { text: node.facts, source: 'facts' }
        : factsFirst && fits(factsFirst)
          ? { text: factsFirst, source: 'facts' }
          : { text: silhouetteLabel(node.present.kind), source: 'kind' };
  const definition = { ...said, text: said.text.replace(/\s*\u00b7\s*/g, ', ') };
  /* The tooltip carries the whole summary when the line shows something
     shorter, so nothing the scan or the assistant said is lost. */
  const definitionTitle = summary && summary.text !== definition.text ? summary.text : definition.text;

  const classes = [
    'node',
    silhouetteClass(silhouette),
    selected ? 'sel' : '',
    dimmed ? 'dim' : '',
    labelYields ? 'label-yields' : '',
    node.runStatus ? `run-${node.runStatus}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const pick = (event: MouseEvent | KeyboardEvent) => {
    // Shift and the platform's own multi-select modifier both extend. A board
    // that only honoured one of them would be right on one operating system.
    onSelect(node.id, event.shiftKey || event.metaKey || event.ctrlKey);
  };

  /* Double-click is the gesture every canvas uses for "go inside this", so it
     is found by trying rather than by being told. The single-click selection
     above still fires first — that is how a double-click works everywhere, and
     a card that suppressed selection to wait for a second click would feel
     broken to every reader who only wanted the first one. */
  function open(event: MouseEvent) {
    if (!onOpen) return;
    event.preventDefault();
    event.stopPropagation();
    onOpen(node.id);
  }

  function expand(event: MouseEvent) {
    open(event);
  }

  /* The browser menu is suppressed only where ours replaces it. Without a
     handler the platform menu stays — a card that swallows right-click and
     offers nothing back is worse than one that does not listen. */
  function menu(event: MouseEvent) {
    if (!onMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onMenu(node.id, { x: event.clientX, y: event.clientY });
  }

  /* Enter and Space on the card's own control select, with the modifier held,
     exactly as a click does. It is bound to THAT control and not to the card,
     so a keystroke on the open button (or on anything the anatomy wall draws)
     is that control's own: the card used to take Enter from its children and
     select instead of opening. */
  function keyPick(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    pick(event as unknown as MouseEvent);
  }

  /* RUNG 7 — the node is a MARK. The card box is now smaller than the box that
     would hold its own glyph, so it stops being an object. The mark says a node
     is here and stops there; the kind is read off the legend and the census,
     never off the card. The handles ride along, because an edge still has to
     terminate somewhere and the renderer still measures them off the DOM. */
  if (!show.card) {
    return (
      <button
        type="button"
        className="boardmark"
        data-testid="board-node"
        data-node-id={node.id}
        data-kind={silhouette}
        data-rung={rung}
        data-change={node.change}
        aria-label={node.change ? `${node.label}, ${node.change}` : node.label}
        onClick={pick}
        onContextMenu={menu}
      >
        <InertHandles />
      </button>
    );
  }

  /* THE CARD IS AS WIDE AS ITS NAME (`cardWidth`), the same answer the
     layout and the router used; the board hands it down as `cardW`. */
  const cardW = node.cardW ?? cardWidth(node.label);

  /* NO CONTROL INSIDE A CONTROL. The card used to be a `div[role=button]` with
     the open button inside it, which axe rates serious (nested-interactive):
     a screen reader flattens a button's children, so the open button was not
     announced, and the card swallowed Enter meant for it. Now the card itself
     is a plain group that keeps every MOUSE gesture it had (click, shift-click,
     double-click, right-click, drag — they land where they always landed),
     and the KEYBOARD / assistive-technology control is `.nd-hit`: a real
     button laid over the card with `pointer-events: none`, so it never
     intercepts a pointer, draws the focus ring around the whole card, and sits
     BESIDE the open button rather than around it. A click it receives from a
     screen reader bubbles to the card's own onClick, the same path a mouse
     click takes. */
  return (
    <div
      className={classes}
      data-testid="board-node"
      data-node-id={node.id}
      data-kind={silhouette}
      data-rung={rung}
      data-selected={selected ? 'true' : 'false'}
      data-dimmed={dimmed ? 'true' : 'false'}
      data-ghost={ghost ? 'true' : 'false'}
      data-change={node.change}
      /* Only ever written as a REFUSAL. Marking the grounded case too would put
         a tag on ten cards out of eleven and hide the one that matters. */
      data-grounded={node.grounded === false ? 'false' : undefined}
      style={cardStyle(cardW, node.farFit)}
      onClick={pick}
      onDoubleClick={open}
      onContextMenu={menu}
    >
      <InertHandles />

      <button
        type="button"
        className="nd-hit"
        data-testid="board-node-select"
        aria-label={node.label}
        aria-pressed={selected}
        onKeyDown={keyPick}
      />
      {node.change ? (
        <span className={`nd-change is-${node.change}`} data-testid="board-node-change">
          {node.change}
        </span>
      ) : null}

      {openable && onOpen ? (
        <button
          type="button"
          className="nd-expand"
          data-testid="board-node-expand"
          aria-label={`Expand ${node.label}`}
          title="Expand in place"
          onClick={expand}
        >
          <BoardIcon name="b-flow" size={14} />
        </button>
      ) : null}

      {/* ── THE CARD'S ONE ROW: THE ICON CHIP, THEN THE WORDS ─────────────
          Decision 49, the picked mix: a 30px chip holding the kind's glyph,
          a bold title, and one muted line of what the thing is. The row is
          centred in the card. On the far rungs the whole row is
          counter-scaled as one piece (board.css `.nd-in`), so the chip, the
          name and the definition keep their screen size together and the
          card's box (`cardBox.ts`) reserves it at that scale. */}
      <div className="nd-in">
        <span className="nd-ic" data-testid="board-node-icon" title={kindTitle(node.present)}>
          <BoardIcon name={headerIcon(node.label, node.present)} size={16} />
        </span>
        {(show.title || show.shortTitle) && (
          <div className="nd-tx">
            {show.title ? (
              <div className="nd-t" data-testid="board-node-title" title={labelNote(node.label) ? node.label : undefined}>
                {dot ? (
                  <span className={`nd-dot dot-${dot}`} data-dot={dot} aria-hidden="true" />
                ) : null}
                {node.titleText ?? displayLabel(node.label)}
              </div>
            ) : (
              <div className="nd-t nd-t-short" data-testid="board-node-title" title={node.label}>
                {node.shortLabel ?? displayLabel(node.label)}
              </div>
            )}
            {/* ── THE ONE SENTENCE A READER ACTUALLY READS, AND WHO WROTE IT ──
                An `/api/annotate` bullet outranks the scan's own summary, and
                it is marked with a word, not a hue: "AI", in the card's
                smallest type, before the sentence. The scan's lines carry no
                tag: the default on this surface is that what is drawn was
                measured. */}
            {definition.text ? (
              <div
                className="nd-s"
                data-testid={definition.source === 'scan' || definition.source === 'ai' ? 'board-node-glance' : 'board-node-def'}
                data-source={definition.source}
                title={definitionTitle}
              >
                {definition.source === 'ai' ? (
                  <span
                    className="nd-s-ai mono"
                    data-testid="board-node-glance-ai"
                    title="Written by the assistant from the scan, not read out of the code."
                  >
                    AI
                  </span>
                ) : null}
                {definition.text}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* VISUAL MODE'S STRIP TAKES THE FOOTER'S PLACE — see `meta` above. It
          obeys the same `show.footer` rung as the footer it replaces, because
          it is drawn in the same --t-10 ink and §05.8's first ladder row is
          where --t-10 leaves the card. */}
      {meta && show.footer ? meta : null}

      {/* THE WALL. Not gated on a rung: it is open because the reader opened
          it, and `cardBox` has already reserved its footprint. */}
      {anatomy}

      {/* Provenance + counts only when selected — progressive disclosure. */}
      {!meta && detail && show.footer && (node.provenance || node.count) ? (
        <div className="nd-ft">
          {node.provenance && (
            <span
              className={`prov ${node.provenance === 'traced' ? 'p-measured' : 'p-declared'}`}
              data-provenance={node.provenance}
            >
              {node.provenance === 'traced' ? 'Traced' : 'Declared'}
            </span>
          )}
          {node.count && (
            <span className="right mono" title={node.count.label}>
              {node.count.value}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function cardStyle(cardW: number, farFit: number | undefined): CSSProperties | undefined {
  const out: Record<string, string> = {};
  if (cardW !== 160) out['--arch-card-w'] = `${cardW}px`;
  if (farFit !== undefined) out['--far-fit'] = String(farFit);
  return Object.keys(out).length > 0 ? (out as CSSProperties) : undefined;
}
