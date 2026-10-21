import { useState } from 'react';

import { WORKFLOW_KINDS } from './nodeSurface';
import type { NodeLink, NodeSurface, WorkflowAudience } from './nodeSurface';
import './nodeSurface.css';

/* ══════════════════════════════════════════════════════════════════════════
   THE NODE SUB-SURFACE (E5/E6) — what the scan knows about one node, and a
   button that asks the agent to draw the user workflow for it.
   packages/web2/src/canvas/NodeSurfacePanel.tsx

   Reuses the board's own controls (bseg for the audience, bpill for the
   button); the card is the Diff view's glass card. A section appears only
   when the scan recorded something for it.
   ══════════════════════════════════════════════════════════════════════════ */

const SHOWN = 8;

/** What Generate workflow did: drew on a Space, asked in chat, or could not. */
export type GenerateOutcome = { kind: 'space'; name: string | null } | { kind: 'chat' } | { kind: 'failed'; message: string };

const AUDIENCES: { id: WorkflowAudience; label: string; title: string }[] = [
  { id: 'auto', label: 'Auto', title: 'Let the agent tell from the code which interface this is' },
  { id: 'admin', label: 'Admin', title: 'The pages an administrator moves through' },
  { id: 'customer', label: 'Customer', title: 'The pages a customer moves through' },
];

function Links({ title, rows, testid }: { title: string; rows: readonly NodeLink[]; testid: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="ns-sec" data-testid={testid} aria-label={title}>
      <h3 className="ns-h">{`${title} (${rows.length})`}</h3>
      <ul className="ns-list">
        {rows.slice(0, SHOWN).map((r) => (
          <li key={r.id} className="ns-row" title={`${r.label}: ${r.via.join(', ')}`}>
            <span className="ns-name">{r.label}</span>
            <span className="ns-via">{r.via.join(', ')}</span>
            {r.count > 1 ? <span className="ns-n">{`×${r.count}`}</span> : null}
          </li>
        ))}
        {rows.length > SHOWN ? <li className="ns-more">{`+${rows.length - SHOWN} more`}</li> : null}
      </ul>
    </section>
  );
}

export function NodeSurfacePanel({
  surface,
  onClose,
  onGenerate,
}: {
  surface: NodeSurface;
  onClose: () => void;
  /** Resolves with what happened, so the panel can say so. */
  onGenerate: (audience: WorkflowAudience) => Promise<GenerateOutcome> | void;
}) {
  const [audience, setAudience] = useState<WorkflowAudience>('auto');
  const [status, setStatus] = useState<{ tone: 'busy' | 'ok' | 'fail'; text: string } | null>(null);
  const generate = async () => {
    setStatus({ tone: 'busy', text: 'Drawing the workflow...' });
    let out: GenerateOutcome | void;
    try {
      out = await onGenerate(audience);
    } catch (error) {
      return setStatus({ tone: 'fail', text: (error as Error).message || 'Could not generate the workflow.' });
    }
    if (!out) return setStatus(null);
    if (out.kind === 'space') setStatus({ tone: 'ok', text: out.name ? `Workflow drawn on the board "${out.name}" and opened in Spaces.` : 'Workflow drawn on a new board and opened in Spaces.' });
    else if (out.kind === 'chat') setStatus({ tone: 'ok', text: 'Asked the agent in chat to draw it on a board.' });
    else setStatus({ tone: 'fail', text: out.message });
  };
  const facts = [
    surface.language ? ['Language', surface.language] : null,
    surface.framework ? ['Framework', surface.framework] : null,
    surface.loc !== undefined ? ['Lines', surface.loc.toLocaleString('en-US')] : null,
    surface.owner ? ['Owner', surface.owner] : null,
  ].filter((x): x is string[] => x !== null);
  return (
    <aside className="ns-panel" data-testid="node-surface" data-node-id={surface.id} aria-label={`${surface.label}: what the scan knows`}>
      <header className="ns-hd">
        <div className="ns-title">
          <span className="ns-kind">{surface.kind}</span>
          <h2 className="ns-label" title={surface.path ?? surface.label}>
            {surface.label}
          </h2>
        </div>
        <button type="button" className="s2-ibtn s2-ibtn-sm ns-x" data-testid="node-surface-close" aria-label="Close" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="ns-body">
        {surface.description ? <p className="ns-desc">{surface.description}</p> : null}
        {facts.length > 0 ? (
          <dl className="ns-facts" data-testid="node-surface-facts">
            {facts.map(([k, v]) => (
              <div key={k} className="ns-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {surface.routes.length > 0 ? (
          <section className="ns-sec" data-testid="node-surface-routes" aria-label="Endpoints">
            <h3 className="ns-h">{`Endpoints (${surface.routes.length})`}</h3>
            <ul className="ns-list">
              {surface.routes.slice(0, SHOWN).map((r) => (
                <li key={`${r.method} ${r.path} ${r.file}:${r.line}`} className="ns-row" title={`${r.file}:${r.line}`}>
                  <span className="ns-method">{r.method}</span>
                  <span className="ns-name">{r.path}</span>
                </li>
              ))}
              {surface.routes.length > SHOWN ? <li className="ns-more">{`+${surface.routes.length - SHOWN} more`}</li> : null}
            </ul>
          </section>
        ) : null}
        <Links title="Depends on" rows={surface.dependsOn} testid="node-surface-deps" />
        <Links title="Called by" rows={surface.callers} testid="node-surface-callers" />
        {surface.files.length > 0 ? (
          <section className="ns-sec" data-testid="node-surface-files" aria-label="Files">
            <h3 className="ns-h">{`Files (${surface.files.length})`}</h3>
            <ul className="ns-list">
              {surface.files.slice(0, SHOWN).map((f) => (
                <li key={f} className="ns-row" title={f}>
                  <span className="ns-path" dir="rtl">{`‎${f}‎`}</span>
                </li>
              ))}
              {surface.files.length > SHOWN ? <li className="ns-more">{`+${surface.files.length - SHOWN} more`}</li> : null}
            </ul>
          </section>
        ) : null}
      </div>
      {WORKFLOW_KINDS.has(surface.kind) ? (
      <footer className="ns-ft">
        <div className="bseg" role="group" aria-label="Workflow audience" data-testid="node-surface-audience">
          {AUDIENCES.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`bseg-b${audience === a.id ? ' on' : ''}`}
              aria-pressed={audience === a.id}
              title={a.title}
              data-audience={a.id}
              onClick={() => setAudience(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button type="button" className="bpill ns-gen" data-testid="node-surface-generate" disabled={status?.tone === 'busy'} onClick={() => void generate()}>
          Generate workflow
        </button>
        {status ? (
          <p className={`ns-status is-${status.tone}`} role="status" data-testid="node-surface-status">
            {status.text}
          </p>
        ) : null}
      </footer>
      ) : null}
    </aside>
  );
}
