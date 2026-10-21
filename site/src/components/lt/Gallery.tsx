import { useRef } from 'react';
import { Clip, Window } from '@/components/lt/Window';
import { Reveal } from '@/components/lt/hooks';
import { FEATURES_014 } from '@/data/content';

/**
 * TAKE A CLOSER LOOK (MacBook's gallery): three clips not used above, one
 * card each, in a row that scrolls sideways and snaps. Each clip plays only
 * while its card is on screen. Bodies come from FEATURES_014. Owner,
 * 2026-10-10: no terminal or reasoning clips here; the chat drawings are
 * "the best inline experience". Second tour: the files card was weaker than
 * the drawings one, so it plays files-look, a cut of the same files recording
 * that holds on the rendered guide (the tree with its status colours, the
 * Markdown and its diagram), eases in on the diagram, then shows the code
 * view it came from.
 */
const IDS = ['chat-drawings', 'files', 'rewind'] as const;
const WINDOW: Record<(typeof IDS)[number], string> = {
  files: 'Files · docs/guide.md',
  'chat-drawings': 'Chat',
  rewind: 'Edit from here',
};
const TITLE: Partial<Record<(typeof IDS)[number], string>> = {
  'chat-drawings': 'Inline drawings and charts, right in the chat.',
};
/* The recording each card plays, where it is not the feature's own id. */
const CLIP: Partial<Record<(typeof IDS)[number], string>> = {
  files: 'files-look',
};
const ITEMS = IDS.map((id) => {
  const f = FEATURES_014.find((x) => x.id === id)!;
  return { ...f, title: TITLE[id] ?? f.title };
});

export function Gallery() {
  const row = useRef<HTMLUListElement>(null);
  const nudge = (dir: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const card = el.querySelector('li');
    el.scrollBy({ left: dir * ((card?.clientWidth ?? 600) + 24), behavior: 'smooth' });
  };

  return (
    <section id="closer-look" className="lt-chapter" aria-labelledby="look-title">
      <div className="lt-wrap-wide">
        <Reveal className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[40rem]">
            <p className="lt-kicker">Also in the window</p>
            <h2 id="look-title" className="lt-display">
              Take a closer look.
            </h2>
          </div>
          <div className="flex gap-2" aria-label="Scroll the gallery">
            <button type="button" className="lt-round lt-glass" onClick={() => nudge(-1)} aria-label="Previous">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="lt-round lt-glass" onClick={() => nudge(1)} aria-label="Next">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </Reveal>
      </div>
      <ul ref={row} className="lt-gallery" data-testid="gallery">
        {ITEMS.map((f) => (
          <li key={f.id}>
            <Window title={WINDOW[f.id as (typeof IDS)[number]]}>
              <Clip id={CLIP[f.id as (typeof IDS)[number]] ?? f.id} alt={`${f.title} Recorded in the app.`} />
            </Window>
            <h3 className="mt-5 text-[19px] font-semibold tracking-tight">{f.title}</h3>
            <p className="lt-body mt-1.5 max-w-[34rem] !text-[14.5px]">{f.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
