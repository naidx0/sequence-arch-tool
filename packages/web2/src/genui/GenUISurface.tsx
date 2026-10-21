/* ══════════════════════════════════════════════════════════════════════════
   THE GENERATIVE UI RENDERER
   packages/web2/src/genui/GenUISurface.tsx

   Draws one SurfaceView (session.ts). Only catalog components exist here; the
   registry below is the whole vocabulary. Per node:

     not arrived yet       a skeleton the size of a line (it streams in)
     invalid while live    a skeleton, never a half-broken component
     being repaired        drawn as it is, with a "Fixing" chip and an accent wash on it
     fixed                 a short ring flash where the fix landed (accent for the
                           lossless fixer, --fits for the agent: done)
     throws while drawing  caught at that node only (NodeBoundary): a one-line
                           fallback, retried when the element changes (ChatGPT's
                           DIL renderer: node-render scope, drop-node recovery)

   Motion is in motion.ts; nothing here sets a duration of its own.
   ══════════════════════════════════════════════════════════════════════════ */
import { Component, createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { resolveProps, findComponent, type UIElement } from '@sequence/genui';

import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { S2Icon } from '../shell2/icons';
import { StillContext, flash, useAutoHeight, useEnter, useFlip, useSwap, useTween } from './motion';
import type { SurfaceView, TimedFix } from './session';

import './genui.css';

interface Ctx {
  view: SurfaceView;
  busy: boolean;
  onClick: (elementId: string) => void;
}
const SurfaceCtx = createContext<Ctx | null>(null);
const useSurface = (): Ctx => useContext(SurfaceCtx)!;

type P = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/* ── icons: the app's own (shell2/icons.tsx) and its one busy mark ─────── */
const Spinner = (): JSX.Element => <AsciiSpinner className="gu-glyph" />;
type GlyphKind = 'check' | 'x' | 'warn' | 'dot' | 'skip';
/* Every status mark is the app's: S2Icon, or the .s2-ring the plan rows use for "not yet". S2Icon has no alert
   glyph, so a warning is `bell` (attention), the closest the set has; nothing is drawn here. */
const GLYPH_ICON = { check: 'check', x: 'x', warn: 'bell', skip: 'minus' } as const;
const Glyph = ({ kind }: { kind: GlyphKind }): JSX.Element => {
  if (kind === 'dot') return <span className="s2-ring gu-glyph" aria-hidden="true" />;
  return <S2Icon name={GLYPH_ICON[kind]} small className="gu-glyph" />;
};
/* A badge carries a glyph only where its tone is a verdict; neutral and info are the word alone. */
const TONE_GLYPH: Record<string, GlyphKind> = { success: 'check', merged: 'check', warning: 'warn', danger: 'x' };
const ToneGlyph = ({ tone }: { tone: string }): JSX.Element | null => (TONE_GLYPH[tone] ? <Glyph kind={TONE_GLYPH[tone]!} /> : null);

/* ── structure ─────────────────────────────────────────────────────────── */
function Kids({ ids, className, as = 'div' }: { ids: readonly string[] | undefined; className: string; as?: 'div' | 'ol' }): JSX.Element {
  const ref = useRef<HTMLElement>(null);
  useFlip(ref);
  const Tag = as as 'div';
  return (
    <Tag ref={ref as React.RefObject<HTMLDivElement>} className={className}>
      {(ids ?? []).map((id, i) => (
        <Node key={id} id={id} index={i} />
      ))}
    </Tag>
  );
}

/* BUTTONS ARE THE APP'S KIT, NO NEW TYPE (Decision 51; src/buttonKit.test.ts lists the shapes).
   A generated Button's variant maps to an existing class and nothing else:
     primary     s2-btn s2-btn-sm s2-blue     the one solid accent button (as ConfirmDialog's confirm)
     secondary   s2-btn s2-btn-sm             the glass pill, the default
     danger      s2-btn s2-btn-sm s2-danger   destructive (as ConfirmDialog's danger confirm)
     ghost       s2-chipbtn                   the quiet 24px inline action; the kit has no transparent
                                              text button, and a ghost must not invent one
   gu-btn adds only the pending state. */
export const BUTTON_CLASS: Record<string, string> = {
  primary: 's2-btn s2-btn-sm s2-blue',
  secondary: 's2-btn s2-btn-sm',
  danger: 's2-btn s2-btn-sm s2-danger',
  ghost: 's2-chipbtn',
};
/* Inline nodes are too small to carry the Fixing chip; their outline says it. */
const INLINE = new Set(['Button', 'Badge', 'Check']);

function AutoHeight({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useAutoHeight(outer, inner);
  return (
    <div ref={outer} className={`gu-autoh${className ? ` ${className}` : ''}`}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

/* ── components (the registry) ─────────────────────────────────────────── */
type Comp = (a: { id: string; p: P; el: UIElement }) => JSX.Element;

const Card: Comp = ({ p, el }) => {
  const badge = useRef<HTMLSpanElement>(null);
  useSwap(badge, `${str(p.badge)}|${str(p.tone)}`);
  return (
    <section className="gu-card" data-tone={str(p.tone) || 'neutral'}>
      <header className="gu-card-head">
        <div className="gu-card-titles">
          <h3 className="gu-card-title">{str(p.title)}</h3>
          {p.subtitle ? <p className="gu-card-sub">{str(p.subtitle)}</p> : null}
        </div>
        {p.badge ? (
          <span ref={badge} className="gu-badge" data-tone={str(p.tone) || 'neutral'}>
            <ToneGlyph tone={str(p.tone)} />
            {str(p.badge)}
          </span>
        ) : null}
      </header>
      <AutoHeight>
        <Kids ids={el.children} className="gu-card-body" />
      </AutoHeight>
    </section>
  );
};

const Stack: Comp = ({ p, el }) => (
  <Kids ids={el.children} className={`gu-stack gu-gap-${num(p.gap) || 2}${p.direction === 'row' ? ' gu-row' : ''}${p.wrap ? ' gu-wrap' : ''}${p.align ? ` gu-align-${str(p.align)}` : ''}`} />
);

const Heading: Comp = ({ p }) => {
  const lvl = Math.min(3, Math.max(1, num(p.level) || 2));
  return <div className="gu-heading" data-level={lvl}>{str(p.text)}</div>;
};

const Text: Comp = ({ p }) => (
  <p className={`gu-text${p.muted ? ' gu-muted' : ''}${p.mono ? ' gu-mono' : ''}`} data-tone={p.tone ? str(p.tone) : undefined}>
    {str(p.text)}
  </p>
);

const Badge: Comp = ({ p }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useSwap(ref, `${str(p.label)}|${str(p.tone)}`);
  return (
    <span ref={ref} className="gu-badge" data-tone={str(p.tone) || 'neutral'}>
      <ToneGlyph tone={str(p.tone)} />
      {str(p.label)}
    </span>
  );
};

const StatusLine: Comp = ({ p }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useSwap(ref, str(p.text));
  return (
    <div className="gu-status" data-busy={p.busy ? 'true' : 'false'}>
      {p.busy ? <Spinner /> : <Glyph kind="check" />}
      <span ref={ref} className={`gu-status-text${p.busy ? ' shimmer-text' : ''}`}>
        {str(p.text)}
      </span>
    </div>
  );
};

const Timeline: Comp = ({ el }) => <Kids ids={el.children} className="gu-timeline" as="ol" />;

const STEP_GLYPH: Record<string, GlyphKind> = { done: 'check', error: 'x', warning: 'warn', pending: 'dot', skipped: 'skip' };
const TimelineItem: Comp = ({ p, el }) => {
  const status = str(p.status) || 'pending';
  const title = useRef<HTMLDivElement>(null);
  useSwap(title, `${str(p.title)}|${status}`);
  return (
    <div className="gu-step" data-status={status} data-tone={p.tone ? str(p.tone) : undefined}>
      <span className="gu-step-node" aria-hidden="true">
        {status === 'running' ? <Spinner /> : <Glyph kind={STEP_GLYPH[status] ?? 'dot'} />}
      </span>
      <div className="gu-step-main">
        <div ref={title} className="gu-step-head">
          <span className="gu-step-title">{str(p.title)}</span>
          {p.meta ? <span className="gu-step-meta">{str(p.meta)}</span> : null}
        </div>
        {p.detail ? <p className="gu-step-detail">{str(p.detail)}</p> : null}
        {el.children?.length ? (
          <AutoHeight>
            <Kids ids={el.children} className="gu-step-kids" />
          </AutoHeight>
        ) : null}
      </div>
    </div>
  );
};

const Progress: Comp = ({ p }) => {
  const max = Math.max(1, num(p.max));
  const value = Math.min(max, Math.max(0, num(p.value)));
  const shown = useTween(value);
  const pct = (value / max) * 100;
  return (
    <div className="gu-progress" data-tone={str(p.tone) || (value >= max ? 'success' : undefined)}>
      <div className="gu-progress-row">
        <span className="gu-progress-label">{str(p.label)}</span>
        <span className="gu-progress-count">
          {Math.round(shown)} of {max}
        </span>
      </div>
      <div className="gu-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="gu-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const Metric: Comp = ({ p }) => {
  const isNum = typeof p.value === 'number';
  const shown = useTween(isNum ? (p.value as number) : 0);
  return (
    <div className="gu-metric" data-tone={str(p.tone) || 'neutral'}>
      <span className="gu-metric-label">{str(p.label)}</span>
      <span className="gu-metric-value">
        {isNum ? Math.round(shown).toLocaleString() : str(p.value)}
        {p.delta ? <span className="gu-metric-delta">{str(p.delta)}</span> : null}
      </span>
    </div>
  );
};

const Checks: Comp = ({ el }) => <Kids ids={el.children} className="gu-checks" />;

const CHECK_GLYPH: Record<string, 'check' | 'x' | 'dot'> = { pass: 'check', fail: 'x', pending: 'dot' };
const Check: Comp = ({ p }) => {
  const status = str(p.status) || 'pending';
  const ref = useRef<HTMLSpanElement>(null);
  useSwap(ref, status);
  return (
    <span ref={ref} className="gu-check" data-status={status} tabIndex={p.detail ? 0 : undefined}>
      {status === 'running' ? <Spinner /> : <Glyph kind={CHECK_GLYPH[status] ?? 'dot'} />}
      <span>{str(p.label)}</span>
      {p.detail ? (
        <span className="gu-tip" role="tooltip">
          {str(p.detail)}
        </span>
      ) : null}
    </span>
  );
};

const FileList: Comp = ({ p }) => {
  const files = Array.isArray(p.files) ? (p.files as { path: string; status: string; additions?: number; deletions?: number }[]) : [];
  return (
    <ul className="gu-files">
      {files.map((f) => (
        <li key={f.path} className="gu-file" data-status={f.status}>
          <span className="gu-file-path">{f.path}</span>
          <span className="gu-file-stat">
            {f.additions != null ? <span className="gu-add">+{f.additions}</span> : null}
            {f.deletions != null ? <span className="gu-del">-{f.deletions}</span> : null}
            {f.status === 'conflict' ? <span className="gu-badge" data-tone="warning">conflict</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
};

const SIGN: Record<string, string> = { add: '+', del: '-', ctx: ' ', ours: '<', theirs: '>', hunk: '' };
const Diff: Comp = ({ p }) => {
  const lines = Array.isArray(p.lines) ? (p.lines as { kind: string; text: string; n?: number }[]) : [];
  return (
    <figure className="gu-diff">
      <figcaption className="gu-diff-path">{str(p.path)}</figcaption>
      <pre className="gu-diff-body">
        {lines.map((l, i) => (
          <div key={i} className="gu-diff-line" data-kind={l.kind}>
            <span className="gu-diff-n">{l.n ?? ''}</span>
            <span className="gu-diff-sign">{SIGN[l.kind] ?? ' '}</span>
            <span className="gu-diff-text">{l.text}</span>
          </div>
        ))}
      </pre>
    </figure>
  );
};

const KeyValue: Comp = ({ p }) => {
  const items = Array.isArray(p.items) ? (p.items as { key: string; value: string }[]) : [];
  return (
    <dl className="gu-kv">
      {items.map((it) => (
        <div key={it.key} className="gu-kv-row">
          <dt>{it.key}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
};

const Callout: Comp = ({ p, el }) => (
  <div className="gu-callout" data-tone={str(p.tone) || 'info'} role={p.tone === 'danger' ? 'alert' : undefined}>
    {p.title ? <div className="gu-callout-title">{str(p.title)}</div> : null}
    <p className="gu-callout-text">{str(p.text)}</p>
    {el.children?.length ? <Kids ids={el.children} className="gu-callout-kids" /> : null}
  </div>
);

const Actions: Comp = ({ p, el }) => <Kids ids={el.children} className={`gu-actions${p.align === 'end' ? ' gu-actions-end' : ''}`} />;

const Button: Comp = ({ id, p }) => {
  const { view, busy, onClick } = useSurface();
  const [arming, setArming] = useState(false);
  const pending = view.pendingAction === id;
  const name = (p.action as { name?: string } | undefined)?.name ?? '';
  const decl = view.spec.actions[name];
  /* A surface kept with a finished turn is a record: its buttons are off. */
  const inert = view.restored === true || p.disabled === true || !decl || (busy && !decl.whileBusy && !pending);
  const refused = view.refused?.elementId === id ? view.refused.reason : null;
  const btnClass = `${BUTTON_CLASS[str(p.variant)] ?? BUTTON_CLASS.secondary} gu-btn`;
  const label = pending ? `${str(p.label)}` : arming ? `${str(p.confirm) || 'Confirm'}?` : str(p.label);
  return (
    <button
      type="button"
      className={btnClass}
      data-variant={str(p.variant) || 'secondary'}
      data-pending={pending ? 'true' : undefined}
      disabled={inert || pending}
      title={view.restored ? 'This turn has finished' : (refused ?? decl?.description ?? undefined)}
      onClick={() => {
        if (p.confirm && !arming) {
          setArming(true);
          return;
        }
        setArming(false);
        onClick(id);
      }}
    >
      {pending ? <Spinner /> : null}
      <span>{label}</span>
    </button>
  );
};

export const REGISTRY: Record<string, Comp> = { Card, Stack, Heading, Text, Badge, StatusLine, Timeline, TimelineItem, Progress, Metric, Checks, Check, FileList, Diff, KeyValue, Callout, Actions, Button };

/* ── per node: boundary, skeleton, motion, fix flash ───────────────────── */
class NodeBoundary extends Component<{ el: UIElement; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }
  componentDidUpdate(prev: { el: UIElement }): void {
    /* The element changed (the agent patched it): try again. */
    if (this.state.error && prev.el !== this.props.el) this.setState({ error: null });
  }
  render(): ReactNode {
    if (this.state.error) return <p className="gu-text gu-muted">Couldn't draw this {this.props.el.type}.</p>;
    return this.props.children;
  }
}

function Skeleton({ label }: { label?: string }): JSX.Element {
  return (
    <div className="gu-skel" aria-busy="true">
      {label ? <span className="gu-skel-label">{label}</span> : null}
    </div>
  );
}

const fixesFor = (fixes: TimedFix[], id: string): number => fixes.reduce((n, f) => n + (f.elementId === id ? 1 : 0), 0);

const Node = memo(function Node({ id, index }: { id: string; index: number }): JSX.Element {
  const { view } = useSurface();
  const el = view.spec.elements[id];
  const ref = useRef<HTMLDivElement>(null);
  useEnter(ref, Math.min(index, 8) * 45);
  const nFix = fixesFor(view.fixes, id);
  const seenFix = useRef(nFix);
  useEffect(() => {
    if (nFix > seenFix.current) flash(ref.current, view.fixes[view.fixes.length - 1]?.by === 'agent' ? 'var(--fits)' : 'var(--accent)');
    seenFix.current = nFix;
  }, [nFix, view.fixes]);
  const repairing = view.repairing.has(id);
  let body: ReactNode;
  if (!el) body = <Skeleton />;
  else if (!view.renderable.has(id) || !findComponent(el.type)) body = <Skeleton />;
  else {
    const C = REGISTRY[el.type]!;
    const p = resolveProps(el.props, view.spec.state).props;
    body = (
      <NodeBoundary el={el}>
        <C id={id} p={p} el={el} />
      </NodeBoundary>
    );
  }
  return (
    <div ref={ref} className="gu-node" data-gu-id={id} data-kind={el?.type} data-repairing={repairing ? 'true' : undefined}>
      {body}
      {repairing && !INLINE.has(el?.type ?? '') ? <span className="gu-fixing">Fixing</span> : null}
    </div>
  );
});

/* ── the surface and its repair strip ──────────────────────────────────── */
function RepairStrip({ view }: { view: SurfaceView }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const fixer = view.fixes.filter((f) => f.by === 'fixer' && !f.lossy).length;
  const agent = view.fixes.filter((f) => f.by === 'agent').length;
  const lossy = view.fixes.filter((f) => f.lossy).length;
  const last = view.fixes[view.fixes.length - 1];
  const chip = useRef<HTMLButtonElement>(null);
  useSwap(chip, view.fixes.length);
  if (!view.fixes.length && view.phase !== 'repairing') return null;
  return (
    <div className="gu-repair">
      <button ref={chip} type="button" className="s2-chipbtn gu-repair-chip" data-phase={view.phase} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {view.phase === 'repairing' ? <Spinner /> : <Glyph kind="check" />}
        <span>
          {view.phase === 'repairing' ? `Agent repairing, round ${view.rounds}` : 'Self-corrected'}
        </span>
        {fixer ? <span className="gu-repair-n">{fixer} auto fixed</span> : null}
        {agent ? <span className="gu-repair-n" data-by="agent">{agent} fixed by agent</span> : null}
        {lossy ? <span className="gu-repair-n" data-by="lossy">{lossy} simplified</span> : null}
      </button>
      {!open && last ? <span className="gu-repair-last">{last.message}</span> : null}
      {open ? (
        <ol className="gu-repair-log">
          {view.fixes.map((f, i) => (
            <li key={i} data-by={f.lossy ? 'lossy' : f.by}>
              <span className="gu-repair-by">{f.lossy ? 'simplified' : f.by === 'agent' ? 'fixed by agent' : 'auto fixed'}</span>
              {f.message}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

export function GenUISurface({ view, busy, onClick }: { view: SurfaceView; busy: boolean; onClick: (surfaceId: string, elementId: string) => void }): JSX.Element {
  const ctx: Ctx = { view, busy, onClick: (e) => onClick(view.id, e) };
  const root = view.spec.root;
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    wrap.current?.setAttribute('data-phase', view.phase);
  }, [view.phase]);
  return (
    <SurfaceCtx.Provider value={ctx}>
      <StillContext.Provider value={view.restored === true}>
        <div ref={wrap} className="gu-surface" data-testid="genui-surface" data-surface={view.id} data-restored={view.restored ? 'true' : undefined}>
          <AutoHeight>{root ? <Node id={root} index={0} /> : <Skeleton />}</AutoHeight>
          <RepairStrip view={view} />
        </div>
      </StillContext.Provider>
    </SurfaceCtx.Provider>
  );
}
