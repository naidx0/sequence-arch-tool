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
  /** One more measured line for the panel (an agent account's usage limit). */
  note?: string | null;
}

/** Geometry, in the 16px box the composer's control row gives it. */
const SIZE = 14;
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

/** Where the warning colour starts, and where the window counts as full. */
export const CONTEXT_WARN_AT = 0.8;
export const CONTEXT_FULL_AT = 0.95;

/** ok below 80%, warn from 80%, full from 95%: colour is spent only near the limit. */
export function contextLevel(fraction: number): 'ok' | 'warn' | 'full' {
  if (fraction >= CONTEXT_FULL_AT) return 'full';
  if (fraction >= CONTEXT_WARN_AT) return 'warn';
  return 'ok';
}

/** A whole-number percent; a real but tiny use never reads as 0%. */
export function contextPercent(used: number, window: number): string {
  const f = contextFraction(used, window);
  if (used > 0 && f * 100 < 1) return '<1%';
  return `${Math.round(f * 100)}%`;
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

/**
 * THE FOUR NAMED PARTS A READER KNOWS (round 12, A1): System, Tools, History, Files.
 *
 * Jaden: "hover explanation must be much better (clear breakdown)". The server
 * sends three measured slices (instructions, tool results, the architecture
 * digest and question); the reader thinks in four: what the agent was told
 * (System), what its tools returned (Tools), what was said so far (History) and
 * what it read of the workspace (Files). The first, second and fourth are the
 * server's own slices, renamed. History is the part of the metered input the
 * three slices do not account for: arithmetic on two measured numbers, shown
 * only when the provider metered the input, otherwise an em dash. Nothing is
 * invented: a part with no measurement reads as an em dash, never a zero.
 *
 * Shares are of the WINDOW (the thing the ring draws), so the segments of the
 * bar and the percent beside each row agree with the ring and its headline.
 */
export type ContextPartId = 'system' | 'tools' | 'history' | 'files';
export interface ContextPart {
  id: ContextPartId;
  label: string;
  /** Null when this part was not measured. */
  tokens: number | null;
  /** Fraction of the window, 0 when not measured. */
  share: number;
}

const PART_OF_SECTION: Record<string, ContextPartId> = { instructions: 'system', tools: 'tools', grounding: 'files', other: 'history' };
/* Each label says no more than it measures: Files is the architecture digest AND the question;
   History is whatever the metered input holds beyond the three estimates (conversation, the base
   prompt, tool definitions, estimation error). */
const PART_LABEL: Record<ContextPartId, string> = { system: 'Instructions', tools: 'Tool results', history: 'Other (history, base prompt)', files: 'Files and question' };
const PART_ORDER: readonly ContextPartId[] = ['system', 'tools', 'history', 'files'];

export function contextParts(
  breakdown: AskContextBreakdown | null | undefined,
  used: number | null,
  window: number,
): ContextPart[] {
  if (!breakdown || breakdown.sections.every((s) => s.tokens <= 0)) return [];
  const tokens: Partial<Record<ContextPartId, number>> = {};
  for (const s of breakdown.sections) {
    const id = PART_OF_SECTION[s.id];
    if (id && s.tokens > 0) tokens[id] = (tokens[id] ?? 0) + s.tokens;
  }
  /* History: the metered input minus the slices the server named. Only when the provider metered it. */
  const named = (tokens.system ?? 0) + (tokens.tools ?? 0) + (tokens.files ?? 0) + (tokens.history ?? 0);
  if (used !== null && used > named && tokens.history === undefined) tokens.history = used - named;
  return PART_ORDER.map((id) => {
    const t = tokens[id];
    return { id, label: PART_LABEL[id], tokens: t ?? null, share: t !== undefined && window > 0 ? Math.min(1, t / window) : 0 };
  });
}

export function ContextRing({ used, window, breakdown = null, note = null }: ContextRingProps) {
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
    : `Context window ${window.toLocaleString()} tokens, no context yet`;
  const parts = contextParts(breakdown, metered ? measured : null, window);
  const level = contextLevel(fraction);
  const left = Math.max(0, window - measured);

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
        data-level={level}
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
          {/* HEADER: the gauge's name and its percent. */}
          <div className="ctxring-top">
            <span className="ctxring-title">Context window</span>
            <span className="ctxring-pct" data-testid="composer-context-percent" data-level={level}>
              {metered ? contextPercent(measured, window) : '—'}
            </span>
          </div>
          {/* USED OF TOTAL, in one line: the pair the ring is drawn from. */}
          <p className="ctxring-pair">
            <span className="ctxring-head mono" data-testid="composer-context-label">
              {headline}
            </span>
            <span className="ctxring-unit">tokens</span>
          </p>
          {/* THE WINDOW AS ONE BAR: each part is a segment of the window, what is
              left is the empty track. Depth, not hue (Graphite law 1). */}
          <div
            className="ctxring-meter"
            data-testid="composer-context-meter"
            data-level={level}
            role="meter"
            aria-label="Context window used"
            aria-valuemin={0}
            aria-valuemax={window}
            aria-valuenow={Math.min(measured, window)}
          >
            {parts.length > 0 ? (
              parts.map((part, i) => (
                <span
                  key={part.id}
                  className="ctxring-seg"
                  data-testid="composer-context-seg"
                  data-section={part.id}
                  style={{ width: `${part.share * 100}%`, opacity: Math.max(0.35, 1 - i * 0.22) }}
                />
              ))
            ) : (
              <span className="ctxring-meter-fill" style={{ width: `${fraction * 100}%` }} />
            )}
          </div>
          {metered ? (
            <p className="ctxring-left" data-testid="composer-context-left" data-level={level}>
              {level === 'full' ? 'Window is full. Older context will be trimmed.' : `${formatContextWindowTokens(left)} left`}
            </p>
          ) : null}
          {parts.length > 0 ? (
            <ul className="ctxring-panel-list" data-testid="composer-context-parts">
              {parts.map((part, i) => (
                <li key={part.id} data-testid="composer-context-section" data-section={part.id}>
                  <span className="ctxring-key" aria-hidden="true" style={{ opacity: Math.max(0.35, 1 - i * 0.22) }} />
                  <span className="ctxring-sec-label">{part.label}</span>
                  <span className="ctxring-sec-tokens mono">{part.tokens === null ? '—' : formatContextWindowTokens(part.tokens)}</span>
                  <span className="ctxring-sec-pct mono">{part.tokens === null ? '' : sharePercent(part.share)}</span>
                </li>
              ))}
            </ul>
          ) : (
            /* Two absences, two different facts, stated and not explained. */
            <p className="ctxring-panel-empty" data-testid="composer-context-breakdown-empty">
              {metered ? 'no breakdown on this turn' : 'No context yet'}
            </p>
          )}
          {note ? (
            <p className="ctxring-note" data-testid="composer-context-note">
              {note}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
