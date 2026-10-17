import type { ReactNode } from 'react';
import { AdvChapter, Figure, StatRow } from '@/components/lt/Breakdown';
import { Reveal } from '@/components/lt/hooks';
import { EDGE_EVIDENCE, GRADE, ORDERS_IMPACT } from '@/data/advantages';

/**
 * SYSTEM DESIGN, BROKEN DOWN. The art opens one real edge of the sample shop
 * to the lines the scanner cites; under it, the impact read for Orders: what
 * breaks if it changes and what it needs, before anything is edited. The
 * stats are the map graded against hand-labelled truth.
 *
 * Owner, second tour: the edge-opens moment once, cleanly. The art is not
 * drawn under 640 px, so there (and only there) the opened edge is a figure.
 */
function Code({ file, line, code, role }: { file: string; line: number; code: string; role: string }) {
  return (
    <div className="lt-ev-code">
      <p className="lt-ev-file">
        <span className="lt-ev-role">{role}</span>
        <span>
          {file}
          <b>:{line}</b>
        </span>
      </p>
      <pre>
        <span className="lt-ev-ln">{line}</span>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Node({ name, sub, on = false }: { name: string; sub: string; on?: boolean }) {
  return (
    <span className={`lt-ev-node ${on ? 'is-on' : ''}`}>
      <i aria-hidden="true" />
      <span>
        <b>{name}</b>
        <small>{sub}</small>
      </span>
    </span>
  );
}

function Side({ title, tone, items }: { title: string; tone: 'breaks' | 'needs'; items: readonly { name: string; via: string }[] }): ReactNode {
  return (
    <div className={`lt-imp-side is-${tone}`}>
      <p className="lt-imp-title">
        <i aria-hidden="true" />
        {title}
        <span>{items.length}</span>
      </p>
      <ul>
        {items.map((it) => (
          <li key={it.name}>
            <b>{it.name}</b>
            <code>{it.via}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdvSystem({ art }: { art?: ReactNode }) {
  return (
    <AdvChapter
      id="adv-system"
      kicker="System design"
      title="Every line on the map has a source."
      line="Sequence reads the architecture from your code. Each solid edge carries the file and line it was found in, so you see what a change touches before you make it."
      art={art}
      band
    >
      <Reveal className="lt-adv-grid lt-sys-one" delay={80}>
        <Figure title="One edge, opened" note="The lines the scanner found it on" className="lt-phone-only">
          <div className="lt-ev-edge">
            <Node name={EDGE_EVIDENCE.from} sub="ts, express" />
            <span className="lt-ev-wire" aria-hidden="true">
              <span className="lt-ev-wire-label">{EDGE_EVIDENCE.label}</span>
            </span>
            <Node name={EDGE_EVIDENCE.to} sub="py, fastapi" on />
          </div>
          <p className="lt-sr">
            {EDGE_EVIDENCE.from} calls {EDGE_EVIDENCE.to}: {EDGE_EVIDENCE.label}.
          </p>
          <ol className="lt-ev-rows">
            {EDGE_EVIDENCE.rows.map((r) => (
              <li key={`${r.call.line}`}>
                <Code role="Call" {...r.call} />
                <Code role="Handler" {...r.handler} />
              </li>
            ))}
          </ol>
          <div className="lt-ev-legend">
            <span>
              <i className="is-solid" /> Found in code, with file and line
            </span>
            <span>
              <i className="is-dashed" /> Only claimed
            </span>
          </div>
        </Figure>

        <Figure title="Impact, before you change Orders" note="What breaks, and what it needs">
          <div className="lt-imp">
            <Side title="Breaks if it changes" tone="breaks" items={ORDERS_IMPACT.breaks} />
            <div className="lt-imp-core" aria-hidden="true">
              <Node name="Orders" sub="py, fastapi" on />
            </div>
            <Side title="It needs" tone="needs" items={ORDERS_IMPACT.needs} />
          </div>
          <p className="lt-adv-fig-foot">
            Agents get the same answer through the <code>impact</code> tool: what breaks and what it needs, direct and
            transitive. An ambiguous name returns candidates, never a guess.
          </p>
        </Figure>
      </Reveal>

      <StatRow
        stats={[
          { label: 'Of hand-labelled service connections found', value: `${Math.round((GRADE.edgesFound / GRADE.edgesTruth) * 100)}%`, source: 'Measured on internal tests' },
          { label: 'Connections invented', value: String(Math.round((GRADE.edgesFound * (100 - GRADE.precision)) / 100)), source: 'Measured on internal tests' },
          { label: 'Kinds of project mapped in full: services, SPA, mobile, CLI, Kubernetes', value: `${GRADE.fixtures} of ${GRADE.fixtures}`, source: 'Measured on internal tests' },
        ]}
      />
    </AdvChapter>
  );
}
