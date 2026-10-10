/* The chrome every drawing card shares (svg, html, visual, mermaid). packages/web2/src/chat/VisualCard.tsx
   Header: a fold button (one click collapses; the collapsed row opens with one click), the title centred (the id and
   file name are in its tooltip), then the actions. A drawing that is scaled to the column (svg, mermaid) is never
   clipped by default: it fits the width and a tall maximum, so it has no nested scroll area and no cap. Any other
   body (a page frame) opens at the cap with a drag bar on its bottom edge that shrinks it (a clip at 1:1; the bottom
   edge fades), locks at a minimum, collapses to the row, and grows back. Arrow keys resize, Enter collapses; the
   state is kept per drawing id (cardState.ts). */

import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CARD_STEP, CARD_STEP_BIG, cardCap, cardTitle, cardTooltip, lockHeight, readCard, resolveDrag, shownHeight, writeCard, type CardState } from './cardState';
import { DrawingContext, type SavedDrawing } from './drawingContext';

import './diagramBlock.css';

const hashOf = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `s${s.length}-${(h >>> 0).toString(36)}`;
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="dgm-chev" data-open={open ? 'true' : undefined} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface VisualCardProps {
  /** data-kind of the figure: mermaid, svg, html or visual. */
  kind: string;
  state: string;
  /** The word shown when the drawing has no title yet ("Drawing", "Page", "Visual", "Diagram"). */
  label: string;
  saved?: SavedDrawing | null;
  /** The text the card is for: keys the remembered state while there is no saved id. */
  source: string;
  /** Header controls after the title (View source, Copy, Reference, Open). */
  actions?: React.ReactNode;
  /** Whether the bottom bar and collapse apply (a drawn card; not a failed, pending or capped one). */
  resizable: boolean;
  /** The title the drawing itself carries (an svg's <title>, a mermaid `title`), used when nothing was saved with one. */
  titleHint?: string;
  /** The body scales itself to the column (svg, mermaid): the default height cap does not apply, so it is not clipped and has no bottom drag bar unless a height was set earlier. */
  scaled?: boolean;
  /** Keep the children mounted (hidden) while collapsed. A frame is not kept: it would measure 0 and corrupt the cached height. */
  keepMounted?: boolean;
  figureRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}

