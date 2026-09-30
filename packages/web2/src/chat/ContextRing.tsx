/* ══════════════════════════════════════════════════════════════════════════
   HOW MUCH OF THE WINDOW THE LAST TURN USED
   packages/web2/src/chat/ContextRing.tsx

   Asked for by name: "I like the Claude context circle. That's the only reason
   I'm adding it."

   The same fact the transcript already prints under an answer — `27,640 of
   1,048,576` — drawn as a ring in the composer, where it is in front of the
   reader while they decide what to type next rather than only after a turn has
   finished.

   B3.4: click opens a breakdown of named prompt slices from the last result's
   `contextBreakdown` (server-measured approxTokens). Never invent sections
   client-side; never relabel coverage as tokens.

   2026-09-18 — WHAT THE PANEL SAYS, AND WHAT IT STOPPED SAYING. Owner, on the
   installed app: "it should open more information in that window instead of
   showing 0 out of 131,000 on the main page… remove the small text elements:
   'last provider call, not the sum', 'usage not yet measured for this model' —
   you say 0 / 131k and show a breakdown depending on how much is done, that's
   all." The panel had grown three explanatory sentences around one number; a
   surface a reader opens repeatedly needs the measurement, not the lesson. It
   is now one header line, a stacked bar of the measured slices, and one row per
   slice. THE HONESTY RULES DID NOT MOVE with the prose: no window, no ring;
   nothing metered, an em dash rather than a zero; and no section this file did
   not receive from the server.

   ── IT CANNOT DRAW A NUMBER NOBODY GAVE IT ───────────────────────────────

   `window` is null whenever neither the provider nor the vendor-published
   table can name a context length. A ring is a FRACTION, so drawing one
   without a denominator means inventing the denominator — which is precisely
   what CANON law 4 forbids.

   When the window IS known but no turn has been metered yet, the ring still
   draws at zero with an honest “not yet measured” label — so the composer
   shows which ceiling the configured model carries (owner ask 2026-08-25).
   That is not inventing usage; the arc stays empty until a real count arrives.

   ── AND IT IS THE LAST TURN, NOT THE CONVERSATION ────────────────────────

   `used` is the input token count of the most recent metered turn, which is
   what actually occupied the window on the call that just happened. Summing
   turns would be wrong twice over: the digest is rebuilt per turn rather than
   accumulated, and a sum would climb past the window on a long thread while
   every individual call still fitted.

   PURE. Two numbers in, one ring out — plus an optional measured breakdown.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useId, useRef, useState } from 'react';

import type { AskContextBreakdown } from '@sequence/api-types';

export interface ContextRingProps {
  /** Tokens the last metered turn put into the window. */
  used: number | null;
  /** The window itself, or null when the provider would not say. */
  window: number | null;
  /** Named slices from the last ask result — omit/null when unmeasured. */
  breakdown?: AskContextBreakdown | null;
}

/** Geometry, in the 16px box the composer's control row gives it. */
const SIZE = 16;
const STROKE = 2;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * The fraction of the window in use, clamped to 0..1.
 *
 * Clamped rather than allowed past 1: a turn CAN exceed the window — the
 * provider truncates and says so elsewhere — and a ring drawn at 140% would
 * either overlap itself or read as 40%. At the ceiling it is full, and the
 * number beside it is what carries the overflow.
 */
export function contextFraction(used: number, window: number): number {
  if (window <= 0) return 0;
  return Math.min(1, Math.max(0, used / window));
}

/**
 * Which token count the ring should draw — live during stream, settled after.
 *
 * In-flight `usage.inputTokens` is the provider's running input count for the
 * turn in progress; completed turns use `lastTurnUsed` (last-call measured,
 * not the multi-round bill).
 */
export function resolveContextRingUsed(
  inFlightUsage: { inputTokens: number } | null | undefined,
  lastTurnUsed: number | null,
): number | null {
  if (inFlightUsage) return inFlightUsage.inputTokens;
  return lastTurnUsed;
}

/** Compact denominator for the composer chip — never invents usage. */
export function formatContextWindowTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return n.toLocaleString('en-US');
}

/** How long the pointer rests on the ring before the details open, in ms.
 *
 *  250 is the tooltip delay, and it is chosen as a tooltip delay rather than as
 *  an animation number: below ~150ms a panel opens under a pointer that was
 *  only crossing the composer on its way to Send, and above ~400ms a reader who
 *  meant to look has already decided nothing is going to happen and clicked. */
const HOVER_OPEN_MS = 250;

/** How many named slices the list prints before it collapses the tail. */
const TOP_SLICES = 8;

