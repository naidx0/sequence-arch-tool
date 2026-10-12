import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { siOllama } from 'simple-icons';
import { ClaudeMark, CodexMark } from '@/components/HarnessLogos';
import { Reveal, useReducedMotion } from '@/components/lt/hooks';
import { Clip, Window } from '@/components/lt/Window';

/**
 * CONNECT ANY AGENT (owner, 2026-10-10: "show the connect any agent… multi
 * provider… have them running in the background"; second tour: "very cool…
 * maybe if we can interact there"). The connect-agent clip leads: three chats
 * on three agents, each started while the last answers. Under it, a router you
 * can drive: the map on the left, the agents on the right; hover, focus or
 * click an agent and the same map context runs down the wire to it, through
 * the same two tools. "Several at once" routes it to all three. Until someone
 * touches it, it steps through the four on its own while on screen.
 *
 * Facts from the 0.1.4 release notes and the provider presets: Claude sets
 * itself up on first use; Codex runs through its app server; a local model
 * through Ollama or LM Studio needs no key; Send to N gives each agent its own
 * chat and worktree. The tools are two of the MCP server's: find_files and
 * impact.
 *
 * Nothing changes size: every card is on screen all the time, the wire is
 * drawn in its own column from measured centres, the moving context is a
 * transform. Reduced motion: no stepping and no moving context; the chosen
 * route is drawn at once.
 */
function OllamaMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={siOllama.path} fill="currentColor" />
    </svg>
  );
}

