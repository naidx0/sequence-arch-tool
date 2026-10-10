/* ══════════════════════════════════════════════════════════════════════════
   THE WORKFLOW EDITOR (round 13, A8): a pop-up of ready-made blocks
   packages/web2/src/activity/WorkflowEditor.tsx

   Jaden: "Start fresh with ready-made verified blocks (Agent/Builder, Checker,
   Test runner, Finish, Loop), each assignable to a connected agent and model.
   Users can drag and edit blocks, and can also ask an agent in chat to edit the
   workflow graph."

   The server is the only copy. Every drag, click and field change is an op sent
   to `/api/workflows/:id/ops` and the answer replaces what is on screen; the
   chat agent's `edit_workflow` tool sends the same ops, and this pop-up polls the
   workflow's `rev`, so an agent's edit appears here without a reload (and says
   so). The graph on the right is the same WorkflowGraph a run is drawn with,
   fed the program the server compiled, so what is drawn is what would run.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { BLOCK_INFO, BLOCK_KINDS, TEST_COMMANDS, loopBodies, type BlockKind, type WorkflowBlock, type WorkflowOp } from '@sequence/schema';

import { trapFocus } from '../shell/focusTrap';
import { WorkflowGraph } from './WorkflowGraph';
import { createWorkflowApi, dropOp, rebaseOps, type AgentModelChoice, type ConnectedAgent, type WorkflowApi, type WorkflowView } from './workflowClient';

import './workflowEditor.css';

const POLL_MS = 2500;

/** One glyph per block kind, on a 16 grid at the 1.5 stroke like the tab glyphs. */
export function BlockGlyph({ kind }: { kind: BlockKind }) {
  const c = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;
  switch (kind) {
    case 'agent':
      return (
        <svg {...c}>
          <path d="M8 1.8 13.4 4.9v6.2L8 14.2 2.6 11.1V4.9z" />
          <circle cx="8" cy="8" r="1.8" />
        </svg>
      );
    case 'checker':
      return (
        <svg {...c}>
          <circle cx="8" cy="8" r="6" />
          <path d="m5.4 8.2 1.8 1.8 3.4-3.6" />
        </svg>
      );
    case 'test':
      return (
        <svg {...c}>
          <path d="M6 2.5h4M7 2.5v4L3.6 12a1.3 1.3 0 0 0 1.1 2h6.6a1.3 1.3 0 0 0 1.1-2L9 6.5v-4" />
          <path d="M5.2 10.5h5.6" />
        </svg>
      );
    case 'loop':
      return (
        <svg {...c}>
          <path d="M3 8a5 5 0 0 1 8.6-3.5L13 6" />
          <path d="M13 2.8V6h-3.2" />
          <path d="M13 8a5 5 0 0 1-8.6 3.5L3 10" />
          <path d="M3 13.2V10h3.2" />
        </svg>
      );
    case 'finish':
      return (
        <svg {...c}>
          <path d="M3.5 14V2.5" />
          <path d="M3.5 3h8l-1.8 2.7L11.5 8.5h-8" />
        </svg>
      );
  }
}

/** One short line for a block: the agent and model by the names the selects show, never the raw ids. */
function subtitle(b: WorkflowBlock, agentName: (id: string) => string, modelName: (agent: string | undefined, id: string) => string): string {
  switch (b.kind) {
    case 'agent':
      return [b.agentRef ? agentName(b.agentRef) : 'Default agent', b.model ? modelName(b.agentRef, b.model) : "Agent's own model", b.intent === 'ask' ? 'reads only' : null].filter(Boolean).join(', ');
    case 'test':
      return b.command ?? TEST_COMMANDS[0];
    case 'loop':
      return `up to ${b.maxIterations ?? 3} times, the next ${b.span ?? 1} block${(b.span ?? 1) === 1 ? '' : 's'}`;
    case 'checker':
      return 'no model, checks the real graph';
    case 'finish':
      return 'ends here';
  }
}

