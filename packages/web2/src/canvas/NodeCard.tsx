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
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

import { BoardIcon } from './BoardIcon.js';
import { displayLabel, shortBoardLabel } from './displayLabel.js';
import { glanceWithSource } from './glanceLine.js';
import {
  type KindPresentation,
  silhouetteClass,
  silhouetteOf,
} from './kinds.js';
import { roleIconFor } from './roleIconMap.js';
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
   * Sibling-aware condensed title for the far-zoom rung — the word that
   * DIFFERS among siblings, computed once per board in Board.tsx via
   * `distinctiveShortLabels`. Absent ⇒ `shortBoardLabel` (first word), which
   * on a family-named repo shows nine identical cards.
   */
  shortLabel?: string;
  /** `.nd-s`. ONE line of summary, and absent when there is none. */
  subtitle: string | null;
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
  /** Live program-run status overlay (agent-workflow launch). */
  runStatus?: 'pending' | 'running' | 'done' | 'failed' | 'waiting_human';
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

/** Icon glyph — role heuristics on label; entry keeps base kind. */
function headerIcon(label: string, present: KindPresentation): ReturnType<typeof roleIconFor> {
  return roleIconFor(label, present);
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

  const classes = [
    'node',
    silhouetteClass(silhouette),
    selected ? 'sel' : '',
    dimmed ? 'dim' : '',
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
        aria-label={node.label}
        onClick={pick}
        onContextMenu={menu}
      >
        <InertHandles />
      </button>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={classes}
      data-testid="board-node"
      data-node-id={node.id}
      data-kind={silhouette}
      data-rung={rung}
      data-selected={selected ? 'true' : 'false'}
      data-dimmed={dimmed ? 'true' : 'false'}
      data-ghost={ghost ? 'true' : 'false'}
      /* Only ever written as a REFUSAL. Marking the grounded case too would put
         a tag on ten cards out of eleven and hide the one that matters. */
      data-grounded={node.grounded === false ? 'false' : undefined}
      aria-pressed={selected}
      onClick={pick}
      onKeyDown={keyPick}
      onDoubleClick={open}
      onContextMenu={menu}
    >
      <InertHandles />

      {show.icon ? (
        <span className="nd-ic" data-testid="board-node-icon">
          <BoardIcon name={headerIcon(node.label, node.present)} size={14} />
        </span>
      ) : null}
      {openable && onOpen ? (
        <button
          type="button"
          className="nd-expand"
          data-testid="board-node-expand"
          aria-label={`Open inside ${node.label}`}
          title="Open inside"
          onClick={expand}
        >
          <BoardIcon name="flow" size={12} />
        </button>
      ) : null}

      {(show.title || show.shortTitle || (show.subtitle && line)) && (
        <div
          className={[
            'nd-body',
            line && show.subtitle ? 'with-sub' : 'title-only',
            !show.title && show.shortTitle ? 'short-title' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {show.title ? (
            <div className="nd-t" data-testid="board-node-title">
              {dot ? (
                <span className={`nd-dot dot-${dot}`} data-dot={dot} aria-hidden="true" />
              ) : null}
              {displayLabel(node.label)}
            </div>
          ) : show.shortTitle ? (
            <div className="nd-t nd-t-short" data-testid="board-node-title" title={displayLabel(node.label)}>
              {node.shortLabel ?? shortBoardLabel(node.label)}
            </div>
          ) : null}
          {/* ── THE ONE SENTENCE A READER ACTUALLY READS, AND WHO WROTE IT ──

              This slot takes an `/api/annotate` bullet in preference to the
              analyzer's own derived summary, and used to render both in one
              undifferentiated `.nd-s`. So on any repository with a provider key
              bound, the line that outranks and replaces the scan's answer on
              every card was model prose with no mark of any kind — and the
              reader had no way to tell which cards described what the scanner
              found and which described what a model guessed.

              THE MARK IS A WORD, NOT A HUE. Colour alone dies in greyscale and
              spends a hue Law 1 does not give the chrome; `--unknown` is
              already the ink this product uses for the unverified claim (it is
              what `.p-declared` takes), so the tag borrows the ink AND says the
              thing out loud. It is the card's smallest type and sits before the
              sentence, because a caveat after the claim is read second.

              The scan-derived line carries no tag at all: the default on this
              surface is that what is drawn was measured, and marking that would
              make the exception invisible again. */}
          {show.subtitle && glance ? (
            <div className="nd-s" data-testid="board-node-glance" data-source={glance.source}>
              {glance.source === 'ai' ? (
                <span
                  className="nd-s-ai mono"
                  data-testid="board-node-glance-ai"
                  title="Written by the assistant from the scan, not read out of the code."
                >
                  AI
                </span>
              ) : null}
              {glance.text}
            </div>
          ) : null}
        </div>
      )}

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