function ManyMark() {
  return (
    <span className="lt-agent-stack" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

type Card = { id: string; name: string; body: string; Mark?: (p: { className?: string }) => ReactElement };
const CARDS: Card[] = [
  { id: 'claude', name: 'Claude Code', body: 'Sets itself up the first time you use it. Sign in once.', Mark: ClaudeMark },
  { id: 'codex', name: 'Codex', body: 'Approvals and diffs land in the chat, with the model it reports for each run.', Mark: CodexMark },
  { id: 'local', name: 'Local models', body: 'Ollama or LM Studio on your machine. No key, works offline.', Mark: OllamaMark },
  { id: 'many', name: 'Several at once', body: 'One task to several agents, each in its own chat and worktree.' },
];
const MANY = 3;
const routesOf = (i: number) => (i === MANY ? [0, 1, 2] : [i]);

/* The map on the left: the sample shop, as the app draws it. */
const NODES = [
  { name: 'Gateway', x: 18, y: 22 },
  { name: 'Payments', x: 146, y: 22 },
  { name: 'Orders', x: 18, y: 96 },
  { name: 'Inventory', x: 146, y: 96 },
  { name: 'order.created', x: 146, y: 170, pill: true },
  { name: 'Postgres', x: 18, y: 244 },
  { name: 'Shipping', x: 146, y: 244 },
];
const MAP_EDGES = [
  'M64 48 V96',
  'M110 104 H128 V35 H146',
  'M110 109 H146',
  'M110 116 H128 V183 H146',
  'M192 196 V244',
  'M64 122 V244',
];

type Geo = { w: number; h: number; y0: number; ys: number[] };

export function Agents() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const [inView, setInView] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const wire = useRef<SVGSVGElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const [geo, setGeo] = useState<Geo | null>(null);

  /* Where the wire starts (the map's right edge, its middle) and ends (each agent card's middle), in the wire's own pixels. */
  useLayoutEffect(() => {
    const measure = () => {
      const svg = wire.current;
      const map = mapRef.current;
      if (!svg || !map) return;
      const r = svg.getBoundingClientRect();
      if (r.width === 0) {
        setGeo(null);
        return;
      }
      const m = map.getBoundingClientRect();
      const ys = cards.current.slice(0, 3).map((c) => {
        const b = c?.getBoundingClientRect();
        return b ? b.top + b.height / 2 - r.top : 0;
      });
      const next = { w: Math.round(r.width), h: Math.round(r.height), y0: Math.round(m.top + m.height / 2 - r.top), ys: ys.map(Math.round) };
      setGeo((g) => (g && g.w === next.w && g.h === next.h && g.y0 === next.y0 && g.ys.join() === next.ys.join() ? g : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (stage.current) ro.observe(stage.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((e) => setInView(e.some((x) => x.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* On its own, one agent after another, until someone picks one. */
  useEffect(() => {
    if (reduced || touched || !inView) return undefined;
    const t = window.setInterval(() => setActive((a) => (a + 1) % CARDS.length), 2800);
    return () => window.clearInterval(t);
  }, [reduced, touched, inView]);

  /* The context running down the active wires: a dot per wire, a transform per frame. */
  useEffect(() => {
    if (reduced || !geo) return undefined;
    let raf = 0;
    const start = performance.now();
    const on = routesOf(active);
    const tick = (now: number) => {
      const t = ((now - start) / 1100) % 1;
      for (let i = 0; i < 3; i += 1) {
        const p = paths.current[i];
        const d = dots.current[i];
        if (!p || !d) continue;
        if (!on.includes(i)) {
          d.style.opacity = '0';
          continue;
        }
        const L = p.getTotalLength();
        const q = p.getPointAtLength(L * t);
        d.setAttribute('transform', `translate(${q.x.toFixed(1)} ${q.y.toFixed(1)})`);
        d.style.opacity = String(Math.min(1, t * 6, (1 - t) * 6));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced, geo]);

  const pick = (i: number, focus = false) => {
    setTouched(true);
    setActive(i);
    if (focus) cards.current[i]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowRight') pick((active + 1) % CARDS.length, true);
    else if (k === 'ArrowUp' || k === 'ArrowLeft') pick((active + CARDS.length - 1) % CARDS.length, true);
    else if (k === 'Home') pick(0, true);
    else if (k === 'End') pick(CARDS.length - 1, true);
    else return;
    e.preventDefault();
  };

  const on = routesOf(active);
  const wireD = (i: number) => {
    if (!geo) return '';
    const x1 = geo.w - 2;
    const y1 = geo.ys[i] ?? 0;
    const mx = geo.w * 0.5;
    return `M0 ${geo.y0} C${mx} ${geo.y0} ${mx} ${y1} ${x1} ${y1}`;
  };

  return (
    <section id="agents" className="lt-adv" aria-labelledby="agents-title">
      <div className="lt-wrap-wide">
        <Reveal className="lt-adv-head">
          <p className="lt-kicker">Connect any agent</p>
          <h2 id="agents-title" className="lt-h2">
            One map. Any agent.
          </h2>
          <p className="lt-lede lt-adv-line">
            Claude Code, Codex or a local model read the same map through the same tools. Run several at once and let them
            work in the background.
          </p>
        </Reveal>
        <Reveal className="lt-adv-clip" delay={80}>
          <Window title="Sequence · three agents">
            <Clip id="connect-agent" alt="Three chats started one after another on Claude Code, Codex and a local model, each answer still arriving while the next chat starts. Recorded in the app; the answers are replayed samples." />
          </Window>
        </Reveal>

        <div ref={stage} id="agent-router" className="lt-route" data-testid="agent-router" data-active={CARDS[active]!.id}>
          <div ref={mapRef} className="lt-route-map">
            <svg viewBox="0 0 256 290" className="lt-route-svg" role="img" aria-label="The map Sequence read from the code: Gateway, Orders, Payments, Inventory, order.created, Postgres and Shipping.">
              <g fill="none" stroke="rgba(255, 255, 255, 0.4)" strokeWidth={1.2}>
                {MAP_EDGES.map((d) => (
                  <path key={d} d={d} />
                ))}
              </g>
              {NODES.map((n) => (
                <g key={n.name} transform={`translate(${n.x} ${n.y})`}>
                  <rect width={92} height={26} rx={n.pill ? 13 : 6} fill="rgb(46, 46, 44)" stroke="rgba(255, 255, 255, 0.16)" />
                  {!n.pill ? <rect x={8} y={8} width={10} height={10} rx={3} fill="rgba(91, 155, 255, 0.22)" /> : null}
                  <text x={n.pill ? 46 : 24} y={17} textAnchor={n.pill ? 'middle' : 'start'} fontSize={10.5} fontWeight={600} fill="rgb(236, 235, 232)">
                    {n.name}
                  </text>
                </g>
              ))}
            </svg>
            <p className="lt-route-tools">
              <span>find_files</span>
              <span>impact</span>
            </p>
          </div>

          <div className="lt-route-wirebox" aria-hidden="true">
          <svg ref={wire} className="lt-route-wire">
            {geo ? (
              <>
                {[0, 1, 2].map((i) => (
                  <path
                    key={i}
                    ref={(el) => {
                      paths.current[i] = el;
                    }}
                    d={wireD(i)}
                    fill="none"
                    className={on.includes(i) ? 'is-on' : undefined}
                  />
                ))}
                {[0, 1, 2].map((i) => (
                  <circle
                    key={i}
                    ref={(el) => {
                      dots.current[i] = el;
                    }}
                    r={4.5}
                    className="lt-route-dot"
                    style={{ opacity: 0 }}
                  />
                ))}
                <circle cx={3} cy={geo.y0} r={4} className="lt-route-port" />
              </>
            ) : null}
          </svg>
          </div>

          <div className="lt-route-agents" role="radiogroup" aria-label="Send the map to">
            {CARDS.map((c, i) => {
              const lit = on.includes(i) || i === active;
              return (
                <button
                  key={c.id}
                  ref={(el) => {
                    cards.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={i === active}
                  tabIndex={i === active ? 0 : -1}
                  className={`lt-route-agent ${lit ? 'is-on' : ''} ${c.id === 'many' ? 'is-many' : ''}`}
                  onClick={() => pick(i)}
                  onPointerEnter={(e) => {
                    if (e.pointerType === 'mouse') pick(i);
                  }}
                  onKeyDown={onKey}
                >
                  <span className="lt-agent-mark">{c.Mark ? <c.Mark className="h-[20px] w-[20px]" /> : <ManyMark />}</span>
                  <span className="lt-route-text">
                    <span className="lt-route-name">
                      {c.name}
                      <span className="lt-route-live" aria-hidden="true">
                        Reading the map
                      </span>
                    </span>
                    <span className="lt-route-body">{c.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="lt-route-cap">Hover or pick an agent: the same map goes to it, through the same two tools.</p>
      </div>
    </section>
  );
}
