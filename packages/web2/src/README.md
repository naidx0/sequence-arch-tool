# `packages/web2/src` — the directory layout, and what fills each one

Scaffolded by Wave 0 (items 0.1, 0.6). Every directory below is empty on purpose:
the plan's build order names which item fills it, and an empty directory with a
named owner is honest where a stub component is not.

The layout is `docs/research/v2-architecture-and-gaps.md` §4.1. Where
`docs/research/ml-harness-adoption.md` §5 proposes a different name for the same
lane, §4.1 wins, because Wave 2 and Wave 3 items cite §4.1's paths by name
(`state/types.ts` in 2.1, `tokens/graphite.css` in 2.2, `web2/src/canvas/` in
3.2). §5's *rules* are adopted in full; only its path names are not.

| Directory | Fills it | What goes in |
| --- | --- | --- |
| `app/` | 2.3 | `Shell.tsx` — the three-pane frame, two resizers, breakpoints. `App.tsx` holds the one ordered style-import block. `routes.ts` documents that there are no routes. |
| `tokens/` | **done (0.1)**, extended by 2.2 | `graphite.css`. The ONLY file that may declare a colour, radius, type size or spacing value. |
| `styles/` | 2.2 → 3.6 | Per-surface sheets that CONSUME tokens. `base.css` and `boot.css` exist; `shell.css` and `board.css` arrive with their waves. |
| `state/` | 2.1 | `types.ts` is authored and frozen **with no implementation** before any surface is built — it is the contract every parallel builder codes against. `store.ts` follows, target under 600 lines. |
| `api/` | 2.4, and 1.x for the routes | The transport seam. `client.ts`, `errors.ts`, `events.ts` (the SSE reader), `types.ts`. **Never imports React.** |
| `model/` | 3.2 | The pure salvage lane. Zero React, zero fetch — the fold from events to transcript items, and the graph maths. This is where the 197 inherited React-free modules land. |
| `chat/` | 2.5, 2.6 | Transcript, rows, coverage chip, proposal card. |
| `composer/` | 2.7, 2.8 | Composer, context chips, the `+` menu, permissions control. |
| `canvas/` | 3.2 – 3.8 | The board. `@xyflow/react` and `elkjs` are used **here and nowhere else**, elkjs behind a dynamic import inside the worker. |
| `rail/` | Wave 4 | The functions rail. |
| `review/` | Wave 5 | The diff inspector. |
| `components/` | 2.5 onward | Shared atoms only — the ~10 primitives and one `Icon` set. Flat until it is genuinely too big to be. |

## The three rules that hold across all of them

1. **`api/` never imports React; the surface directories never call `fetch`.**
   Components receive callbacks threaded from the shell. Every component is then
   testable with props alone, and the transport is swappable when Sequence ships
   packaged.
2. **The UI never computes what the analyzer decides.** Sequence's grounding
   claim *is* this rule. The moment a file here ranks, scores or infers a graph
   fact, "we read a graph instead of guessing" stops being true of the client.
3. **A route that does not exist throws, naming where it was specified**, and
   the surface prints **no** number rather than a plausible one.

## What may not cross the line

Nothing here imports from `packages/web`, and nothing copies a class name, a
layout or an output format from it. `packages/web` was **deleted** on 2026-08-20
(`20d1424`) — the cutover was pulled forward rather than held to Wave 7 — so the
import is now impossible as well as forbidden. `test/firewall.test.ts` stays, and
still earns its place: it also forbids `.arch-rf-` / `.product-` class names,
which a person can reintroduce by hand from git history at any time.
