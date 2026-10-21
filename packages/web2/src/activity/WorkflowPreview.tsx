/* ══════════════════════════════════════════════════════════════════════════
   WORKFLOW PREVIEW (0.1.8.4)
   packages/web2/src/activity/WorkflowPreview.tsx

   Jaden: "you cant preview premade loops, you should be able to preview that as a hover and then from there you can
   launch it". <WorkflowPreview> is the card (a header of name, step count and purpose, the mini flow, Open and Launch as the
   kit's s2 buttons); <WorkflowPreviewHover> wraps any row and shows the card on hover (after a short intent delay) or keyboard
   focus, in the top-layer popover. Reused by the rail and the Agents shelf.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Program, WorkflowBlock } from '@sequence/schema';

import { S2Icon, type S2IconName } from '../shell2/icons';
import { RailPopover, usePopoverDismiss, type PopRect } from '../rail/railPopover';
import { createWorkflowApi, type WorkflowApi } from './workflowClient';
import { flowFromBlocks, flowFromProgram, type PreviewFlow, type PreviewStep } from './workflowPreviewModel';

import './workflowPreview.css';

export interface WorkflowPreviewProps {
  /** A saved workflow, fetched by id. */
  workflowId?: string;
  /** Or the blocks / program directly. */
  blocks?: readonly WorkflowBlock[];
  program?: Program;
  name?: string;
  purpose?: string;
  onLaunch?: () => void;
  onOpen?: () => void;
  api?: WorkflowApi;
}

/** One glyph per block kind, from the app's own icon set. A plain step has none: it is a dot. */
const KIND_ICON: Record<Exclude<PreviewStep['kind'], 'step'>, S2IconName> = {
  agent: 'agents',
  deepen: 'layers',
  checker: 'check',
  test: 'bolt',
  finish: 'target',
  loop: 'undo',
};

/** What the loop-back row says: it returns to an earlier step, up to a number of times. */
export const loopWords = (max?: number): string => (max ? `Loops back, up to ${max}` : 'Loops back');

/** The steps in order, one per line, joined by a thin rail; a loop-back is a dashed, accent-coloured return, not a step. */
export function MiniFlow({ flow }: { flow: PreviewFlow }) {
  return (
    <ol className="wfp-flow" data-testid="wfp-flow" aria-label="Steps in order">
      {flow.steps.map((s, i) => (
        <li key={`${i}:${s.id}`} className="wfp-step" data-kind={s.kind} data-testid="wfp-step" title={s.title}>
          <span className="wfp-ico" aria-hidden="true">
            {s.kind === 'step' ? <span className="wfp-dot" /> : <S2Icon name={KIND_ICON[s.kind]} small />}
          </span>
          <span className="wfp-step-t">{s.kind === 'loop' ? loopWords(s.max) : s.title}</span>
        </li>
      ))}
    </ol>
  );
}

export function WorkflowPreview({ workflowId, blocks, program, name, purpose, onLaunch, onOpen, api }: WorkflowPreviewProps) {
  const client = useMemo(() => api ?? createWorkflowApi(), [api]);
  const [fetched, setFetched] = useState<{ name: string; blocks: WorkflowBlock[] } | null>(null);
  useEffect(() => {
    if (!workflowId || blocks || program) return undefined;
    const ctl = new AbortController();
    void client.get(workflowId, ctl.signal).then((r) => {
      if (!ctl.signal.aborted && r.ok) setFetched({ name: r.body.name, blocks: r.body.blocks });
    });
    return () => ctl.abort();
  }, [client, workflowId, blocks, program]);
  const flow = useMemo<PreviewFlow | null>(() => {
    if (blocks) return flowFromBlocks(blocks);
    if (program) return flowFromProgram(program);
    return fetched ? flowFromBlocks(fetched.blocks) : null;
  }, [blocks, program, fetched]);
  const title = name ?? fetched?.name ?? 'Workflow';
  return (
    <div className="wfp-card" data-testid="wfp-card" role="group" aria-label={`Preview of ${title}`}>
      <div className="wfp-head">
        <p className="wfp-name" title={title}>{title}</p>
        <span className="wfp-count" data-testid="wfp-count">{flow ? `${flow.count} ${flow.count === 1 ? 'step' : 'steps'}` : ''}</span>
      </div>
      {purpose ? <p className="wfp-purpose">{purpose}</p> : null}
      {flow ? <MiniFlow flow={flow} /> : <p className="wfp-purpose">Loading the steps.</p>}
      {onOpen || onLaunch ? (
        <div className="wfp-foot">
          {onOpen ? <button type="button" className="s2-btn s2-btn-sm" data-testid="wfp-open" onClick={onOpen}>Open</button> : null}
          {onLaunch ? <button type="button" className="s2-btn s2-btn-sm" data-testid="wfp-launch" onClick={onLaunch}>Launch</button> : null}
        </div>
      ) : null}
    </div>
  );
}