/**
 * THE POPOVER'S WHOLE CONTENT, DERIVED — header line, bar, rows, tail count.
 *
 * Owner, 2026-09-18, on the installed app: "it should open more information in
 * that window instead of showing 0 out of 131,000 on the main page… remove the
 * small text elements: 'last provider call, not the sum', 'usage not yet
 * measured for this model' — you say 0 / 131k and show a breakdown depending on
 * how much is done, that's all."
 *
 * The old panel was three sentences of explanation wrapped round one number.
 * Explanation is what a reader needs ONCE; a panel they open repeatedly needs
 * the measurement and nothing else. So: one header line, one bar, one row per
 * slice, and the tail counted rather than listed.
 *
 * SHARE IS OF THE MEASURED SLICES, NOT OF THE WINDOW. The sections are the
 * server's approxTokens and their sum is not the provider's input count — a
 * percentage of the window would silently claim the two agree. Of the sum, the
 * bar's segments add to the bar's width, which is the only claim the drawing
 * itself makes.
 *
 * PURE. Sections in, rows out — so the shape can be tested without a DOM.
 */
export function contextSlices(breakdown: AskContextBreakdown | null | undefined): {
  rows: { id: string; label: string; tokens: number; share: number }[];
  hidden: number;
  hiddenTokens: number;
} {
  const sections = (breakdown?.sections ?? []).filter((s) => s.tokens > 0);
  const sum = sections.reduce((n, s) => n + s.tokens, 0);
  if (sum <= 0) return { rows: [], hidden: 0, hiddenTokens: 0 };
  const sorted = [...sections].sort((a, b) => b.tokens - a.tokens);
  const shown = sorted.slice(0, TOP_SLICES);
  const rest = sorted.slice(TOP_SLICES);
  return {
    rows: shown.map((s) => ({ id: s.id, label: s.label, tokens: s.tokens, share: s.tokens / sum })),
    hidden: rest.length,
    hiddenTokens: rest.reduce((n, s) => n + s.tokens, 0),
  };
}

