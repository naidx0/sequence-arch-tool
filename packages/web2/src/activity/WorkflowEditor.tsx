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

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { BLOCK_INFO, BLOCK_KINDS, TEST_COMMANDS, loopBodies, type BlockKind, type WorkflowBlock, type WorkflowOp } from '@sequence/schema';

import { trapFocus } from '../shell/focusTrap';
import { ActionGlyph, GLYPH } from './WfeGlyphs';
import { WfeSelect } from './WfeSelect';
import { WorkflowGraph } from './WorkflowGraph';
import { createWorkflowApi, dropOp, rebaseOps, type AgentModelChoice, type ConnectedAgent, type WorkflowApi, type WorkflowView } from './workflowClient';

import './workflowEditor.css';

const POLL_MS = 2500;

/** The size the editor was last open at, so a reopen of an existing workflow is large from its first frame (no grow). */
const SIZE_KEY = 'seq.wfe.size';
const lastSize = (): 'large' | 'small' => {
  try { return globalThis.localStorage?.getItem(SIZE_KEY) === 'large' ? 'large' : 'small'; } catch { return 'small'; }
};
const rememberSize = (s: 'large' | 'small') => {
  try { globalThis.localStorage?.setItem(SIZE_KEY, s); } catch { /* storage may be blocked */ }
};

/** A palette chip's label, given a whole even pixel width so the glyph-and-label group centres on whole pixels. */
function ChipLabel({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let live = true;
    const fit = () => {
      if (!live) return;
      el.style.width = 'auto';
      const w = el.getBoundingClientRect().width;
      if (w > 0) el.style.width = `${Math.ceil(w / 2) * 2}px`;
    };
    fit();
    void document.fonts?.ready.then(fit);
    return () => { live = false; };
  }, [children]);
  return <span ref={ref} className="wfe-chip-l">{children}</span>;
}

/** One glyph per block kind, on a 16 grid at the 1.5 stroke (the 0.1.5 artwork, which reads better than the 1px redraw). Each
    drawing is centred on (8, 8) within half a pixel, and the svg is drawn at its own size so it lands on whole pixels. */
