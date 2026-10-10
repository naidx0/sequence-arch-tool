import { useEffect, useRef, useState } from 'react';
import { Clip, Window } from '@/components/lt/Window';
import { Reveal, useMediaQuery, useNear } from '@/components/lt/hooks';

/**
 * HOW IT WORKS, AS A SCROLL (Cursor's walkthrough).
 *
 * Wide: numbered steps on the left in the app's step list (one bordered row
 * per step, the number in a chip), one window on the right that stays put and
 * crossfades to the clip of the step crossing the middle of the viewport. Only
 * that clip plays. Narrow: the same steps stacked, each with its own clip.
 * One layout is mounted at a time, so no clip is created twice.
 */
const STEPS = [
  {
    id: 'workspaces',
    title: 'Open your projects.',
    body: "Each workspace is a folder with its chats under it. Switching project loads that project's own map.",
    window: 'Workspaces',
  },
  {
    id: 'whiteboard-draw',
    title: 'Draw beside the map.',
    body: 'Describe a system in chat and the boxes place themselves on the whiteboard. Select and drag is the default tool. A drawn edge stays a claim until the scanner finds it.',
    window: 'Whiteboard',
  },
  {
    id: 'ask-chat',
    title: 'Ask about a service on the map.',
    body: 'Right-click a card and choose Ask about this. The question goes to the chat with a chip naming the service. The answer in this clip is a sample reply.',
    window: 'Architecture · Ask about this',
  },
  {
    id: 'agents-workflows',
    title: 'Hand it to agents.',
    body: 'Several agents at once, each in its own git worktree. Context and Output are shown as the agent reports them. The run history and token figures in this clip are illustrative.',
    window: 'Agents · Workflows',
  },
] as const;

const num = (i: number) => String(i + 1).padStart(2, '0');

export function Steps() {
  const wide = useMediaQuery('(min-width: 960px)');
  return (
    <section id="how" className="lt-section lt-band" aria-labelledby="how-title">
      <div className="lt-wrap-wide">
        <Reveal className="mx-auto max-w-[44rem] text-center">
          <p className="lt-kicker">Day to day</p>
          <h2 id="how-title" className="lt-display">
            From a folder to a team of agents.
          </h2>
        </Reveal>
        {wide ? <StickySteps /> : <StackedSteps />}
      </div>
    </section>
  );
}

function StickySteps() {
  const [active, setActive] = useState(0);
  /* Layers already reached keep their poster, so scrolling back never shows an empty frame. */
  const [reached, setReached] = useState(1);
  useEffect(() => setReached((r) => Math.max(r, active + 1)), [active]);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const near = useNear(rootRef, '800px 0px');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    /* A one-pixel line across the middle of the viewport: the step on it is the one being read. */
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.step);
          if (!Number.isNaN(i)) setActive(i);
        }
      },
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );
    for (const el of stepRefs.current) if (el) obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const go = (i: number) => {
    const el = stepRefs.current[i];
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top + r.height / 2 - window.innerHeight / 2, behavior: 'smooth' });
  };

  const step = STEPS[active]!;

  return (
    <div ref={rootRef} className="lt-scrolly" data-testid="how-sticky" data-active={step.id}>
      <ol className="lt-steps">
        {STEPS.map((s, i) => (
          <li
            key={s.id}
            ref={(el) => {
              stepRefs.current[i] = el;
            }}
            data-step={i}
            className={`lt-step ${i === active ? 'is-active' : ''}`}
          >
            <button type="button" className="lt-step-btn" aria-current={i === active ? 'step' : undefined} onClick={() => go(i)}>
              <span className="lt-step-n">{num(i)}</span>
              <span className="lt-step-title">{s.title}</span>
            </button>
            <p className="lt-step-body">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="lt-sticky">
        <Window title={`Sequence · ${step.window}`}>
          {STEPS.map((s, i) => (
            <div key={s.id} className={`lt-layer ${i === active ? 'is-active' : ''}`} aria-hidden={i === active ? undefined : true}>
              <Clip
                id={s.id}
                alt={`${s.title} Recorded in the app.`}
                load={near && Math.abs(i - active) <= 1}
                play={i === active}
                preload={i === active ? 'auto' : 'metadata'}
                rewindWhenHidden
                poster={i <= reached}
              />
            </div>
          ))}
        </Window>
        <p className="lt-caption" aria-live="polite">
          <span className="lt-step-n">{num(active)}</span> {step.title} Recorded in the app.
        </p>
      </div>
    </div>
  );
}

function StackedSteps() {
  return (
    <ol className="lt-steps-stacked" data-testid="how-stacked">
      {STEPS.map((s, i) => (
        <li key={s.id}>
          <Reveal>
            <p className="lt-step-n">{num(i)}</p>
            <h3 className="lt-h3 mt-3">{s.title}</h3>
            <p className="lt-body mt-2">{s.body}</p>
            <Window title={`Sequence · ${s.window}`} className="mt-5">
              <Clip id={s.id} alt={`${s.title} Recorded in the app.`} />
            </Window>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}
