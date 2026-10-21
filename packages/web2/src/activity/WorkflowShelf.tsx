/* The ready-made workflows and loops, and the ones saved in this project, as one short list. Each row previews on hover or
   focus (WorkflowPreview) and launches from the card. Lives at the top of the Workflows tab. */

import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_PROGRAMS, freshWorkflowBlocks, type Program } from '@sequence/schema';

import { WorkflowPreviewHover } from './WorkflowPreview';
import { createWorkflowApi, type WorkflowApi, type WorkflowView } from './workflowClient';

import './workflowPreview.css';

export function WorkflowShelf({
  onLaunch,
  onOpenEditor,
  api,
}: {
  /** Start this program through the run path. */
  onLaunch: (program: Program, name: string) => void;
  onOpenEditor?: () => void;
  api?: WorkflowApi;
}) {
  const client = useMemo(() => api ?? createWorkflowApi(), [api]);
  const [saved, setSaved] = useState<WorkflowView[]>([]);
  useEffect(() => {
    const ctl = new AbortController();
    void client.list(ctl.signal).then((r) => {
      if (!ctl.signal.aborted && r.ok) setSaved(r.body);
    });
    return () => ctl.abort();
  }, [client]);
  return (
    <section className="wfs" aria-label="Ready-made workflows" data-testid="workflow-shelf" data-wfp-anchor="">
      <span className="wfs-cap">Ready-made</span>
      <ul className="wfs-list">
        {BUILTIN_PROGRAMS.map((e) => (
          <li key={e.id}>
            <WorkflowPreviewHover name={e.title} purpose={e.blurb} program={e.build()} onLaunch={() => onLaunch(e.build(), e.title)} {...(onOpenEditor ? { onOpen: onOpenEditor } : {})}>
              <button type="button" className="s2-chipbtn wfs-row" data-testid="shelf-builtin" data-builtin-id={e.id}>{e.title}</button>
            </WorkflowPreviewHover>
          </li>
        ))}
        <li>
          <WorkflowPreviewHover name="Edit, check, test" purpose="An agent edits the code, a checker verifies it, your tests run." blocks={freshWorkflowBlocks()} {...(onOpenEditor ? { onOpen: onOpenEditor } : {})}>
            <button type="button" className="s2-chipbtn wfs-row" data-testid="shelf-blocks" onClick={onOpenEditor}>Ready-made blocks</button>
          </WorkflowPreviewHover>
        </li>
      </ul>
      {saved.length > 0 ? (
        <>
          <span className="wfs-cap">Saved</span>
          <ul className="wfs-list">
            {saved.map((w) => (
              <li key={w.id}>
                <WorkflowPreviewHover name={w.name} blocks={w.blocks} onLaunch={() => onLaunch(w.program, w.name)} {...(onOpenEditor ? { onOpen: onOpenEditor } : {})}>
                  <button type="button" className="s2-chipbtn wfs-row" data-testid="shelf-saved" data-workflow-id={w.id}>{w.name}</button>
                </WorkflowPreviewHover>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
