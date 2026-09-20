import { REVIEW } from './anchors';
import { ReviewIcon } from './ReviewIcon';
import type { ReviewImpact } from './impactModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE IMPACT PANEL — item 5.5 / gap B2
   packages/web2/src/review/ImpactPanel.tsx

   "A diff shows the change; nothing shows the change's CONSEQUENCES on the
   system." This is the direct answer to the loudest structural complaint about
   agent coding — *"tests cannot catch code that deviates from the intent in
   some subtle way, while still being functional"* — and no competitor has it,
   because it is not a UI idea: it needs a parsed graph with `file:line` on
   every edge, which is what this product already is.

   FOUR SECTIONS, IN THE ORDER A REVIEWER CARES:

     what breaks   the touched nodes and their blast radius. Loudest, first.
     the proof     edges whose EVIDENCE is on a line you changed. The claim
                   nothing else can make.
     the callers   functions the changed lines are inside, and who calls them.
     the shape     cycles this change sits inside, and risks on touched nodes.

   THE HUE BUDGET, COUNTED. Two hues on this panel and both are claims:
   `--wont` on a cycle, which is a defect the graph found, and `--spills` on a
   risk, which is a warning about concentration. Everything else — every count,
   every id, every path — is ink. Sheet 12.7's rule is that a greyscale render
   must lose no meaning, so every coloured row is a word before it is a colour.

   THE GAPS RENDER. They are not a footnote and they are not omitted: a panel
   called "impact" is ASSUMED to include cycles created, so the sentence saying
   it cannot is load-bearing. CANON's first non-negotiable — "a tool that
   asserts a false edge with a citation is worse than no tool" — cuts both ways:
   a panel silently not-answering is a panel claiming there is nothing to say.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ImpactPanelProps {
  impact: ReviewImpact;
}

export function ImpactPanel({ impact }: ImpactPanelProps) {
  const nothing =
    impact.nodes.length === 0 &&
    impact.edges.length === 0 &&
    impact.functions.length === 0 &&
    impact.cycles.length === 0 &&
    impact.risks.length === 0;

  return (
    <aside className="rv-impact" data-testid={REVIEW.impact} aria-label="Impact of this change">
      <div className="rv-impact-hd">Impact</div>

      {impact.nodes.length > 0 ? (
        <section className="rv-impact-sec">
          <h3 className="rv-impact-h">What breaks</h3>
          {impact.nodes.map((node) => (
            <div
              key={node.nodeId}
              className="rv-impact-row"
              data-testid={REVIEW.impactNode}
              data-node-id={node.nodeId}
            >
              <span className="rv-impact-name">{node.label}</span>
              <span className="rv-impact-id mono">{node.nodeId}</span>
              {/* THE COUNT AND THE NAMES, not the count alone. "3 dependents"
                  is a number the reader has to trust; the ids are a number the
                  reader can check, which is sheet 12.2's own rule about a
                  quantity telling the truth about where it came from. */}
              <span className="rv-impact-note">
                {node.impactedBy.length === 0
                  ? 'nothing depends on it'
                  : `${node.impactedBy.length} break${node.impactedBy.length === 1 ? 's' : ''} if it fails — ${node.impactedBy.join(', ')}`}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {impact.edges.length > 0 ? (
        <section className="rv-impact-sec">
          <h3 className="rv-impact-h">Edges grounded on a line you changed</h3>
          {impact.edges.map((edge) => (
            <div key={edge.edgeId} className="rv-impact-row" data-testid={REVIEW.impactEdge}>
              <ReviewIcon name="flow" size={12} />
              <span className="rv-impact-name mono">
                {edge.srcId} → {edge.dstId}
              </span>
              <span className="rv-impact-kind">{edge.kind}</span>
              <span className="rv-impact-cite mono">
                {edge.file}:{edge.line}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {impact.functions.length > 0 ? (
        <section className="rv-impact-sec">
          <h3 className="rv-impact-h">Functions you changed, and who calls them</h3>
          {impact.functions.map((fn) => (
            <div key={fn.id} className="rv-impact-row" data-testid={REVIEW.impactFn}>
              <ReviewIcon name="fn" size={12} />
              <span className="rv-impact-name mono">{fn.name}</span>
              <span className="rv-impact-cite mono">
                {fn.file}:{fn.startLine}
              </span>
              <span className="rv-impact-note">
                {fn.callers.length === 0
                  ? 'no caller was traced'
                  : `${fn.callers.length} caller${fn.callers.length === 1 ? '' : 's'}: ${fn.callers
                      .map((c) => `${c.name} (${c.file}:${c.startLine})`)
                      .join(', ')}`}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {impact.cycles.length > 0 || impact.risks.length > 0 ? (
        <section className="rv-impact-sec">
          <h3 className="rv-impact-h">The shape around it</h3>
          {impact.cycles.map((cycle) => (
            <div
              key={cycle.nodes.join('>')}
              className="rv-impact-row rv-impact-cycle"
              data-testid={REVIEW.impactCycle}
            >
              <ReviewIcon name="alert" size={12} />
              <span className="rv-impact-name">Cycle</span>
              <span className="rv-impact-id mono">{cycle.labels.join(' → ')}</span>
              <span className="rv-impact-note">{cycle.reason}</span>
            </div>
          ))}
          {impact.risks.map((risk) => (
            <div
              key={risk.nodeId}
              className="rv-impact-row rv-impact-risk"
              data-testid={REVIEW.impactRisk}
            >
              <ReviewIcon name="alert" size={12} />
              <span className="rv-impact-name">{risk.severity}</span>
              <span className="rv-impact-id mono">{risk.label}</span>
              <span className="rv-impact-note">{risk.reason}</span>
            </div>
          ))}
        </section>
      ) : null}

      {impact.unmapped.length > 0 ? (
        <section className="rv-impact-sec">
          <h3 className="rv-impact-h">Not in the scanned graph</h3>
          {impact.unmapped.map((path) => (
            <div key={path} className="rv-impact-row" data-testid={REVIEW.impactUnmapped}>
              <span className="rv-impact-cite mono">{path}</span>
              <span className="rv-impact-note">no scanned node owns this path</span>
            </div>
          ))}
        </section>
      ) : null}

      {nothing && impact.gaps.length === 0 ? (
        <p className="rv-impact-note">
          Nothing in the scanned graph touches these files.
        </p>
      ) : null}

      {impact.gaps.length > 0 ? (
        <section className="rv-impact-sec rv-impact-gaps">
          <h3 className="rv-impact-h">Not measured</h3>
          {impact.gaps.map((gap) => (
            <p key={gap} className="rv-impact-gap" data-testid={REVIEW.impactGap}>
              {gap}
            </p>
          ))}
        </section>
      ) : null}
    </aside>
  );
}
