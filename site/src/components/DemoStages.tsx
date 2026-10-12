import type { ReactNode } from 'react';

import { DEMO_V } from '@/data/content';
import {
  ClaudeMark,
  CodexMark,
  CursorMark,
  PiMark,
  SequenceHarnessMark,
  T3CodeMark,
} from '@/components/HarnessLogos';

/**
 * Product demos — distinct moments, correct edge geometry.
 * Ink behind opaque nodes. Dashed claims land on claim boxes.
 */

const ACCENT = 'rgb(var(--accent-dark-rgb))';
const ACCENT_SOFT = 'rgba(var(--accent-dark-rgb), 0.55)';
const NODE = 'rgb(36,36,42)';
const NODE_MUTED = 'rgb(30,30,34)';

function Frame({
  label,
  children,
  light = false,
}: {
  label: string;
  children: ReactNode;
  light?: boolean;
}) {
  return (
    <div
      className={`demo-frame overflow-hidden text-left ${light ? 'bg-[rgb(248,249,252)] text-[rgb(29,29,31)]' : 'text-[rgb(245,245,247)]'}`}
      aria-hidden="true"
    >
      <div
        className={`flex items-center gap-2 border-b px-3 py-2 ${light ? 'border-black/8 bg-white/80' : 'border-white/10 bg-white/5'}`}
      >
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[rgb(255,95,87)]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[rgb(255,189,46)]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[rgb(39,201,63)]" />
        </span>
        <span className={`text-[10px] font-semibold tracking-wide ${light ? 'text-black/45' : 'text-white/45'}`}>
          {label}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[9px] font-medium text-white/55">
          <span className="demo-live-dot h-1.5 w-1.5 rounded-full bg-[color:rgb(var(--accent-dark-rgb))]" />
          live
        </span>
      </div>
      {children}
    </div>
  );
}

