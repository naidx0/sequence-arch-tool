import { SURFACES } from '@/data/content';
import { SurfacesDemo } from '@/components/DemoStages';

export function Surfaces() {
  return (
    <section id="surfaces" className="tile-tight atmosphere-silver" aria-labelledby="surfaces-title">
      <div className="tile-wide">
        <div className="grid items-end gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="eyebrow">One harness</p>
            <h2 id="surfaces-title" className="display-sm">
              Your agent talks to every surface.
            </h2>
            {/* Owner, 2026-09-19: "have your agent talk to every single
                surface within the application." Seven panes was a count;
                what makes it worth anything is that ONE agent reaches all
                of them, and can see what you left on them. */}
            <p className="lede mt-3">
              Chat stays on the left and drives the rest: Architecture, Files, Whiteboard, AI Canvas, Agents,
              Terminal and Browser. The same agent draws on the canvas, reads what you drew there, opens a file, runs a command
              and checks the page — without leaving the window or losing the graph.
            </p>
          </div>
          <SurfacesDemo />
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SURFACES.map((s, i) => (
            <article key={s.id} className="store-card p-5">
              <div className="relative z-[1] mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-[11px] font-semibold ring-1 ring-black/5">
                {String(i + 1).padStart(2, '0')}
              </div>
              <h3 className="relative z-[1] text-[18px] font-semibold tracking-tight">{s.name}</h3>
              <p className="relative z-[1] mt-2 text-[13px] leading-snug text-[color:var(--ink-muted)]">{s.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
