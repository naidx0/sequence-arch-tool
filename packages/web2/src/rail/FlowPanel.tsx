/* ══════════════════════════════════════════════════════════════════════════
   THE FLOW — items 4.2 and 4.5
   packages/web2/src/rail/FlowPanel.tsx

   Sheet 11.6, "What a click does": "Clicking a function row is the rail's whole
   purpose. The canvas re-sorts around that function's own service and then plays
   the flow… The accent on the row and the accent on the played edge are the same
   claim in two places: this is the thing you asked for. That is why the trace
   card below the row is never accent-tinted — two accent marks for one fact read
   as two facts." Nothing in this file is tinted.

   ITEM 4.5 IS A SUBTRACTION AND IT IS ENFORCED BY A TEST ON THE COUNT: "Flow
   playback reduced to play/pause, scrub, and the current hop's evidence ref. Not
   six controls plus a packet strip plus a detail line." The strip below holds
   exactly one button, one range and one line of text. `Clear` is deliberately
   OUTSIDE the strip — it ends the flow rather than driving it, and counting it
   as a playback control is how a three-control strip becomes a four-control one.

   THE RAIL DOES NOT OWN THE PLAYBACK. `canvas.view` holds S3 (`state/types.ts`
   models it as `{state:'S3'; playback: FlowPlayback}`), so the strip is driven
   from the `playback` prop and every change goes back out through
   `onPlaybackChange`. A second cursor held here would be the canvas and the rail
   disagreeing about which hop is lit — which is precisely the "one accent mark
   for one fact" rule, expressed as state.
   ══════════════════════════════════════════════════════════════════════════ */

import type { GetArchGraphResponse } from '@sequence/api-types';

import type { FlowPlayback, NodeId } from '../state/types';

import { RailIcon } from './RailIcon';
import { evidenceRef, type FlowTrace } from './railModel';

type ScannedGraph = GetArchGraphResponse;

export interface FlowPanelProps {
  /** What the last function click listed. `null` when the rail listed nothing. */
  trace: FlowTrace | null;
  /** The canvas's playback, when the canvas is in S3. */
  playback: FlowPlayback | null;
  graph: ScannedGraph;
  onPlaybackChange: (next: FlowPlayback) => void;
  onClear: () => void;
}

export function FlowPanel({ trace, playback, graph, onPlaybackChange, onClear }: FlowPanelProps) {
  const labelOf = (id: NodeId): string =>
    graph.nodes.find((n) => n.id === id)?.label ?? id;

  const hops = playback?.hops ?? trace?.hops ?? [];
  const cursor = playback ? Math.min(Math.max(playback.cursor, 0), hops.length - 1) : -1;
  const current = cursor >= 0 ? hops[cursor] : null;

  return (
    <section className="rail-flow" data-testid="rail-flow" aria-label="Flow">
      <div className="rail-flow-hd">
        {/*
          A HEADING IS A CLAIM, AND THIS ONE IS NOW TRUE — item playback.

          It read "Plays on board" once and was retreated to "Traced path"
          because it was not: `playback` was a `useState` in ConnectedIndexRail,
          ConnectedBoard owned its view in a private reducer and took no props,
          and the Waves 4/5 gate clicked a traced function in the shipped bundle
          and watched no board node change class, selection or camera.

          What changed, and each half is what the sentence needs:
            · `canvas/canvasChannel.tsx` holds ONE CanvasSlice above both
              surfaces, so a click here writes `canvas.view` S3 and the board
              reads it;
            · `canvas/flowFocus.ts` resolves each hop onto the nodes the board
              is actually drawing, so the current hop's card is selected and the
              camera is dispatched to it — and where the scan traced a hop below
              the board's level, the board SAYS so instead of sitting still;
            · that channel also runs the hop clock. Before it, nothing in this
              package advanced the cursor, so `playing: true` meant a button had
              been pressed and nothing else.
          `e2e/flow-plays.mjs` is the lock, in a real browser, over this bundle.
        */}
        <span className="rail-flow-t" data-testid="rail-flow-title">
          Plays on board
        </span>
        <button
          type="button"
          className="rail-iconbtn"
          data-testid="rail-clear"
          aria-label="Clear the flow"
          onClick={onClear}
        >
          <RailIcon name="x" />
        </button>
      </div>

      {trace ? (
        <ol className="rail-hops">
          {trace.hops.map((hop, i) => (
            <li
              key={`${hop.from}>${hop.to}`}
              className="rail-hop"
              data-testid="rail-hop"
              data-playing={i === cursor ? 'true' : undefined}
              /* STATE, NOT DECORATION — the hop's real endpoint ids, which the
                 row otherwise renders only as labels. The board resolves these
                 same two ids onto the cards it draws, so an e2e can hold the
                 rail's claim and the board's answer against each other rather
                 than against a label that two nodes can share. */
              data-from={hop.from}
              data-to={hop.to}
            >
              <span className="rail-hop-ends">
                <span className="rail-hop-end" data-testid="rail-hop-from">
                  {labelOf(hop.from)}
                </span>
                <RailIcon name="arrowright" size={12} />
                <span className="rail-hop-end" data-testid="rail-hop-to">
                  {labelOf(hop.to)}
                </span>
              </span>
              {/*
                THE ONE SENTENCE, ON EVERY HOP, WITHOUT A BRANCH AT THIS SITE.
                `evidenceRef` returns either a real `file:line` or the honest
                empty case; the row does not decide which, so there is no place
                here for a second wording to appear.
              */}
              <span
                className="rail-hop-ref mono"
                data-testid="rail-hop-ref"
                data-unknown={hop.evidence === null ? 'true' : undefined}
              >
                <bdi>{evidenceRef(hop.evidence)}</bdi>
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {playback && hops.length > 0 ? (
        <div className="rail-strip" data-testid="rail-strip">
          <button
            type="button"
            className="rail-iconbtn"
            data-testid="rail-strip-play"
            aria-label={playback.playing ? 'Pause the flow' : 'Play the flow'}
            aria-pressed={playback.playing}
            onClick={() => onPlaybackChange({ ...playback, playing: !playback.playing })}
          >
            <RailIcon name={playback.playing ? 'pause' : 'play'} />
          </button>

          {/*
            A RANGE, NOT A ROW OF STEP CHIPS. The chips are what item 4.5 calls
            "a packet strip": one control per hop turns a fourteen-hop flow (the
            longest this repository produces, `analyzer/src/cli.ts#main`) into
            fourteen controls. Scrubbing PAUSES, because moving the playhead by
            hand and then having it run away from you is the interaction being
            fought rather than driven.
          */}
          <input
            type="range"
            className="rail-scrub"
            data-testid="rail-scrub"
            aria-label="Scrub the flow"
            min={0}
            max={hops.length - 1}
            step={1}
            value={cursor < 0 ? 0 : cursor}
            onChange={(event) =>
              onPlaybackChange({
                ...playback,
                cursor: Number(event.currentTarget.value),
                playing: false,
              })
            }
          />

          <span
            className="rail-strip-ref mono"
            data-testid="rail-strip-ref"
            data-unknown={current && current.evidence === null ? 'true' : undefined}
          >
            <bdi>{evidenceRef(current?.evidence ?? null)}</bdi>
          </span>
        </div>
      ) : null}
    </section>
  );
}
