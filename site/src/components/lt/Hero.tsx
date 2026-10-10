import { useMemo, useRef, useState } from 'react';
import { siGo, siJavascript, siNginx, siOpenjdk, siPostgresql, siPython, siRedis, siTypescript } from 'simple-icons';
import { Clip, Window } from '@/components/lt/Window';
import { AppleGlyph, WindowsGlyph } from '@/components/OsIcons';
import { SAMPLE_NOTE } from '@/data/content';
import { INSTALLERS, NEXT_VERSION, detectInstallerId } from '@/data/release';

/**
 * THE OPENING, MACBOOK-STYLE: one line of big type, two pills, and the product
 * large and centred. The window rises in once on load (transform and opacity
 * only); the 34 s tour cut plays inside it. A frosted pill over the product
 * opens the full 110 s tour, which is fetched only then.
 */
export function Hero() {
  const primary = useMemo(() => {
    const id = detectInstallerId();
    return INSTALLERS.find((i) => i.id === id) ?? INSTALLERS[0]!;
  }, []);
  const Glyph = primary.id === 'windows' ? WindowsGlyph : AppleGlyph;

  return (
    <section id="overview" aria-labelledby="hero-title" className="lt-hero">
      <div className="lt-wrap text-center lt-rise">
        <p className="lt-kicker">Sequence {NEXT_VERSION}</p>
        <h1 id="hero-title" className="lt-h1 mx-auto max-w-[14ch]">
          Your architecture, mapped from code.
        </h1>
        <p className="lt-lede mx-auto mt-6 max-w-[34rem]">
          A desktop app that maps a repository, draws beside the map, and answers from both.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a href="#download" className="lt-btn lt-btn-blue">
            <Glyph className="h-4 w-4" />
            Download for {primary.os.split(' · ')[0]}
          </a>
          <a href="#grounded" className="lt-btn lt-btn-glass">
            Take a look
          </a>
        </div>
      </div>

      <div className="lt-wrap-wide mt-[clamp(2.75rem,5vw,4rem)]">
        <div className="lt-hero-shot lt-rise lt-rise-2">
          <Window title="Sequence · shopfront" className="lt-window-big" over={<FullTour />}>
            <Clip
              id="tour"
              eager
              alt={`A 34 second tour of Sequence ${NEXT_VERSION}: ten parts of the app, from the architecture map and workspaces to the terminal, agents and rewind.`}
            />
          </Window>
        </div>
        <p className="lt-note mt-5 text-center">The tour, recorded in the app. {SAMPLE_NOTE}</p>
      </div>
    </section>
  );
}

/**
 * The full tour on request: the <video> is created when the dialog opens and
 * torn down when it closes. A native <dialog> sits in the top layer, so
 * opening it moves nothing on the page.
 */
function FullTour() {
  const dlg = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const show = () => {
    setOpen(true);
    dlg.current?.showModal();
  };
  const close = () => dlg.current?.close();

  return (
    <>
      <button type="button" className="lt-tour-btn lt-glass" onClick={show}>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
        </svg>
        Watch the full tour <span className="lt-tour-len">1:50</span>
      </button>
      <dialog
        ref={dlg}
        className="lt-lightbox"
        aria-label={`The full tour of Sequence ${NEXT_VERSION}`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="lt-lightbox-bar">
          <span className="text-[13px] font-medium">Sequence {NEXT_VERSION}: the full tour</span>
          <button type="button" className="lt-btn lt-btn-glass !min-h-[30px] !px-3 !text-[13px]" onClick={close}>
            Close
          </button>
        </div>
        <div className="lt-lightbox-media">
          {open ? (
            <video
              src="/demo/v014/tour-full.mp4"
              poster="/demo/v014/tour-full.jpg"
              width={1920}
              height={1080}
              controls
              autoPlay
              muted
              playsInline
              preload="none"
              aria-label={`The full tour of Sequence ${NEXT_VERSION}, all eleven clips in walkthrough order.`}
            />
          ) : null}
        </div>
      </dialog>
    </>
  );
}

const STACK = [
  { icon: siTypescript, name: 'TypeScript' },
  { icon: siPython, name: 'Python' },
  { icon: siJavascript, name: 'JavaScript' },
  { icon: siGo, name: 'Go' },
  { icon: siOpenjdk, name: 'Java' },
  { icon: siNginx, name: 'nginx' },
  { icon: siPostgresql, name: 'Postgres' },
  { icon: siRedis, name: 'Redis' },
] as const;

/** What the recordings were made on. */
export function StackRow() {
  return (
    <section aria-label="The repository in the recordings" className="pt-[clamp(3rem,6vw,4.5rem)]">
      <div className="lt-wrap text-center">
        <p className="lt-note">
          Recorded on a sample shop: eight services in six languages, a database, a cache and a topic, mapped from
          source.
        </p>
        <ul className="lt-logos mt-6 list-none p-0">
          {STACK.map(({ icon, name }) => (
            <li key={name}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={icon.path} fill="currentColor" />
              </svg>
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
