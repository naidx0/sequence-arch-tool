import { Reveal } from '@/components/lt/hooks';
import { MiniMap } from '@/components/lt/MiniMap';
import { Clip, Window } from '@/components/lt/Window';

/**
 * MAP ANY PROJECT, NOT ONLY CODE (owner, 2026-10-10: "it's not always a code
 * base… draw like an architecture design for research. Imagine a research
 * loop"; second tour: "let them move with this map and kind of create it on
 * their own"). The research-whiteboard recording: a research loop drawn on
 * the whiteboard, one box moved by hand. Under it, the same loop as a tiny
 * map the visitor can drag, rename, add to and connect, on the page only.
 */
export function Anything() {
  return (
    <section id="anything" className="lt-adv lt-band" aria-labelledby="anything-title">
      <div className="lt-wrap-wide">
        <Reveal className="lt-adv-head">
          <p className="lt-kicker">Map any project</p>
          <h2 id="anything-title" className="lt-h2">
            Not only code.
          </h2>
          <p className="lt-lede lt-adv-line">
            Sketch a research loop, a pipeline or a plan on the whiteboard, or describe it and let the agent draw it. Then
            ask about any box, the same way you ask about a service.
          </p>
        </Reveal>
        <Reveal className="lt-adv-clip" delay={80}>
          <Window title="Sequence · Whiteboard">
            <Clip id="research-whiteboard" alt="A research loop drawn on the whiteboard: question, literature search, hypothesis, experiment, analysis and write-up, with one box moved by hand. Recorded in the app; the drawing stream is a sample." />
          </Window>
          <p className="lt-board-cap">Anything drawn stays a sketch until code backs it, and every box can be asked about.</p>
        </Reveal>
        <div id="try-map" className="lt-mini-wrap">
          <p className="lt-mini-title">Try it here: move the loop, add a step, connect two.</p>
          <MiniMap />
        </div>
      </div>
    </section>
  );
}