export const PREVIEW_OPEN_MS = 350;
export const PREVIEW_CLOSE_MS = 150;

/**
 * Shows the preview card on hover (after PREVIEW_OPEN_MS) or when focus enters; leaving, Escape or a press outside closes it.
 * The card is drawn in the top-layer popover root (rail/railPopover), so it spills over the chat or the canvas and never
 * leaves the window: beside the row when the row is in a list (the rail), under the whole shelf when the row is a chip in
 * one (data-wfp-anchor). The gap to the row is part of the card, so the pointer can cross it to reach Launch.
 */
export function WorkflowPreviewHover({ children, ...preview }: WorkflowPreviewProps & { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  /* Putting focus back on the row after Escape must not read as the focus that opens the card. */
  const quiet = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (to: boolean, ms: number) => {
    clear();
    timer.current = setTimeout(() => setOpen(to), ms);
  };
  useEffect(() => clear, []);
  const rowEl = () => hostRef.current?.querySelector<HTMLElement>('button, a[href], [tabindex]') ?? null;
  const focusRow = () => {
    quiet.current = true;
    rowEl()?.focus();
    quiet.current = false;
  };
  usePopoverDismiss(
    open,
    () => [hostRef.current, popRef.current],
    (why) => {
      clear();
      if (why === 'escape' && popRef.current?.contains(document.activeElement)) focusRow();
      setOpen(false);
    },
  );
  const group = open ? hostRef.current?.closest<HTMLElement>('[data-wfp-anchor]') ?? null : null;
  const anchor = (): PopRect | null => {
    const host = hostRef.current;
    if (!host) return null;
    const h = host.getBoundingClientRect();
    /* Under the whole group (a shelf of chips), not under its own chip, which would cover the chips below it. */
    return group ? { left: h.left, right: h.right, top: h.top, bottom: group.getBoundingClientRect().bottom } : h;
  };
  return (
    <div
      ref={hostRef}
      className="wfp-host"
      data-testid="wfp-host"
      onPointerEnter={() => later(true, PREVIEW_OPEN_MS)}
      onPointerLeave={() => later(false, PREVIEW_CLOSE_MS)}
      onFocus={() => {
        if (quiet.current) return;
        clear();
        setOpen(true);
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (!hostRef.current?.contains(to) && !popRef.current?.contains(to)) later(false, PREVIEW_CLOSE_MS);
      }}
      onKeyDown={(e) => {
        if (!open || e.key !== 'Tab') return;
        /* The card is in the body, not after the row: Tab from the row goes into it, and out of its ends goes back to the row. */
        const pop = popRef.current;
        if (!pop) return;
        const inPop = pop.contains(e.target as Node);
        const buttons = [...pop.querySelectorAll<HTMLElement>('button:not(:disabled)')];
        if (!inPop && !e.shiftKey && buttons.length > 0) {
          e.preventDefault();
          buttons[0]!.focus();
        } else if (inPop && ((e.shiftKey && e.target === buttons[0]) || (!e.shiftKey && e.target === buttons[buttons.length - 1]))) {
          e.preventDefault();
          focusRow();
        }
      }}
    >
      {children}
      {open ? (
        <RailPopover kind="card" prefer={group ? 'below' : 'right'} popRef={popRef} anchor={anchor} onPointerEnter={clear}>
          <WorkflowPreview {...preview} />
        </RailPopover>
      ) : null}
    </div>
  );
}