/** A share as a percent a reader can add up — never a bare `0%` for a real slice. */
function sharePercent(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export function ContextRing({ used, window, breakdown = null }: ContextRingProps) {
  /* Window unknown → nothing (law 4). Window known + usage not yet metered →
     draw an empty ring so the model’s published ceiling is still visible in
     the composer (owner 2026-08-25: “context circle for the model they are
     using”). That is not inventing usage — the arc stays at zero and the
     accessible name says so. */
  /* ── TWO WAYS IN, AND THEY CLOSE DIFFERENTLY ─────────────────────────────
     Owner, 2026-09-18, on the built app: "in every single rendering the context
     ring should just be a ring; there's no 'out of 130K context'. When you
     hover it or click on it, it will show the details. Otherwise it's just a
     standing ring with nothing else under it."

     'hover' is a GLANCE: it opens after a pause and it leaves the moment the
     pointer does, because the reader never asked for it and must not have to
     dismiss it. 'pinned' is a DECISION: a click opens it and only Escape, a
     click outside, or a second click on the ring takes it away, because the
     reader is about to read eight rows and a stray pointer move must not cost
     them their place. One panel, two lifetimes — a second panel for the hover
     case would be the same measurement rendered twice. */
  const [open, setOpen] = useState<'closed' | 'hover' | 'pinned'>('closed');
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  const cancelHoverTimer = () => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  /* The timer outlives the element if a turn re-renders the composer while the
     pointer is on the ring, and a setState after unmount is a warning nobody
     can trace back to a hover. */
  useEffect(() => cancelHoverTimer, []);

  useEffect(() => {
    if (open !== 'pinned') return;
    const onDoc = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setOpen('closed');
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen('closed');
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (window === null || window <= 0) return null;

  const measured = used === null ? 0 : used;
  const metered = used !== null;
  const fraction = contextFraction(measured, window);
  /* THE HEADER LINE, ONE PLACE. The panel prints it, the tooltip prints it, and
     the ring is drawn from the same two numbers — so there is one rounding of
     one pair rather than three that drift (owner 2026-09-18: "you say 0 / 131k
     and show a breakdown depending on how much is done, that's all"). The em
     dash, not `0`, when nothing has been metered: zero is a measurement. */
  const headline = `${metered ? formatContextWindowTokens(measured) : '—'} / ${formatContextWindowTokens(window)}`;
  /* The accessible name keeps both numbers in FULL — a screen reader gets no
     tooltip and no bar, so the rounded pair would be all it ever heard. */
  const label = metered
    ? `${measured.toLocaleString()} of ${window.toLocaleString()} context-window tokens`
    : `Context window ${window.toLocaleString()} tokens, no turn measured yet`;
  const slices = contextSlices(breakdown);

  return (
    <span
      className="ctxring-anchor"
      ref={wrapRef}
      onMouseEnter={() => {
        if (open !== 'closed') return;
        cancelHoverTimer();
        hoverTimer.current = setTimeout(() => {
          hoverTimer.current = null;
          setOpen((v) => (v === 'closed' ? 'hover' : v));
        }, HOVER_OPEN_MS);
      }}
      onMouseLeave={() => {
        cancelHoverTimer();
        setOpen((v) => (v === 'hover' ? 'closed' : v));
      }}
    >
      <button
        type="button"
        className="ctxring-wrap"
        data-testid="composer-context"
        data-fraction={fraction.toFixed(3)}
        data-metered={metered ? 'true' : 'false'}
        data-open={open}
        aria-label={label}
        aria-expanded={open !== 'closed'}
        aria-controls={panelId}
        /* NO `title`. The panel below IS the tooltip, and a native one on the
           same element would open a second later on top of it saying the same
           pair — the duplicate the owner is asking to be rid of, arriving 750ms
           late. The accessible name still carries both numbers in full. */
        onFocus={() => setOpen((v) => (v === 'closed' ? 'hover' : v))}
        onBlur={() => setOpen((v) => (v === 'hover' ? 'closed' : v))}
        onClick={() => {
          cancelHoverTimer();
          setOpen((v) => (v === 'pinned' ? 'closed' : 'pinned'));
        }}
      >
        <span className="ctxring" role="img" aria-hidden="true">
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
            <circle className="ctxring-track" cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} />
            <circle
              className="ctxring-used"
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              strokeWidth={STROKE}
              strokeDasharray={`${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE}`}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          </svg>
        </span>
        {/* THE RING AND NOTHING ELSE. No count, no label, no sibling span —
            "otherwise it's just a standing ring with nothing else under it"
            (owner, 2026-09-18). Both numbers are in the accessible name above
            and in the panel below; neither is printed on the composer row. */}
      </button>
      {open !== 'closed' ? (
        <div
          className="ctxring-panel"
          data-open={open}
          id={panelId}
          role="dialog"
          aria-label="Context window breakdown"
          data-testid="composer-context-breakdown"
        >
          {/* ONE HEADER LINE. No title above it: the panel opened from the ring
              and nothing else can be in it, so a heading would be a word
              spent telling the reader what they just clicked. */}
          <p className="ctxring-head mono" data-testid="composer-context-label">
            {headline}
          </p>
          {slices.rows.length > 0 ? (
            <>
              {/* The bar carries the same numbers as the rows below it, which is
                  why it needs no legend: each segment is the row under it, in
                  the same order, and hovering one names it. */}
              <div
                className="ctxring-bar"
                data-testid="composer-context-bar"
                role="img"
                aria-label={slices.rows
                  .map((r) => `${r.label} ${sharePercent(r.share)}`)
                  .join(', ')}
              >
                {slices.rows.map((row, i) => (
                  <span
                    key={row.id}
                    className="ctxring-seg"
                    data-testid="composer-context-seg"
                    data-section={row.id}
                    style={{
                      width: `${row.share * 100}%`,
                      /* Depth, not hue — Graphite law 1 (never more hues than
                         claims). The slices are one claim, so they are one
                         colour at descending strengths, brightest first, which
                         is also the order they are sorted in. */
                      opacity: Math.max(0.28, 1 - i * 0.09),
                    }}
                    title={`${row.label} · ${formatContextWindowTokens(row.tokens)} (${sharePercent(row.share)})`}
                  />
                ))}
              </div>
              <ul className="ctxring-panel-list">
                {slices.rows.map((row) => (
                  <li key={row.id} data-testid="composer-context-section" data-section={row.id}>
                    <span className="ctxring-sec-label">{row.label}</span>
                    <span className="ctxring-sec-tokens mono">
                      {formatContextWindowTokens(row.tokens)} ({sharePercent(row.share)})
                    </span>
                  </li>
                ))}
              </ul>
              {slices.hidden > 0 ? (
                /* Counted, not listed: eight rows is the point at which the
                   panel starts scrolling, and a ninth slice worth reading would
                   have sorted above one of the eight. */
                <p className="ctxring-more" data-testid="composer-context-more">
                  +{slices.hidden} smaller
                </p>
              ) : null}
            </>
          ) : (
            /* Two absences, two different facts — and neither is explained,
               only stated. Nothing metered at all, versus a metered turn the
               server sent no sections for. */
            <p className="ctxring-panel-empty" data-testid="composer-context-breakdown-empty">
              {metered ? 'no breakdown on this turn' : 'no turn measured yet'}
            </p>
          )}
        </div>
      ) : null}
    </span>
  );
}
