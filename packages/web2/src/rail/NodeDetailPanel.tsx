/* ══════════════════════════════════════════════════════════════════════════
   NODE DETAIL — item 4.3
   packages/web2/src/rail/NodeDetailPanel.tsx

   "Node detail — what it is, how (evidence files), parts, evidence refs,
   open-scope drill."

   THE SHAPE IS THE ENGINE'S, NOT A NEW ONE. `nodeDetail` arrives WITH the graph
   on `/archgraph.json`, derived per graph by `seqdNodeDetailFromStructuralTree`,
   and its slots are `{whatItIs, whatItDoes, parts[], talksTo[]}`
   (`packages/schema/src/seqdiagram.ts:97`). This panel renders those slots and
   invents no sixth.

   ONE LAYOUT, NOT FOUR. `state/types.ts` records what this replaces: "One layout
   — what it is, its parts, its files, its edges — replacing v1's four render
   branches selected by three booleans."

   ABSENCE IS RENDERED, NOT HIDDEN. A node the scanner produced no description for
   says so in a sentence. An empty `whatItIs` heading would be indistinguishable
   from a heading that failed to load, and Graphite law 4 — never invent a number
   — has the same force for a word.
   ══════════════════════════════════════════════════════════════════════════ */

import type { NodeDetailView } from '../state/types';

import { RailIcon, iconForKind } from './RailIcon';
import { evidenceRef } from './railModel';

export interface NodeDetailPanelProps {
  view: NodeDetailView;
  /**
   * THE ENDPOINT'S ENGLISH FOR THIS NODE — POST /api/annotate's bullets,
   * passed down by the rail from the canvas slice that holds the answer.
   * Absent or empty means the endpoint had nothing to say about this node:
   * the section is not drawn, and nothing announces the absence, because
   * "no annotation" is a fact about the scan and not an error.
   */
  annotations?: readonly string[] | null;
  onOpenScope: (nodeId: string) => void;
  onClose: () => void;
}

/**
 * How many rows of a list this panel shows before it counts the rest.
 *
 * MEASURED, not chosen: `svc:analyzer` on this repository owns 248 files, and
 * the first render of this panel printed all 248 into a column 280px wide —
 * which is not a detail panel, it is the file tree a second time. Twelve is
 * what fits beside the other three sections without the panel taking the whole
 * rail, and the remainder is SAID rather than dropped.
 */
const LIST_CAP = 12;

/** `+236 more` — derived from the list it summarises, so nothing is invented. */
function overflowNote(total: number): string | null {
  return total > LIST_CAP ? `+${(total - LIST_CAP).toLocaleString('en-US')} more` : null;
}

export function NodeDetailPanel({ view, annotations, onOpenScope, onClose }: NodeDetailPanelProps) {
  const { node, detail, files, edges } = view;
  const parts = detail?.parts ?? [];
  const bullets = annotations ?? [];

  return (
    <section className="rail-detail" data-testid="rail-detail" aria-label="Node detail">
      <div className="rail-detail-hd">
        <RailIcon name={iconForKind(node.kind)} />
        <span className="rail-detail-title" data-testid="rail-detail-title">
          {detail?.whatItIs || node.label}
        </span>
        <button
          type="button"
          className="rail-iconbtn"
          data-testid="rail-detail-close"
          aria-label="Close the detail"
          onClick={onClose}
        >
          <RailIcon name="x" />
        </button>
      </div>

      {detail?.whatItDoes?.trim() ? (
        <p className="rail-detail-does" data-testid="rail-detail-does">
          {detail.whatItDoes.trim()}
        </p>
      ) : (
        <p className="rail-detail-none" data-testid="rail-detail-none">
          The scan read this node and could not describe it.
        </p>
      )}

      {/* THE ANNOTATION — the same English the card carries, one section, in
          the endpoint's own words. GROUNDED ONLY: what the route returned is
          what prints, and an empty map draws no section at all. */}
      {bullets.length > 0 ? (
        <div className="rail-detail-sec">
          <span className="rail-detail-lbl">In plain English</span>
          <ul className="rail-detail-list">
            {/* FINDING F7 — the key is the line PLUS its index, never the line
                alone: the endpoint can return the same sentence twice, and two
                children on one key is reconciliation React refuses to promise
                anything about. */}
            {bullets.slice(0, LIST_CAP).map((line, index) => (
              <li key={`${index}:${line}`} className="rail-detail-note" data-testid="rail-detail-note">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/*
        `parts` IS OPTIONAL ON THE WIRE and is read as an empty list here, not
        asserted into existence. `SeqDiagramNodeDetail` declares it `parts?:`,
        and this repository's own `nodeDetail` proves both branches occur — the
        service slots carry a real list while several file-level slots carry
        none at all. A `!` here would be a runtime crash on a real node.
      */}
      {parts.length > 0 ? (
        <div className="rail-detail-sec">
          <span className="rail-detail-lbl">Parts</span>
          <ul className="rail-detail-list">
            {parts.slice(0, LIST_CAP).map((part) => (
              <li key={part} className="rail-detail-part mono" data-testid="rail-detail-part">
                <bdi>{part}</bdi>
              </li>
            ))}
          </ul>
          {overflowNote(parts.length) ? (
            <p className="rail-detail-more" data-testid="rail-detail-more">
              {overflowNote(parts.length)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        "HOW" IS THE FILE LIST, and it is the honest answer to it: this node is
        what these files are. Not a paraphrase of them — the paths themselves,
        which the reader can open.
      */}
      <div className="rail-detail-sec">
        <span className="rail-detail-lbl">
          {files.length > 0 ? `Evidence · ${files.length} files` : 'Evidence'}
        </span>
        {files.length > 0 ? (
          <ul className="rail-detail-list">
            {files.slice(0, LIST_CAP).map((file) => (
              <li key={file} className="rail-detail-file mono" data-testid="rail-detail-file">
                <bdi>{file}</bdi>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rail-detail-empty">The scan attributed no file to this node.</p>
        )}
        {overflowNote(files.length) ? (
          <p className="rail-detail-more" data-testid="rail-detail-more">
            {overflowNote(files.length)}
          </p>
        ) : null}
      </div>

      <div className="rail-detail-sec">
        <span className="rail-detail-lbl">
          {edges.length > 0 ? `Edges · ${edges.length}` : 'Edges'}
        </span>
        {edges.length > 0 ? (
          <ul className="rail-detail-list">
            {edges.slice(0, LIST_CAP).map((edge) => (
              <li key={edge.id} className="rail-detail-ref mono" data-testid="rail-detail-ref">
                <bdi>{evidenceRef(edge.evidence[0] ?? null)}</bdi>
              </li>
            ))}
          </ul>
        ) : (
          /*
            MEASURED, and the reason this sentence exists rather than an empty
            list: on this repository every one of the 997 scanned edges joins two
            FILE nodes, so a service card honestly has none of its own. A panel
            that borrowed its subtree's edges to fill the space would be
            answering a question the reader did not ask with a number they could
            not check.
          */
          <p className="rail-detail-empty">The scan found no edge on this node itself.</p>
        )}
        {overflowNote(edges.length) ? (
          <p className="rail-detail-more" data-testid="rail-detail-more">
            {overflowNote(edges.length)}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className="rail-scopebtn"
        data-testid="rail-detail-scope"
        onClick={() => onOpenScope(node.id)}
      >
        <RailIcon name="open" size={12} />
        Open scope
      </button>
    </section>
  );
}
