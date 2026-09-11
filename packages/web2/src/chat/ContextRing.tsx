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

export function ContextRing({ used, window, breakdown = null }: ContextRingProps) {
  /* Window unknown → nothing (law 4). Window known + usage not yet metered →
     draw an empty ring so the model’s published ceiling is still visible in
     the composer (owner 2026-08-25: “context circle for the model they are
     using”). That is not inventing usage — the arc stays at zero and the
     accessible name says so. */
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
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
  const label = metered
    ? `${measured.toLocaleString()} of ${window.toLocaleString()} tokens in the context window`
    : `Model context window ${window.toLocaleString()} tokens (usage not yet measured)`;

  return (
    <span className="ctxring-anchor" ref={wrapRef}>
      <button
        type="button"
        className="ctxring-wrap"
        data-testid="composer-context"
        data-fraction={fraction.toFixed(3)}
        data-metered={metered ? 'true' : 'false'}
        title={`${label}. Click for breakdown.`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
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
        <span className="ctxring-label mono" data-testid="composer-context-label">
          {metered
            ? `${formatContextWindowTokens(measured)}/${formatContextWindowTokens(window)}`
            : formatContextWindowTokens(window)}
        </span>
      </button>
      {open ? (
        <div
          className="ctxring-panel"
          id={panelId}
          role="dialog"
          aria-label="Context window breakdown"
          data-testid="composer-context-breakdown"
        >
          <p className="ctxring-panel-title">What filled the window</p>
          {!metered ? (
            <p className="ctxring-panel-empty" data-testid="composer-context-breakdown-empty">
              Usage not yet measured for this model window.
            </p>
          ) : breakdown === null || breakdown.sections.length === 0 ? (
            <p className="ctxring-panel-empty" data-testid="composer-context-breakdown-empty">
              No section breakdown on this turn — ring total is still the
              provider input count when metered.
            </p>
          ) : (
            <ul className="ctxring-panel-list">
              {breakdown.sections.map((sec) => (
                <li key={sec.id} data-testid="composer-context-section" data-section={sec.id}>
                  <span className="ctxring-sec-label">{sec.label}</span>
                  <span className="ctxring-sec-tokens mono">
                    ~{sec.tokens.toLocaleString()}
                    {sec.estimated ? ' est.' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {breakdown !== null && breakdown.totalApprox > 0 ? (
            <p className="ctxring-panel-foot mono" data-testid="composer-context-breakdown-total">
              ~{breakdown.totalApprox.toLocaleString()} approx
              {typeof breakdown.totalMeasured === 'number'
                ? ` · ${breakdown.totalMeasured.toLocaleString()} measured`
                : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