/** System design — edges meet node sides; claim is opaque; ink stays under solid nodes. */
export function SysDesignDemo() {
  return (
    <Frame label="Architecture · system design">
      <div className="relative p-3">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(circle at 70% 30%, rgba(var(--accent-rgb), 0.12), transparent 45%)`,
          }}
        />
        <svg viewBox="0 0 220 130" className="relative h-[118px] w-full">
          <defs>
            <marker id="a1" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill={ACCENT} />
            </marker>
            <marker id="a1g" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="rgba(245,245,247,0.75)" />
            </marker>
          </defs>
          {/* soft floor line — structural, not freehand ink */}
          <path
            d="M18 118 C 70 112, 130 112, 200 118"
            fill="none"
            stroke="rgba(245,245,247,0.12)"
            strokeWidth="1"
            strokeLinecap="round"
          />
          {/* solid found: gateway → checkout */}
          <line
            className="demo-edge-pulse"
            x1="78"
            y1="38"
            x2="105"
            y2="38"
            stroke={ACCENT}
            strokeWidth="2"
            markerEnd="url(#a1)"
          />
          <circle r="3" fill={ACCENT}>
            <animateMotion dur="2.8s" repeatCount="indefinite" path="M78,38 L105,38" />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.12;0.88;1"
              dur="2.8s"
              repeatCount="indefinite"
            />
          </circle>
          {/* checkout → ledger */}
          <line
            x1="140"
            y1="58"
            x2="168"
            y2="78"
            stroke="rgba(245,245,247,0.75)"
            strokeWidth="1.75"
            markerEnd="url(#a1g)"
          />
          {/* dashed claim: gateway → claim box */}
          <line
            x1="43"
            y1="58"
            x2="61"
            y2="85"
            stroke="rgba(245,245,247,0.45)"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          {/* opaque nodes on top */}
          <rect x="8" y="18" width="70" height="40" rx="10" fill={NODE} stroke={ACCENT_SOFT} />
          <text x="43" y="42" textAnchor="middle" fill="rgb(255,255,255)" fontSize="10" fontFamily="Inter,system-ui">
            gateway
          </text>
          <rect x="105" y="18" width="70" height="40" rx="10" fill={NODE} stroke="rgba(255,255,255,0.22)" />
          <text x="140" y="42" textAnchor="middle" fill="rgb(255,255,255)" fontSize="10" fontFamily="Inter,system-ui">
            checkout
          </text>
          <rect x="145" y="78" width="66" height="36" rx="10" fill={NODE} stroke="rgba(255,255,255,0.16)" />
          <text x="178" y="100" textAnchor="middle" fill="rgb(255,255,255)" fontSize="10" fontFamily="Inter,system-ui">
            ledger
          </text>
          <rect x="28" y="85" width="66" height="32" rx="10" fill={NODE_MUTED} stroke="rgba(255,255,255,0.14)" />
          <text x="61" y="105" textAnchor="middle" fill="rgba(245,245,247,0.5)" fontSize="9" fontFamily="Inter,system-ui">
            claim…
          </text>
        </svg>
        <div className="mt-1 flex gap-2">
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white/70">
            solid = found
          </span>
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] text-white/45">dashed = claimed</span>
        </div>
      </div>
    </Frame>
  );
}

/** Freehand whiteboard — intentional strokes that respect layout. */
export function DrawDemo() {
  return (
    <Frame label="Whiteboard · freehand" light>
      <div className="relative h-[140px] overflow-hidden bg-[linear-gradient(180deg,rgb(252,252,254),rgb(244,246,250))] p-3">
        <svg viewBox="0 0 220 120" className="h-full w-full">
          <rect x="14" y="14" width="56" height="32" rx="8" fill="rgb(255,255,255)" stroke="rgba(0,0,0,0.12)" />
          <text x="42" y="34" textAnchor="middle" fill="rgb(29,29,31)" fontSize="9" fontFamily="Inter,system-ui">
            auth
          </text>
          <rect x="96" y="14" width="56" height="32" rx="8" fill="rgb(255,255,255)" stroke="rgba(0,0,0,0.12)" />
          <text x="124" y="34" textAnchor="middle" fill="rgb(29,29,31)" fontSize="9" fontFamily="Inter,system-ui">
            api
          </text>
          {/* straight connector under cards */}
          <path
            className="demo-ink"
            pathLength={1}
            d="M70 30 C 78 30, 86 30, 96 30"
            fill="none"
            stroke="rgba(29,29,31,0.45)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {/* one clean annotation arc — not a scribble */}
          <path
            className="demo-ink"
            pathLength={1}
            style={{ animationDelay: '0.25s' }}
            d="M28 78 C 80 62, 140 62, 190 78"
            fill="none"
            stroke="rgba(29,29,31,0.35)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <rect x="162" y="42" width="44" height="36" rx="6" fill="rgba(var(--accent-dark-rgb),0.35)" stroke={ACCENT_SOFT} />
          <text x="184" y="63" textAnchor="middle" fill="rgba(29,29,31,0.55)" fontSize="8" fontFamily="Inter,system-ui">
            note
          </text>
        </svg>
        <div className="absolute bottom-2 left-3 flex gap-1.5">
          {['pen', 'shape', 'sticky'].map((t, i) => (
            <span
              key={t}
              className={`rounded-full px-2 py-0.5 text-[9px] font-medium shadow-sm ring-1 ring-black/5 ${
                i === 0
                  ? 'border border-white/70 bg-[color:color-mix(in_srgb,var(--accent)_55%,white)] text-[color:var(--accent-ink)]'
                  : 'bg-white text-black/55'
              }`}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </Frame>
  );
}

export function FilesDemo() {
  return (
    <Frame label="Files · functions">
      <div className="grid grid-cols-[1.05fr_0.95fr] gap-0">
        <ul className="space-y-0.5 border-r border-white/10 p-2.5 text-[10px]">
          {[
            { t: 'packages/', on: false },
            { t: '  checkout/', on: false },
            { t: '    route.ts', on: true },
            { t: '    cart.ts', on: false },
            { t: '  gateway/', on: false },
          ].map((r) => (
            <li
              key={r.t}
              className={`relative overflow-hidden rounded-md px-2 py-1 font-mono ${
                r.on
                  ? 'demo-shimmer bg-white/10 text-[color:rgb(var(--accent-dark-rgb))]'
                  : 'text-white/55'
              }`}
            >
              {r.t}
            </li>
          ))}
        </ul>
        <div className="p-2.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-white/35">Symbols</p>
          <ul className="mt-1.5 space-y-1">
            {['createCheckout', 'confirmPayment', 'refundOrder'].map((fn, i) => (
              <li
                key={fn}
                className={`rounded-lg px-2 py-1.5 text-[10px] ${
                  i === 0
                    ? 'bg-white/10 text-white ring-1 ring-white/20'
                    : 'text-white/50'
                }`}
              >
                <span className="mr-1 text-[color:rgb(var(--accent-dark-rgb))]">ƒ</span>
                {fn}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[9px] text-white/40">Graph re-sorts on select →</p>
        </div>
      </div>
    </Frame>
  );
}

export function BrowserDemo() {
  return (
    <Frame label="Browser · preview" light>
      <div className="bg-[rgb(248,249,252)] p-2.5">
        <div className="mb-2 flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-[9px] text-black/45 ring-1 ring-black/8">
          <span className="demo-live-dot h-1.5 w-1.5 rounded-full bg-[rgb(39,201,63)]" />
          localhost:4173/checkout
        </div>
        <div className="overflow-hidden rounded-xl bg-white shadow-[0_8px_24px_rgba(0,0,0,0.08)] ring-1 ring-black/5">
          <div className="border-b border-black/5 px-3 py-2 text-[10px] font-semibold">Checkout</div>
          <div className="space-y-2 p-3">
            <div className="h-2.5 w-3/4 rounded bg-black/8" />
            <div className="h-2.5 w-1/2 rounded bg-black/6" />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[9px] text-black/40">$48.00</span>
              <span className="demo-shimmer relative overflow-hidden rounded-full border border-white/80 bg-[color:color-mix(in_srgb,var(--accent)_55%,white)] px-3 py-1 text-[9px] font-semibold text-[color:var(--accent-ink)]">
                Pay now
              </span>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** Studio: the AI Canvas, captured from the app — a real block the agent drew on this repo. */
export function AiCanvasDemo() {
  return (
    <Frame label="AI Canvas · explain, drawn">
      {/* The canvas pane is the right 56% of the capture; scale the capture so
          that pane fills the stage and slide it into view. Inline, because the
          stage is a fixed 320px and the crop is a number, not a utility. */}
      <div className="demo-fill relative">
      <img
        src={`/demo/canvas.png?v=${DEMO_V}`}
        alt="The AI Canvas holding a diagram block the agent drew while explaining a chat turn"
        width={1920}
        height={1200}
        loading="lazy"
        decoding="async"
        className="absolute left-0 top-0 block"
        style={{ width: '192%', maxWidth: 'none', height: 'auto', transform: 'translate(-46%, -34%)' }}
      />
      </div>
    </Frame>
  );
}

/**
 * ONE PANE OF A CAPTURE, CROPPED BY MEASUREMENT (owner, 2026-09-19: the
 * impact board and the chat are "cut off… not very transparent").
 *
 * The crops here were three hand-tuned pairs of percentages — a width and a
 * `translate()` — and a `translate` percentage resolves against the IMAGE,
 * while the stage it slides inside is a different size again. So every pane
 * was framed by eye, and two of the three had drifted until the pane was
 * clipped through its own edge.
 *
 * `x0`/`x1` are the pane's real edges in the capture, taken off the pixels:
 * a column-mean luminance step finds the divider (board.png divides at
 * x=1123 of 1920 = 0.585). From those two numbers the zoom and the
 * horizontal position are arithmetic, not taste.
 *
 * `background-position` does the vertical framing for us: a percentage
 * aligns that point of the image with the same point of the stage, so it can
 * never leave a gap at either edge, whatever height the card ends up. All
 * `focusY` chooses is which part of a tall pane the stage lands on.
 */
function PaneCrop({
  src,
  alt,
  x0,
  x1,
  focusY,
}: {
  src: string;
  alt: string;
  x0: number;
  x1: number;
  focusY: number;
}) {
  const zoom = 1 / (x1 - x0);
  const posX = (x0 / (1 - (x1 - x0))) * 100;
  return (
    <div
      className="demo-fill demo-pane"
      role="img"
      aria-label={alt}
      style={{
        backgroundImage: `url(${src})`,
        backgroundSize: `${zoom * 100}% auto`,
        backgroundPosition: `${posX}% ${focusY * 100}%`,
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
}

/** Studio: the chat column of a real capture — question, tool cards, answer. */
export function TerminalDemo() {
  return (
    <Frame label="Chat · grounded agent">
      <PaneCrop
        src={`/demo/ask.png?v=${DEMO_V}`}
        alt="The chat column: a question, two tool-call cards, and an answer citing files and lines"
        x0={0.181}
        x1={0.585}
        focusY={0.34}
      />
    </Frame>
  );
}

/** Studio: the Architecture pane of a real capture — the scanned graph. */
export function ImpactDemo() {
  return (
    <Frame label="Architecture · the scanned graph">
      <PaneCrop
        src={`/demo/board.png?v=${DEMO_V}`}
        alt="The Architecture pane: packages as nodes with import edges between them"
        x0={0.586}
        x1={0.995}
        focusY={0.45}
      />
    </Frame>
  );
}

/** Studio: harness progression with real Simple Icons marks. */
export function CompareDemo() {
  const lanes = [
    { name: 'Cursor', note: '1 surface', Mark: CursorMark },
    { name: 'Claude Code', note: '1 surface', Mark: ClaudeMark },
    { name: 'Codex', note: '1 surface', Mark: CodexMark },
    { name: 'Pi', note: 'open loop', Mark: PiMark },
    { name: 'T3 Code', note: 'control plane', Mark: T3CodeMark },
    { name: 'Sequence', note: '7 surfaces', Mark: SequenceHarnessMark, on: true },
  ];
  return (
    <Frame label="Compare · outcomes">
      <div className="demo-fill space-y-1.5 p-3">
        <p className="text-[9px] text-white/40">Closed + open harnesses · same checklist</p>
        <ul className="space-y-1">
          {lanes.map((l) => {
            const Mark = l.Mark;
            return (
              <li
                key={l.name}
                className={`flex items-center gap-2 rounded-lg px-2 py-1 ${
                  l.on
                    ? 'bg-[color:rgba(var(--accent-dark-rgb),0.22)] ring-1 ring-[color:rgba(var(--accent-dark-rgb),0.45)]'
                    : 'bg-white/5'
                }`}
              >
                {/* Solid white plate — Sequence ink + Codex blossom stay readable on graphite */}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white shadow-[0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-black/10">
                  <Mark className="h-5 w-5" />
                </span>
                <span className={`text-[11px] font-medium ${l.on ? 'text-white' : 'text-white/70'}`}>{l.name}</span>
                <span className={`ml-auto font-mono text-[10px] ${l.on ? 'text-[color:rgb(var(--accent-dark-rgb))]' : 'text-white/35'}`}>
                  {l.note}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Frame>
  );
}

export function SurfacesDemo() {
  const names = ['Chat', 'Files', 'Architecture', 'Whiteboard', 'AI Canvas', 'Agents', 'Terminal', 'Browser'];
  return (
    <div className="demo-frame overflow-hidden text-[rgb(245,245,247)]" aria-hidden="true">
      <div className="border-b border-white/10 px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40">Eight surfaces</p>
      </div>
      <div className="grid grid-cols-2 gap-1.5 p-3 sm:grid-cols-4 lg:grid-cols-8">
        {names.map((s, i) => (
          <div
            key={s}
            className={`rounded-lg px-2 py-2 text-center text-[10px] ${
              i === 2
                ? 'bg-white/12 text-[color:rgb(var(--accent-dark-rgb))] ring-1 ring-white/20'
                : 'bg-white/5 text-white/55'
            }`}
          >
            {s}
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-3 py-2.5">
        <svg viewBox="0 0 220 56" className="h-14 w-full">
          <line className="demo-edge-pulse" x1="48" y1="28" x2="72" y2="28" stroke={ACCENT} strokeWidth="2" />
          <line
            x1="118"
            y1="28"
            x2="142"
            y2="28"
            stroke="rgba(245,245,247,0.4)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <rect x="8" y="14" width="40" height="28" rx="7" fill={NODE} stroke={ACCENT_SOFT} />
          <rect x="72" y="14" width="46" height="28" rx="7" fill={NODE} stroke="rgba(255,255,255,0.14)" />
          <rect x="142" y="14" width="46" height="28" rx="7" fill={NODE_MUTED} stroke="rgba(255,255,255,0.1)" />
        </svg>
      </div>
    </div>
  );
}