export function BlockGlyph({ kind }: { kind: BlockKind }) {
  const c = { ...GLYPH, strokeWidth: 1.5 } as const;
  switch (kind) {
    case 'agent':
      return (
        <svg {...c} data-glyph="agent">
          <path d="M8 1.8 13.4 4.9v6.2L8 14.2 2.6 11.1V4.9z" />
          <path d="M8 6.2 9.8 8 8 9.8 6.2 8z" />
        </svg>
      );
    case 'checker':
      return (
        <svg {...c} data-glyph="checker">
          <path d="m2.6 8.6 3.4 3.4 7.4-8" />
        </svg>
      );
    case 'test':
      return (
        <svg {...c} data-glyph="test">
          <path d="M6 2.5h4M7 2.5v4L3.6 12a1.3 1.3 0 0 0 1.1 2h6.6a1.3 1.3 0 0 0 1.1-2L9 6.5v-4" />
          <path d="M5.2 10.5h5.6" />
        </svg>
      );
    case 'loop':
      return (
        <svg {...c} data-glyph="loop">
          <path d="M3 8a5 5 0 0 1 8.6-3.5L13 6" />
          <path d="M13 2.8V6h-3.2" />
          <path d="M13 8a5 5 0 0 1-8.6 3.5L3 10" />
          <path d="M3 13.2V10h3.2" />
        </svg>
      );
    case 'finish':
      return (
        <svg {...c} data-glyph="finish">
          <path d="M4 14V2.5" />
          <path d="M4 3h8l-1.8 2.7L12 8.5H4" />
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
  /** The chat this workflow belongs to: one workflow per chat. Absent: every workflow in the project, as before. */
  chatId?: string | null;
  /** Put a starter sentence in the chat's composer (and the editor closes), so the chat's agent edits the workflow. */
  onEditWithChat?: (starter: string) => void;
}

export function WorkflowEditor({ onClose, onRun, api: injected, pollMs = POLL_MS, chatId = null, onEditWithChat }: WorkflowEditorProps) {
  const api = useMemo(() => injected ?? createWorkflowApi(), [injected]);
  const [list, setList] = useState<WorkflowView[] | null>(null);
  /* Older project workflows no chat owns yet, offered to a chat that has none. */
  const [legacy, setLegacy] = useState<WorkflowView[]>([]);
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
  /* The editor grows only when it leaves the start choice; a reopen of an existing workflow never animates. */
  const [sawStart, setSawStart] = useState(false);
  const focusName = useRef(false);
  /* A pick in the inspector remounts it with the new revision; the field that was used gets focus back on the new copy. */
  const refocus = useRef<{ testId: string; at: number } | null>(null);

  const wf = list?.find((w) => w.id === openId) ?? null;
  const size: 'large' | 'small' = list === null ? lastSize() : wf ? 'large' : 'small';
  useEffect(() => {
    if (list === null) return;
    rememberSize(wf ? 'large' : 'small');
    if (!wf) setSawStart(true);
  }, [list, wf]);
  /* after Start from ready-made blocks / Start empty the focused button is gone: focus goes into the editor (the first block, or
     the palette of an empty one), a button rather than the name field so an agent's edit still arrives by polling */
  useEffect(() => {
    if (!wf || !focusName.current) return;
    focusName.current = false;
    (dlg.current?.querySelector<HTMLElement>('[data-testid="wfe-block-open"]') ?? dlg.current?.querySelector<HTMLElement>('[data-testid^="wfe-add-"]:not(:disabled)'))?.focus();
  }, [wf]);

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
    const loaded = chatId
      ? api.chatList(chatId, ctl.signal).then((r) => (r.ok ? { ok: true as const, body: r.body.workflows, legacy: r.body.legacy } : r))
      : api.list(ctl.signal).then((r) => (r.ok ? { ok: true as const, body: r.body, legacy: [] as WorkflowView[] } : r));
    void loaded.then((r) => {
      if (ctl.signal.aborted) return;
      if (!r.ok) return setFailure(r.message), setList([]);
      setList(r.body);
      setLegacy(r.legacy);
      setOpenId((cur) => cur ?? r.body[0]?.id ?? null);
      r.body.forEach((w) => (known.current[w.id] = { rev: w.rev, sig: signature(w) }));
    });
    void api.agents(ctl.signal).then((r) => {
      if (!ctl.signal.aborted && r.ok) setAgents(r.body);
    });
    return () => ctl.abort();
  }, [api, chatId]);

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
      const r = await api.create(chatId ? 'Workflow' : from === 'fresh' ? 'New workflow' : 'Empty workflow', from, chatId ?? undefined);
      if (!r.ok) return setFailure(r.message);
      take(r.body, true);
      focusName.current = true;
      setAgentEdit(false);
      setOpenId(r.body.id);
      /* an empty workflow has only Finish: leave the side column to say where to start instead of showing Finish's fields */
      setSelected(from === 'empty' ? null : r.body.blocks[0]?.id ?? null);
    },
    [api, take, chatId],
  );

  const adopt = useCallback(
    async (id: string) => {
      if (!chatId) return;
      setFailure(null);
      const r = await api.adopt(id, chatId);
      if (!r.ok) return setFailure(r.message);
      take(r.body, true);
      setLegacy([]);
      focusName.current = true;
      setAgentEdit(false);
      setOpenId(r.body.id);
      setSelected(r.body.blocks[0]?.id ?? null);
    },
    [api, take, chatId],
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
    <div className="s2 s2-scrim wfe-scrim" data-size={size} data-grow={sawStart ? 'true' : undefined} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dlg} className="wfe" data-size={size} data-grow={sawStart ? 'true' : undefined} role="dialog" aria-modal="true" aria-label="Workflow editor" data-testid="wfe">
        <header className="wfe-head">
          <h3 className="wfe-title">Workflow editor</h3>
          {list && list.length > 0 && !chatId ? (
            <WfeSelect className="wfe-select" label="Workflow" testId="wfe-pick" value={openId ?? ''} options={list.map((w) => ({ value: w.id, label: w.name }))} onChange={(v) => { setOpenId(v); setSelected(null); setAgentEdit(false); }} />
          ) : null}
          <span className="wfe-spacer" />
          {wf && onEditWithChat && chatId ? (
            <button type="button" className="s2-chipbtn" data-testid="wfe-chat-edit" title="Ask this chat's agent to change the workflow" onClick={() => onEditWithChat(`Edit this chat's workflow: `)}>Edit with chat</button>
          ) : null}
          {wf && !chatId ? <button type="button" className="wfe-btn" data-testid="wfe-fresh" onClick={() => void startFresh('fresh')}>Start fresh</button> : null}
          {emptyWhy ? <span className="wfe-why" data-testid="wfe-run-why" title={emptyWhy}>{emptyWhy}</span> : null}
          {wf ? (
            <button
              type="button"
              className={movable === 0 ? 'wfe-btn' : 'wfe-btn wfe-btn-solid'}
              data-testid="wfe-run"
              disabled={running || !wf.valid || !!emptyWhy || movable === 0}
              title={movable === 0 ? 'Add a block to run this workflow' : emptyWhy ?? (wf.valid ? 'Run this workflow' : wf.errors.join('. '))}
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
            <ActionGlyph name="close" size={16} />
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
            <p className="wfe-start-lead" data-testid="wfe-start-lead">{chatId ? 'This chat has no workflow yet.' : 'No workflow yet.'} Start from ready-made blocks: an agent edits the code, a checker verifies it, your tests run.</p>
            <div className="wfe-start-row">
              <button type="button" className="wfe-btn wfe-btn-solid" data-testid="wfe-start-fresh" onClick={() => void startFresh('fresh')}>Start from ready-made blocks</button>
              <button type="button" className="wfe-btn" data-testid="wfe-start-empty" onClick={() => void startFresh('empty')}>Start empty</button>
            </div>
            {legacy.length > 0 ? (
              <div className="wfe-legacy" data-testid="wfe-legacy">
                <span className="wfe-cap">Or use a workflow saved in this project</span>
                {legacy.map((w) => (
                  <button key={w.id} type="button" className="s2-chipbtn" data-testid="wfe-legacy-use" onClick={() => void adopt(w.id)}>{w.name}</button>
                ))}
              </div>
            ) : null}
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
                  <ChipLabel>{BLOCK_INFO[k].label}</ChipLabel>
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
                  {movable === 0 ? (
                    <li className="wfe-first" data-testid="wfe-first" data-over={overAt === 0 ? 'true' : undefined} onDragOver={(e) => { e.preventDefault(); setOverAt(0); }} onDrop={(e) => onDropAt(e, 0)}>
                      Add the first block here: click one above, or drag it in.
                    </li>
                  ) : null}
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
                            {isFinish ? null : <svg width="8" height="16" viewBox="0 0 8 16" fill="currentColor" aria-hidden="true" focusable="false" data-glyph="grip">{[1, 5].flatMap((x) => [2, 7, 12].map((y) => <rect key={`${x}${y}`} x={x} y={y} width="2" height="2" rx="0.5" />))}</svg>}
                          </span>
                          <span className="wfe-ico"><BlockGlyph kind={b.kind} /></span>
                          <button type="button" className="wfe-pick" aria-pressed={selected === b.id} data-testid="wfe-block-open" onClick={() => setSelected(b.id)}>
                            <span className="wfe-bt" title={b.title}>{b.title}</span>
                            <span className="wfe-bs" title={subtitle(b, agentName, modelName)}>{subtitle(b, agentName, modelName)}</span>
                          </button>
                          {isFinish ? null : (
                            <span className="wfe-acts">
                              <button type="button" className="wfe-mini" aria-label={`Move ${b.title} up`} title="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); void send([{ op: 'move', id: b.id, to: i - 1 }]); }}>
                                <ActionGlyph name="up" size={12} />
                              </button>
                              <button type="button" className="wfe-mini" aria-label={`Move ${b.title} down`} title="Move down" disabled={i >= movable - 1} onClick={(e) => { e.stopPropagation(); void send([{ op: 'move', id: b.id, to: i + 1 }]); }}>
                                <ActionGlyph name="down" size={12} />
                              </button>
                              <button type="button" className="wfe-mini" aria-label={`Remove ${b.title}`} title="Remove" data-testid="wfe-remove" onClick={(e) => { e.stopPropagation(); if (selected === b.id) setSelected(null); void send([{ op: 'remove', id: b.id }]); }}>
                                <ActionGlyph name="close" size={12} />
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
                    refocus={refocus}
                    onChange={(patch) => void send([{ op: 'update', id: selBlock.id, ...patch } as WorkflowOp])}
                  />
                ) : (
                  <p className="wfe-hint">{movable === 0 ? 'Nothing to edit yet. Add a block from the row above to start.' : 'Pick a block to edit it. Drag blocks to reorder, or drop a ready-made one from "Add a block".'}</p>
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
  refocus,
}: {
  block: WorkflowBlock;
  agents: ConnectedAgent[];
  models: AgentModelChoice[] | null;
  onChange: (patch: Record<string, unknown>) => void;
  refocus: MutableRefObject<{ testId: string; at: number } | null>;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  const ids = useId();
  useLayoutEffect(() => {
    const want = refocus.current;
    refocus.current = null;
    if (want && Date.now() - want.at < 4000) root.current?.querySelector<HTMLElement>(`[data-testid="${want.testId}"]`)?.focus();
  }, [refocus]);
  const pick = (testId: string, patch: Record<string, unknown>) => {
    refocus.current = { testId, at: Date.now() };
    onChange(patch);
  };
  const commit = (key: string, current: string | undefined) => (e: { target: { value: string } }) => {
    const v = e.target.value.trim();
    if (v && v !== (current ?? '')) onChange({ [key]: v });
  };
  return (
    <div ref={root} className="wfe-insp" data-testid="wfe-inspector" data-kind={block.kind}>
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
            <div className="wfe-f">
              <span id={`${ids}-agent`}>Agent</span>
              <WfeSelect
                label="Agent"
                labelId={`${ids}-agent`}
                testId="wfe-f-agent"
                value={block.agentRef ?? ''}
                options={[{ value: '', label: agents.length ? 'Default agent' : 'No agent connected' }, ...agents.map((a) => ({ value: a.id, label: a.label ?? a.id }))]}
                onChange={(v) => pick('wfe-f-agent', { agentRef: v || null, model: null })}
              />
            </div>
            <div className="wfe-f">
              <span id={`${ids}-model`}>Model</span>
              <WfeSelect
                label="Model"
                labelId={`${ids}-model`}
                testId="wfe-f-model"
                value={block.model ?? ''}
                options={[
                  { value: '', label: "Agent's own model" },
                  ...(models ?? []).map((m) => ({ value: m.id, label: m.name })),
                  ...(block.model && !(models ?? []).some((m) => m.id === block.model) ? [{ value: block.model, label: block.model }] : []),
                ]}
                onChange={(v) => pick('wfe-f-model', { model: v || null })}
              />
            </div>
          </div>
          <label className="wfe-chk">
            <input type="checkbox" data-testid="wfe-f-edit" checked={block.intent !== 'ask'} onChange={(e) => onChange({ intent: e.target.checked ? 'edit' : 'ask' })} />
            <span>May change files</span>
          </label>
        </>
      ) : null}
      {block.kind === 'test' ? (
        <div className="wfe-f">
          <span id={`${ids}-cmd`}>Command</span>
          <WfeSelect label="Command" labelId={`${ids}-cmd`} testId="wfe-f-command" value={block.command ?? TEST_COMMANDS[0]} options={TEST_COMMANDS.map((c) => ({ value: c, label: c }))} onChange={(v) => pick('wfe-f-command', { command: v })} />
        </div>
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