/** What identifies a version of a workflow: its revision and a hash of what is in it. */
const signature = (v: Pick<WorkflowView, 'rev' | 'name' | 'blocks'>): string => {
  const text = JSON.stringify([v.name, v.blocks]);
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${v.rev}:${h.toString(36)}`;
};

export interface WorkflowEditorProps {
  onClose: () => void;
  /** Start a run of this program; resolves to a sentence when it was refused, null when started. */
  onRun: (wf: WorkflowView) => Promise<string | null>;
  api?: WorkflowApi;
  pollMs?: number;
}

export function WorkflowEditor({ onClose, onRun, api: injected, pollMs = POLL_MS }: WorkflowEditorProps) {
  const api = useMemo(() => injected ?? createWorkflowApi(), [injected]);
  const [list, setList] = useState<WorkflowView[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [agentEdit, setAgentEdit] = useState(false);
  const [agents, setAgents] = useState<ConnectedAgent[]>([]);
  const [models, setModels] = useState<Record<string, AgentModelChoice[]>>({});
  const [running, setRunning] = useState(false);
  const [overAt, setOverAt] = useState<number | null>(null);
  /* The version each workflow was last known at (revision and content hash), and a counter that says a write of ours is in flight. */
  const known = useRef<Record<string, { rev: number; sig: string }>>({});
  const epoch = useRef(0);
  const inflight = useRef(0);
  const dlg = useRef<HTMLDivElement | null>(null);

  const wf = list?.find((w) => w.id === openId) ?? null;

  const take = useCallback((view: WorkflowView, own: boolean) => {
    known.current[view.id] = { rev: view.rev, sig: signature(view) };
    void own;
    setList((cur) => {
      const rest = (cur ?? []).filter((w) => w.id !== view.id);
      const idx = (cur ?? []).findIndex((w) => w.id === view.id);
      const next = idx < 0 ? [view, ...rest] : [...rest.slice(0, idx), view, ...rest.slice(idx)];
      return next;
    });
  }, []);

  /* Load every workflow and the connected agents once. */
  useEffect(() => {
    const ctl = new AbortController();
    void api.list(ctl.signal).then((r) => {
      if (ctl.signal.aborted) return;
      if (!r.ok) return setFailure(r.message), setList([]);
      setList(r.body);
      setOpenId((cur) => cur ?? r.body[0]?.id ?? null);
      r.body.forEach((w) => (known.current[w.id] = { rev: w.rev, sig: signature(w) }));
    });
    void api.agents(ctl.signal).then((r) => {
      if (!ctl.signal.aborted && r.ok) setAgents(r.body);
    });
    return () => ctl.abort();
  }, [api]);

  /* The models of every agent a block names (and the selected one), so rows show model names and a model the agent cannot
     switch to is flagged. */
  const selBlock = wf?.blocks.find((b) => b.id === selected) ?? null;
  const modelAgent = selBlock?.kind === 'agent' ? selBlock.agentRef ?? agents[0]?.id ?? null : null;
  const needed = Array.from(new Set((wf?.blocks ?? []).filter((b) => b.kind === 'agent').map((b) => b.agentRef ?? agents[0]?.id).filter((x): x is string => !!x)));
  const neededKey = needed.join('|');
  useEffect(() => {
    const ctl = new AbortController();
    for (const ref of neededKey ? neededKey.split('|') : []) {
      if (models[ref]) continue;
      void api.models(ref, ctl.signal).then((r) => {
        if (!ctl.signal.aborted) setModels((m) => (m[ref] ? m : { ...m, [ref]: r.ok ? r.body : [] }));
      });
    }
    return () => ctl.abort();
  }, [api, neededKey, models]);

  /* An agent's edit arrives by polling the open workflow's rev. */
  useEffect(() => {
    if (!openId) return undefined;
    const id = setInterval(() => {
      const el = document.activeElement;
      if (el && dlg.current?.contains(el) && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      const startedAt = epoch.current;
      if (inflight.current > 0) return;
      void api.get(openId).then((r) => {
        if (!r.ok) return;
        /* An answer that began before one of our own writes, or while it was in flight, is old news. */
        if (epoch.current !== startedAt || inflight.current > 0) return;
        const have = known.current[openId];
        if (have && r.body.rev < have.rev) return;
        if (have && have.sig === signature(r.body)) return;
        known.current[openId] = { rev: r.body.rev, sig: signature(r.body) };
        setAgentEdit(true);
        setList((cur) => (cur ?? []).map((w) => (w.id === openId ? r.body : w)));
      });
    }, pollMs);
    return () => clearInterval(id);
  }, [api, openId, pollMs]);

  useEffect(() => {
    const root = dlg.current;
    if (!root) return undefined;
    return trapFocus(root);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const send = useCallback(
    async (ops: WorkflowOp[]) => {
      if (!openId) return;
      setFailure(null);
      inflight.current += 1;
      epoch.current += 1;
      const ours = wf?.id === openId ? wf.blocks : [];
      try {
        let r = await api.ops(openId, ops, known.current[openId]?.rev);
        if (!r.ok && r.status === 409) {
          /* Someone else (an agent in chat) edited in between: take their version, say so, and apply this change on top. */
          const fresh = await api.get(openId);
          if (fresh.ok) {
            take(fresh.body, false);
            setAgentEdit(true);
            /* positions meant places between named blocks in our copy: say them by id on theirs */
            r = await api.ops(openId, rebaseOps(ops, ours, fresh.body.blocks), fresh.body.rev);
          }
        }
        if (!r.ok) return setFailure(r.message);
        take(r.body, true);
      } finally {
        inflight.current -= 1;
        epoch.current += 1;
      }
    },
    [api, openId, take, wf],
  );

  const startFresh = useCallback(
    async (from: 'fresh' | 'empty') => {
      setFailure(null);
      const r = await api.create(from === 'fresh' ? 'New workflow' : 'Empty workflow', from);
      if (!r.ok) return setFailure(r.message);
      take(r.body, true);
      setAgentEdit(false);
      setOpenId(r.body.id);
      setSelected(r.body.blocks[0]?.id ?? null);
    },
    [api, take],
  );

  const onDropAt = (e: DragEvent, index: number) => {
    e.preventDefault();
    setOverAt(null);
    const id = e.dataTransfer.getData('text/wf-id');
    const kind = e.dataTransfer.getData('text/wf-kind');
    if (id) void send([dropOp({ id }, index)]);
    else if (kind) void send([dropOp({ kind }, index)]);
  };

  const agentName = (id: string): string => agents.find((a) => a.id === id)?.label ?? id;
  const modelName = (agent: string | undefined, id: string): string => (models[agent ?? agents[0]?.id ?? ''] ?? []).find((m) => m.id === id)?.name ?? id;
  const bodies = wf ? loopBodies(wf.blocks) : new Map<number, number[]>();
  const inside = new Set<number>();
  bodies.forEach((b) => b.forEach((j) => inside.add(j)));
  const movable = wf ? wf.blocks.filter((b) => b.kind !== 'finish').length : 0;
  const hasFinish = !!wf?.blocks.some((b) => b.kind === 'finish');
  const emptyLoop = wf ? wf.blocks.find((b, i) => b.kind === 'loop' && (bodies.get(i) ?? []).length === 0) ?? null : null;
  const emptyWhy = emptyLoop ? `"${emptyLoop.title}" has nothing inside it. Give it a block or remove it.` : null;
  const modelNotes = (wf?.blocks ?? []).flatMap((b) => {
    if (b.kind !== 'agent' || !b.model) return [];
    const list = models[b.agentRef ?? agents[0]?.id ?? ''];
    if (!list || list.some((m) => m.id === b.model)) return [];
    return [`"${b.title}" names model ${b.model}, which its agent does not offer here, so the run would stop at it.`];
  });

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="s2 s2-scrim wfe-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dlg} className="wfe" role="dialog" aria-modal="true" aria-label="Workflow editor" data-testid="wfe">
        <header className="wfe-head">
          <h3 className="wfe-title">Workflow editor</h3>
          {list && list.length > 0 ? (
            <select className="wfe-select" aria-label="Workflow" data-testid="wfe-pick" value={openId ?? ''} onChange={(e) => { setOpenId(e.target.value); setSelected(null); setAgentEdit(false); }}>
              {list.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          ) : null}
          <span className="wfe-spacer" />
          <button type="button" className="wfe-btn" data-testid="wfe-fresh" onClick={() => void startFresh('fresh')}>Start fresh</button>
          {emptyWhy ? <span className="wfe-why" data-testid="wfe-run-why" title={emptyWhy}>{emptyWhy}</span> : null}
          {wf ? (
            <button
              type="button"
              className="wfe-btn wfe-btn-solid"
              data-testid="wfe-run"
              disabled={running || !wf.valid || !!emptyWhy}
              title={emptyWhy ?? (wf.valid ? 'Run this workflow' : wf.errors.join('. '))}
              onClick={() => {
                setRunning(true);
                void onRun(wf).then((m) => {
                  setRunning(false);
                  if (m) setFailure(m);
                  else onClose();
                });
              }}
            >
              Run
            </button>
          ) : null}
          <button type="button" className="wfe-x" aria-label="Close the editor" title="Close (Esc)" data-testid="wfe-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
          </button>
        </header>

        {agentEdit ? (
          <p className="wfe-banner" role="status" data-testid="wfe-agent-edit">An agent changed this workflow. What you see is the new version.</p>
        ) : null}
        {failure ? <p className="wfe-banner wfe-banner-fail" role="alert" data-testid="wfe-failure">{failure}</p> : null}

        {list === null ? (
          <p className="wfe-empty">Loading workflows.</p>
        ) : !wf ? (
          <div className="wfe-start" data-testid="wfe-start">
            <h4>Start fresh</h4>
            <p>Begin with ready-made blocks: an agent edits the code, a checker verifies it against the real graph, your tests run, and it finishes. Change, reorder or add blocks after. You can also ask an agent in chat to edit it.</p>
            <div className="wfe-start-row">
              <button type="button" className="wfe-btn wfe-btn-solid" data-testid="wfe-start-fresh" onClick={() => void startFresh('fresh')}>Start fresh with ready-made blocks</button>
              <button type="button" className="wfe-btn" data-testid="wfe-start-empty" onClick={() => void startFresh('empty')}>Empty workflow</button>
            </div>
          </div>
        ) : (
          <div className="wfe-body">
            <section className="wfe-pal" aria-label="Ready-made blocks" data-testid="wfe-palette">
              <span className="wfe-cap">Add a block</span>
              {BLOCK_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="wfe-chip"
                  draggable
                  data-testid={`wfe-add-${k}`}
                  disabled={k === 'finish' && hasFinish}
                  title={k === 'finish' && hasFinish ? 'The workflow already ends with Finish' : `${BLOCK_INFO[k].blurb}. Click to add, or drag it into the list.`}
                  onDragStart={(e) => { e.dataTransfer.setData('text/wf-kind', k); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => void send([{ op: 'add', kind: k }])}
                >
                  <BlockGlyph kind={k} />
                  <span>{BLOCK_INFO[k].label}</span>
                </button>
              ))}
            </section>

            <div className="wfe-cols">
              <section className="wfe-list" aria-label="Blocks" data-testid="wfe-list" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverAt(null); }}>
                <input
                  className="wfe-name"
                  aria-label="Workflow name"
                  data-testid="wfe-name"
                  defaultValue={wf.name}
                  key={`${wf.id}:${wf.name}`}
                  maxLength={80}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== wf.name) void send([{ op: 'rename', name: v }]); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
                <ol className="wfe-blocks">
                  {wf.blocks.map((b, i) => {
                    const isFinish = b.kind === 'finish';
                    return (
                      <li
                        key={b.id}
                        className="wfe-row"
                        data-testid="wfe-block"
                        data-block-id={b.id}
                        data-kind={b.kind}
                        data-inside={inside.has(i) ? 'true' : undefined}
                        data-over={overAt === i ? 'true' : undefined}
                        onDragOver={(e) => { e.preventDefault(); setOverAt(Math.min(i, movable)); }}
                        onDrop={(e) => onDropAt(e, Math.min(i, movable))}
                      >
                        <div
                          className="wfe-block"
                          data-selected={selected === b.id ? 'true' : 'false'}
                          draggable={!isFinish}
                          onDragStart={(e) => { e.dataTransfer.setData('text/wf-id', b.id); e.dataTransfer.effectAllowed = 'move'; }}
                          onClick={() => setSelected(b.id)}
                        >
                          <span className="wfe-grip" aria-hidden="true">
                            {isFinish ? null : <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="3" cy="3" r="1.1" /><circle cx="7" cy="3" r="1.1" /><circle cx="3" cy="7" r="1.1" /><circle cx="7" cy="7" r="1.1" /><circle cx="3" cy="11" r="1.1" /><circle cx="7" cy="11" r="1.1" /></svg>}
                          </span>
                          <span className="wfe-ico"><BlockGlyph kind={b.kind} /></span>
                          <button type="button" className="wfe-pick" aria-pressed={selected === b.id} data-testid="wfe-block-open" onClick={() => setSelected(b.id)}>
                            <span className="wfe-bt" title={b.title}>{b.title}</span>
                            <span className="wfe-bs" title={subtitle(b, agentName, modelName)}>{subtitle(b, agentName, modelName)}</span>
                          </button>
                          {isFinish ? null : (
                            <span className="wfe-acts">
                              <button type="button" className="wfe-mini" aria-label={`Move ${b.title} up`} title="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); void send([{ op: 'move', id: b.id, to: i - 1 }]); }}>
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
                              </button>
                              <button type="button" className="wfe-mini" aria-label={`Move ${b.title} down`} title="Move down" disabled={i >= movable - 1} onClick={(e) => { e.stopPropagation(); void send([{ op: 'move', id: b.id, to: i + 1 }]); }}>
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
                              </button>
                              <button type="button" className="wfe-mini" aria-label={`Remove ${b.title}`} title="Remove" data-testid="wfe-remove" onClick={(e) => { e.stopPropagation(); if (selected === b.id) setSelected(null); void send([{ op: 'remove', id: b.id }]); }}>
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>
                              </button>
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {[...wf.notes, ...modelNotes].map((n) => (
                  <p key={n} className="wfe-note" data-testid="wfe-note">{n}</p>
                ))}
              </section>

              <div className="wfe-side">
                {selBlock ? (
                  <Inspector
                    key={`${selBlock.id}:${wf.rev}`}
                    block={selBlock}
                    agents={agents}
                    models={modelAgent ? models[modelAgent] ?? null : null}
                    onChange={(patch) => void send([{ op: 'update', id: selBlock.id, ...patch } as WorkflowOp])}
                  />
                ) : (
                  <p className="wfe-hint">Pick a block to edit it. Drag blocks to reorder, or drop a ready-made one from "Add a block".</p>
                )}
                <div className="ac-scope wfe-graph" data-testid="wfe-graph">
                  <WorkflowGraph program={wf.program} nodeStates={{}} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Inspector({
  block,
  agents,
  models,
  onChange,
}: {
  block: WorkflowBlock;
  agents: ConnectedAgent[];
  models: AgentModelChoice[] | null;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const commit = (key: string, current: string | undefined) => (e: { target: { value: string } }) => {
    const v = e.target.value.trim();
    if (v && v !== (current ?? '')) onChange({ [key]: v });
  };
  return (
    <div className="wfe-insp" data-testid="wfe-inspector" data-kind={block.kind}>
      <label className="wfe-f">
        <span>Name</span>
        <input data-testid="wfe-f-title" defaultValue={block.title} maxLength={80} onBlur={commit('title', block.title)} />
      </label>
      {block.kind === 'agent' ? (
        <>
          <label className="wfe-f">
            <span>What it does</span>
            <textarea data-testid="wfe-f-prompt" rows={5} defaultValue={block.prompt ?? ''} onBlur={commit('prompt', block.prompt)} />
          </label>
          <div className="wfe-f2">
            <label className="wfe-f">
              <span>Agent</span>
              <select data-testid="wfe-f-agent" value={block.agentRef ?? ''} onChange={(e) => onChange({ agentRef: e.target.value || null, model: null })}>
                <option value="">{agents.length ? 'Default agent' : 'No agent connected'}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.label ?? a.id}</option>
                ))}
              </select>
            </label>
            <label className="wfe-f">
              <span>Model</span>
              <select data-testid="wfe-f-model" value={block.model ?? ''} onChange={(e) => onChange({ model: e.target.value || null })}>
                <option value="">Agent's own model</option>
                {(models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
                {block.model && !(models ?? []).some((m) => m.id === block.model) ? <option value={block.model}>{block.model}</option> : null}
              </select>
            </label>
          </div>
          <label className="wfe-chk">
            <input type="checkbox" data-testid="wfe-f-edit" checked={block.intent !== 'ask'} onChange={(e) => onChange({ intent: e.target.checked ? 'edit' : 'ask' })} />
            <span>May change files</span>
          </label>
        </>
      ) : null}
      {block.kind === 'test' ? (
        <label className="wfe-f">
          <span>Command</span>
          <select data-testid="wfe-f-command" value={block.command ?? TEST_COMMANDS[0]} onChange={(e) => onChange({ command: e.target.value })}>
            {TEST_COMMANDS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      ) : null}
      {block.kind === 'loop' ? (
        <div className="wfe-f2">
          <label className="wfe-f">
            <span>Repeat up to</span>
            <input type="number" min={1} max={20} data-testid="wfe-f-max" defaultValue={block.maxIterations ?? 3} onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20 && n !== block.maxIterations) onChange({ maxIterations: n }); }} />
          </label>
          <label className="wfe-f">
            <span>Blocks inside</span>
            <input type="number" min={1} max={20} data-testid="wfe-f-span" defaultValue={block.span ?? 1} onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20 && n !== block.span) onChange({ span: n }); }} />
          </label>
        </div>
      ) : null}
      {block.kind === 'checker' ? <p className="wfe-hint">No model runs here. It checks the architecture nodes the agent said it changed against the real graph.</p> : null}
      {block.kind === 'finish' ? <p className="wfe-hint">Every workflow ends here.</p> : null}
    </div>
  );
}