export function VisualCard({ kind, state, label, saved, source, actions, resizable, titleHint, scaled = false, keepMounted = true, figureRef, children }: VisualCardProps) {
  const origin = useContext(DrawingContext);
  const chat = origin?.chat ?? null;
  const key = saved?.id ?? hashOf(source);
  const [st, setSt] = useState<CardState>(() => readCard(chat, key));
  const [at, setAt] = useState(`${chat}|${key}`);
  if (at !== `${chat}|${key}`) {
    setAt(`${chat}|${key}`);
    setSt(readCard(chat, key));
  }
  const [drag, setDrag] = useState<{ h: number | null; collapse: boolean } | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const grip = useRef<HTMLDivElement | null>(null);
  const row = useRef<HTMLButtonElement | null>(null);
  const natural = useRef(0);
  const endDrag = useRef<(() => void) | null>(null);
  const [nat, setNat] = useState(0);
  const capOf = useCallback((el: Element | null): number => (scaled ? Infinity : cardCap(el)), [scaled]);
  const [cap, setCap] = useState(() => capOf(null));
  const focusNext = useRef<'grip' | 'row' | 'fold' | null>(null);
  const foldBtn = useRef<HTMLButtonElement | null>(null);
  const acts = useRef<HTMLSpanElement | null>(null);
  /* The title is centred on the card: the left cell reserves as much as the actions take on the right (capped by the CSS), so the two sides are equal. */
  const [side, setSide] = useState(0);
  const live = useRef({ chat, key });
  live.current = { chat, key };

  const commit = useCallback((next: CardState): void => {
    setSt(next);
    writeCard(live.current.chat, live.current.key, next);
  }, []);

  /** The natural height of the body: its content with the clip lifted, read in one frame so nothing paints. */
  const measure = useCallback((): number => {
    const el = body.current;
    if (!el) return natural.current;
    const keep = { maxHeight: el.style.maxHeight, v: el.style.getPropertyValue('--card-h') };
    el.style.maxHeight = 'none';
    el.style.removeProperty('--card-h');
    const n = el.offsetHeight;
    el.style.maxHeight = keep.maxHeight;
    if (keep.v) el.style.setProperty('--card-h', keep.v);
    if (n > 0) natural.current = n;
    setNat(natural.current);
    setCap(capOf(el));
    return natural.current;
  }, [capOf]);

  useLayoutEffect(() => {
    const w = Math.ceil(acts.current?.offsetWidth ?? 0);
    if (w !== side) setSide(w);
  });
  useEffect(() => {
    if (focusNext.current === 'grip') grip.current?.focus();
    else if (focusNext.current === 'row') row.current?.focus();
    else if (focusNext.current === 'fold') foldBtn.current?.focus();
    focusNext.current = null;
  });

  const collapsed = resizable && st.c;
  const shownH = drag ? drag.h : shownHeight(st.h, nat, cap);

  /* The natural height is known from the first paint and kept current while the content changes (a mermaid
     drawing redrawn as it streams, a page reporting its height, a remounted frame), so a card restored from a
     reload shows its lock and the slider reports its value before anyone touches it. Not during a drag: the
     drag holds the height it started from. */
  useLayoutEffect(() => {
    const el = body.current;
    if (!resizable || collapsed || !el) return undefined;
    const again = (): void => {
      if (!endDrag.current) measure();
    };
    again();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(again);
    const watch = (): void => {
      if (!ro) return;
      ro.disconnect();
      for (const c of Array.from(el.children)) ro.observe(c);
    };
    watch();
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
      watch();
      again();
    });
    mo?.observe(el, { childList: true });
    return () => {
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [resizable, collapsed, measure]);

  /* Pointer (mouse, pen, touch, trackpad): the edge follows the pointer; a collapse is only previewed until the
     pointer is released. One pointer at a time. The drag ends on release (also outside the window: the bar holds
     the capture, and a move that arrives with no button down counts as the release), and is dropped without a
     change on cancel, on losing the window, or when the card goes away mid-drag (a list re-rendering under it). */
  useEffect(() => () => endDrag.current?.(), []);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || e.isPrimary === false) return; // a second finger does not start a second drag
    e.preventDefault();
    endDrag.current?.(); // a drag whose end never reached us is dropped, not stacked
    const nat = measure();
    if (!(nat > 0)) return;
    const cp = capOf(body.current);
    const startH = shownHeight(st.h, nat, cp) ?? nat;
    const y0 = e.clientY;
    const id = e.pointerId;
    const el = e.currentTarget;
    let last = resolveDrag(startH, nat, cp);
    try {
      el.setPointerCapture?.(id);
    } catch {
      /* no capture: the window listeners below still follow it */
    }
    setDrag({ h: shownHeight(st.h, nat, cp), collapse: false });
    const mine = (m: PointerEvent): boolean => m.pointerId === id;
    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      endDrag.current = null;
    };
    const release = (): void => {
      stop();
      setDrag(null);
      if (last.collapse) {
        focusNext.current = 'row';
        commit({ h: last.h, c: true });
      } else commit({ h: last.h, c: false });
    };
    const move = (m: PointerEvent): void => {
      if (!mine(m)) return;
      if (m.buttons === 0) return release(); // released where no pointerup reached us
      last = resolveDrag(startH + (m.clientY - y0), nat, cp);
      setDrag({ h: last.h, collapse: last.collapse });
    };
    const up = (m: PointerEvent): void => {
      if (mine(m)) release();
    };
    const cancel = (m: Event): void => {
      if (m.type === 'pointercancel' && !mine(m as PointerEvent)) return;
      stop();
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    endDrag.current = stop;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const nat = measure();
    const cp = capOf(body.current);
    const cur = shownHeight(st.h, nat, cp) ?? nat;
    const step = e.shiftKey ? CARD_STEP_BIG : CARD_STEP;
    let raw: number | null = null;
    if (e.key === 'ArrowUp') raw = cur <= lockHeight(nat) ? 0 : cur - step; // already at the minimum: one more press collapses
    else if (e.key === 'ArrowDown') raw = cur + step;
    else if (e.key === 'PageUp') raw = Math.max(lockHeight(nat), cur - CARD_STEP_BIG); // the slider's big step; never collapses
    else if (e.key === 'PageDown') raw = cur + CARD_STEP_BIG;
    else if (e.key === 'Home') raw = lockHeight(nat);
    else if (e.key === 'End') raw = nat;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      focusNext.current = 'row';
      commit({ h: st.h, c: true });
      return;
    } else return;
    e.preventDefault();
    const r = resolveDrag(raw, nat, cp);
    if (r.collapse) focusNext.current = 'row';
    commit({ h: r.h, c: r.collapse });
  };

  const expand = (): void => {
    focusNext.current = 'fold';
    commit({ h: st.h, c: false });
  };
  const fold = (): void => {
    focusNext.current = 'row';
    commit({ h: st.h, c: true });
  };

  const title = cardTitle(saved?.title || titleHint, label);
  /* One line, cut with an ellipsis: the tooltip carries the whole title, then the id and file name. */
  const tip = [title, cardTooltip(saved)].filter(Boolean).join('\n');
  const pct = shownH === null ? 100 : nat > 0 ? Math.min(100, Math.round((shownH / nat) * 100)) : undefined;
  const locked = shownH !== null && nat > 0 && shownH <= lockHeight(nat);
  const clipped = resizable && shownH !== null;
  const bodyStyle = clipped ? ({ maxHeight: shownH, '--card-h': `${shownH}px` } as React.CSSProperties) : undefined;

  return (
    <figure
      className="dgm"
      ref={figureRef}
      data-testid="chat-diagram"
      data-kind={kind}
      data-state={state}
      data-collapsed={collapsed ? 'true' : undefined}
      data-dragging={drag ? 'true' : undefined}
      data-locked={clipped && locked ? 'true' : undefined}
      data-capped={resizable && !collapsed && !drag && nat > cap && st.h === null ? 'true' : undefined}
    >
      {collapsed ? (
        <button type="button" ref={row} className="dgm-row" data-testid="chat-card-row" aria-expanded="false" title={tip} onClick={expand}>
          <Chevron open={false} />
          <span className="dgm-title" data-testid="chat-card-title">
            {title}
          </span>
          <span className="dgm-row-end" aria-hidden="true" />
        </button>
      ) : (
        <figcaption className="dgm-bar" style={side > 0 ? ({ '--dgm-side': `${side}px` } as React.CSSProperties) : undefined}>
          {resizable ? (
            <button type="button" ref={foldBtn} className="s2-ibtn s2-ibtn-sm dgm-fold" data-testid="chat-card-fold" aria-expanded="true" aria-label="Collapse drawing" title="Collapse" onClick={fold}>
              <Chevron open />
            </button>
          ) : (
            <span className="dgm-fold-gap" aria-hidden="true" />
          )}
          <span className="dgm-title" data-testid="chat-card-title" title={tip}>
            {title}
          </span>
          <span className="dgm-acts" ref={acts}>
            {actions}
          </span>
        </figcaption>
      )}
      <div
        ref={body}
        className="dgm-body"
        data-testid="chat-card-body"
        data-clipped={clipped ? 'true' : undefined}
        data-preview-collapse={drag?.collapse ? 'true' : undefined}
        hidden={collapsed}
        style={bodyStyle}
      >
        {collapsed && !keepMounted ? null : children}
      </div>
      {resizable && !collapsed ? (
        <div
          ref={grip}
          className="dgm-grip"
          data-testid="chat-card-grip"
          role="slider"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize drawing. Arrow keys resize, Enter collapses"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={drag?.collapse ? 'Release to collapse' : locked ? 'Minimum height' : shownH === null ? 'Full height' : st.h === null && !drag ? 'Default height, drag to see more' : 'Reduced height'}
          onPointerDown={onPointerDown}
          onKeyDown={onKeyDown}
          onDoubleClick={() => {
            focusNext.current = 'row';
            commit({ h: st.h, c: true });
          }}
        >
          <span className="dgm-grip-pill" aria-hidden="true" />
        </div>
      ) : null}
    </figure>
  );
}
