import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Clip, Window } from '@/components/lt/Window';
import { Reveal, useNear, useReducedMotion } from '@/components/lt/hooks';

/**
 * DAY TO DAY, AS ONE PLAYER (owner, 2026-10-10 17:56: "the day to day is a
 * little too low", and earlier: "more frosted glass and transparency"). One
 * big window that plays each step's clip once, then moves to the next, and
 * under it the five steps on glass, each with a bar that fills while its clip
 * plays. Click or arrow to any step. Every clip is the step's own recording,
 * used once on the page; the last one is the agentic-workflow run that used to
 * have its own chapter.
 *
 * Nothing changes size: the window is 16:9 before anything loads, every step
 * is on screen all the time, the bar is a transform. Reduced motion: no
 * autoplay and no bars; the poster of the chosen step, with its Play button.
 */
const STEPS = [
  {
    id: 'workspaces',
    title: 'Open any project.',
    body: 'Each workspace is a folder with its chats under it. Switch project and its own map comes with it.',
    window: 'Workspaces',
  },
  {
    id: 'whiteboard-draw',
    title: 'Draw what you are planning.',
    body: 'Describe a system and the boxes lay themselves out. Anything drawn stays a claim until the code proves it.',
    window: 'Whiteboard',
  },
  {
    id: 'ask-chat',
    title: 'Ask about any box.',
    body: 'Right-click a service and ask. The chat gets a chip naming it, so the answer is about exactly that.',
    window: 'Architecture · Ask about this',
  },
  {
    id: 'agents-workflows',
    title: 'Hand it to agents.',
    body: 'Several agents at once, each in its own git worktree. Compare their work, merge one, discard the rest.',
    window: 'Agents · Workflows',
  },
  {
    id: 'agentic-workflow',
    title: 'Watch the loop run.',
    body: 'A request becomes a workflow: plan, edit, test. When a test fails it goes round again, until it passes.',
    window: 'Agents · Run',
  },
] as const;

const num = (i: number) => String(i + 1).padStart(2, '0');

export function Steps() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  /* Steps already shown keep their poster, so going back never shows an empty frame. */
  const [reached, setReached] = useState(1);
  useEffect(() => setReached((r) => Math.max(r, active + 1)), [active]);
  const rootRef = useRef<HTMLDivElement>(null);
  const near = useNear(rootRef, '800px 0px');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const video = useRef<HTMLVideoElement | null>(null);

  /* The active step's bar follows its clip, one transform per frame. */
  useEffect(() => {
    if (reduced) return undefined;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      const bar = bars.current[active];
      if (bar && v && v.duration > 0) bar.style.transform = `scaleX(${Math.min(1, v.currentTime / v.duration).toFixed(4)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reduced]);

  const go = (i: number, focus = false) => {
    const n = (i + STEPS.length) % STEPS.length;
    bars.current.forEach((b, j) => {
      if (b) b.style.transform = `scaleX(${j < n ? 1 : 0})`;
    });
    setActive(n);
    if (focus) tabs.current[n]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') go(active + 1, true);
    else if (k === 'ArrowLeft' || k === 'ArrowUp') go(active - 1, true);
    else if (k === 'Home') go(0, true);
    else if (k === 'End') go(STEPS.length - 1, true);
    else return;
    e.preventDefault();
  };

  const step = STEPS[active]!;

  return (
    <section id="how" className="lt-section lt-day" aria-labelledby="how-title">
      <div className="lt-wrap-wide">
        <Reveal className="mx-auto max-w-[48rem] text-center">
          <p className="lt-kicker">Day to day</p>
          <h2 id="how-title" className="lt-display">
            From a folder to a team of agents.
          </h2>
          <p className="lt-lede lt-adv-line">Five steps, each recorded in the app. Pick one, or let them play.</p>
        </Reveal>

        <div ref={rootRef} className="lt-day-stage" data-testid="how-player" data-active={step.id}>
          <Window
            title={`Sequence · ${step.window}`}
            className="lt-day-window"
            over={
              /* Wide screens: the step's words on glass over the clip (absolutely placed, so a change of step moves nothing). */
              <p className="lt-overlay lt-glass lt-day-cap">
                <b>{step.title}</b> {step.body}
              </p>
            }
          >
            {STEPS.map((s, i) => (
              <div key={s.id} id={`how-panel-${s.id}`} role="tabpanel" aria-labelledby={`how-tab-${s.id}`} className={`lt-layer ${i === active ? 'is-active' : ''}`} aria-hidden={i === active ? undefined : true}>
                <Clip
                  id={s.id}
                  alt={`${s.title} Recorded in the app.`}
                  load={near && (i === active || i === (active + 1) % STEPS.length)}
                  play={i === active}
                  preload={i === active ? 'auto' : 'metadata'}
                  rewindWhenHidden
                  poster={i < reached || i === active}
                  loop={false}
                  onEnded={i === active ? () => go(active + 1) : undefined}
                  onVideo={
                    i === active
                      ? (v) => {
                          video.current = v;
                        }
                      : undefined
                  }
                />
              </div>
            ))}
          </Window>

          <div className="lt-day-steps" role="tablist" aria-label="Day to day, step by step" aria-orientation="horizontal">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`how-tab-${s.id}`}
                aria-selected={i === active}
                aria-controls={`how-panel-${s.id}`}
                tabIndex={i === active ? 0 : -1}
                className={`lt-day-step lt-glass ${i === active ? 'is-active' : ''} ${i < active ? 'is-done' : ''}`}
                onClick={() => go(i)}
                onKeyDown={onKey}
              >
                <span className="lt-day-bar" aria-hidden="true">
                  <span
                    ref={(el) => {
                      bars.current[i] = el;
                    }}
                  />
                </span>
                <span className="lt-day-head">
                  <span className="lt-step-n">{num(i)}</span>
                  <span className="lt-day-title">{s.title}</span>
                </span>
                <span className="lt-day-body">{s.body}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
