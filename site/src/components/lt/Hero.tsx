import { useEffect, useMemo, useRef, useState } from 'react';
import { siGo, siJavascript, siNginx, siOpenjdk, siPostgresql, siPython, siRedis, siTypescript } from 'simple-icons';
import { useDialogDismiss } from '@/components/lt/useDialogDismiss';
import { Clip, Window } from '@/components/lt/Window';
import { AppleGlyph, WindowsGlyph } from '@/components/OsIcons';
import { siLinux } from 'simple-icons';
import { INSTALLERS, NEXT_VERSION, detectInstallerId, installerHref } from '@/data/release';

/**
 * THE OPENING, MACBOOK-STYLE: one line of big type, two pills, and the product
 * large and centred. The window rises in once on load (transform and opacity
 * only). Owner, 2026-10-10: "the demo's long", so the hero plays a 15 s cut
 * of the best moments; a frosted pill over the product opens the 98.7 s full
 * tour, fetched only then, in a centred lightbox that locks the page behind it.
 */
function LinuxGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={siLinux.path} fill="currentColor" />
    </svg>
  );
}
export function Hero() {
  const primary = useMemo(() => {
    const id = detectInstallerId();
    return INSTALLERS.find((i) => i.id === id) ?? INSTALLERS[0]!;
  }, []);
  const Glyph = primary.id === 'windows' ? WindowsGlyph : primary.id === 'linux' ? LinuxGlyph : AppleGlyph;

  return (
    <section id="overview" aria-labelledby="hero-title" className="lt-hero">
      <div className="lt-wrap text-center lt-rise">
        <p className="lt-kicker">Sequence {NEXT_VERSION}</p>
        <h1 id="hero-title" className="lt-h1 mx-auto max-w-[16ch]">
          All your favorite harness pieces in one app.
        </h1>
        <p className="lt-lede mx-auto mt-6 max-w-[34rem]">
          Pick any model and any agent, draw next to your code, and hand off long tasks. It runs on your computer.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a href={primary.ready ? installerHref(primary) : '#download'} className="lt-btn lt-btn-blue">
            <Glyph className="h-4 w-4" />
            Download for {primary.short}
          </a>
          <a href="#choose" className="lt-btn lt-btn-glass">
            See what is inside
          </a>
        </div>
      </div>

      <div className="lt-wrap-wide mt-[clamp(2.75rem,5vw,4rem)]">
        <div className="lt-hero-shot lt-rise lt-rise-2">
          <Window title="Sequence" className="lt-window-big" over={<FullTour />}>
            <Clip
              id="tour"
              eager
              alt={`A 22 second cut of Sequence ${NEXT_VERSION}: asking about the architecture, the surfaces, the sidebar and the board, recorded in the app on a sample project with a stand-in model.`}
            />
          </Window>
        </div>
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
  /* The page behind the tour does not scroll while it is open. */
  useEffect(() => {
    document.documentElement.classList.toggle('lt-locked', open);
    return () => document.documentElement.classList.remove('lt-locked');
  }, [open]);
  const show = () => {
    setOpen(true);
    dlg.current?.showModal();
  };
  const { dismiss: close, bind } = useDialogDismiss(dlg);

  return (
    <>
      <button type="button" className="lt-tour-btn lt-glass" onClick={show}>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
        </svg>
        Watch the full tour <span className="lt-tour-len">0:30</span>
      </button>
      <dialog
        ref={dlg}
        className="lt-lightbox"
        aria-label={`The full tour of Sequence ${NEXT_VERSION}`}
        onClose={() => setOpen(false)}
        {...bind}
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
              src="/demo/v0184/tour-full.mp4"
              poster="/demo/v0184/tour-full.jpg"
              width={1280}
              height={720}
              controls
              autoPlay
              muted
              playsInline
              preload="none"
              aria-label={`The full tour of Sequence ${NEXT_VERSION}, the chat, the surfaces, the sidebar, Settings and the board in walkthrough order.`}
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

/** What the scanner reads: the languages and services of the sample project. */
export function StackRow() {
  return (
    <section aria-label="Languages and services it maps" className="pt-[clamp(3rem,6vw,4.5rem)]">
      <div className="lt-wrap text-center">
        <p className="lt-note">Maps services across languages, databases and queues.</p>
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
