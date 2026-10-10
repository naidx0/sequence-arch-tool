import { BrandMark } from '@/components/BrandMark';
import { DemoVideo } from '@/components/DemoVideo';
import { NEXT_VERSION } from '@/data/release';

export function Hero() {
  return (
    <section id="overview" className="atmosphere-silver tile-tight" aria-labelledby="hero-title">
      <div className="tile-wide text-center">
        <div className="mx-auto flex max-w-3xl flex-col items-center">
          <span className="glass-chip mb-4 grid h-12 w-12 place-items-center rounded-[18px]">
            <BrandMark className="h-7 w-7 text-[color:var(--ink)]" title="Sequence" />
          </span>
          <p className="eyebrow">Version {NEXT_VERSION} · Workspaces · Whiteboard · Agents</p>
          <h1 id="hero-title" className="display mx-auto max-w-[16ch] text-[color:var(--ink)]">
            Architecture you can draw on, and prove.
          </h1>
          <p className="lede mx-auto mt-3 text-balance">
            Sequence maps your code, lets you draw beside the map, and answers from both. Point at any box and ask
            about it. Every solid edge still has a file and a line.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <a href="#download" className="pill-cta">
              Download
            </a>
            <a href="#whats-new" className="pill-ghost">
              What is new in {NEXT_VERSION}
            </a>
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-[1100px]">
          <DemoVideo
            id="tour"
            eager
            alt={`A tour of Sequence ${NEXT_VERSION}: workspaces, the architecture map, the whiteboard, files, agents and the terminal.`}
            className="shadow-[0_28px_80px_rgba(0,0,0,0.14)]"
          />
          <p className="mt-3 text-[13px] text-[color:var(--ink-muted)]">
            The real app, recorded. Click the video for controls.
          </p>
          <p className="mt-1 text-[13px] text-[color:var(--ink-muted)]">
            Clips use a sample shop repository; the app and scan are real, model answers are sample replies.
          </p>
        </div>
      </div>
    </section>
  );
}
