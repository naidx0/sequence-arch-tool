# The drawing surface: what to take from tldraw, and the language question

**End state, one sentence:** a person and an agent draw on the same canvas in the same
material — a flow is a few plain text lines the model writes and a person can read and edit,
the renderer turns those lines into a laid-out, grounded, animated diagram, every part of it
is an object either side can point at, move, rename or question, and the whole thing stands
on its own (export, embed, share) without anyone learning a term like "code visualization".

Owner, 2026-09-22: "think about TL draw … how in depth it really works … make communication
between agents and humans very effortless in this drawing environment … is there a new
language we should invent? … simple, fast, token efficient, easily understandable for humans,
not constricted to one little file map … a standalone element … propose changes simply".

Two researchers read the sources (tldraw's SDK, agent starter kit, MCP app, fairies; D2,
Mermaid, Structurizr, Excalidraw, Motion Canvas, SVG/SMIL, the 2025–26 text-to-diagram
benchmarks). Their findings with URLs are in this session's record; the rulings below are mine.

## Ruling 1: no new language. A thin line syntax, and the renderer owns the motion.

Measured on the same six-part, seven-hop flow (about 4 chars per token):

| what the model writes | tokens | what a 7B model gets wrong |
|---|---|---|
| our chart JSON today (items + links + steps) | 291 | invented ids; every hop written twice (links and steps) |
| Mermaid flowchart | 58 (81 animated) | `(`, `:` and the word `end` inside labels; no steps, no narration |
| D2 | 60 (+88 for steps) | steps restate every edge; no narration slot; no grounding; no benchmark |
| SVG + SMIL | ~550 | coordinates, path strings, `begin=` chains — spatial work models fail at |
| Motion Canvas / Remotion | ~360 | TSX + generators; 41–65% execution at 7B on the nearest benchmark |
| **flow lines (below)** | **137 with narration and paths; 57 structure only** | a bad line fails alone and is dropped or re-asked |

The benchmarks say two things that settle it: DSL syntax errors do not shrink with model scale
(OmniDiagram, PlantUML 83 vs Mermaid 52 at 3B and 7B alike), and models fail at coordinates
(SketchAgent built a grid language for exactly that reason). So: never make the model place
anything, never ask it for motion, and give it the surface syntax it already knows — an edge
line. A genuinely new language has zero training data and would need long few-shot prompts
for a model that already writes `a -> b: label` on its own.

**Flow lines.** One line per part or hop. A strict subset of D2/Mermaid edge syntax:

```
ui "Search page" = web/src/pages/search.tsx
api "API" = app/api
ui -> api: the query | The page sends what was typed to the server
api -> engine: a prompt | The server turns it into a prompt and hands it to the engine
engine -> model: tokens | The engine streams the prompt to the local model
```

- `id "Label" = path` declares a part; `= path` grounds it to a scanned file, module or
  service (snapped to the nearest real id; a part with no path is a concept and draws as one).
- `a -> b: what moves | one plain sentence` is a hop. **Edge order is step order** — no second
  list. Everything after `|` is the narration the stepper reads out.
- Mermaid's `A -->|x| B` lines are accepted too, because models emit them anyway.
- Compiles to the chart JSON we have (`items`, `links`, `steps`), so grounding, the
  scanned-edge check, the stepper, and every test we wrote today stay. JSON with Ollama's
  `format` schema stays as the fallback when lines do not parse.
- Exports to D2 and Mermaid text, SVG, PNG and a GIF of the steps, so it lives outside
  Sequence as a file a person can edit.

**Motion belongs to the renderer.** The five things motion can say to a reader who knows
nothing, and where each comes from:

| primitive | says | who provides it |
|---|---|---|
| reveal in order | this happens first | the stepper (have) |
| travel along an edge | data moves from here to there | a token that runs the active edge (build) |
| highlight the current part | look here now | the stepper (have) |
| expand a part into its children | what is inside | the interior roll-up on a grounded part (build) |
| before / after morph | what changed | two flows and a diff of their lines (later) |

The model writes what happens and in what order. Nothing it writes decides how it moves.

## Ruling 2: take tldraw's shared-space feel, leave its free placement.

Where tldraw is ahead of us and why: its canvas is one store of typed records, both sides
edit the same objects, actions land one by one as they stream, the agent reads the person's
selection and a compact description of the shapes in view, lints come back to the model as
corrections, and one agent turn is one undo step. Where we are ahead: ELK lays out (tldraw's
own engineer calls layout "one of the really hard questions" and the kit works around it with
align/stack actions and lints), the scan validates every link (tldraw has nothing like it),
and steps with a stepper are a real timeline (tldraw has `animateShape`, no timeline).

Our blocks are the gap: markdown, mermaid, svg, html and react blocks are sealed boxes. The
model cannot address a part inside one, a person cannot edit what the agent drew as an object,
and nothing appears while it streams. "One little file map" is the feeling of an opaque block.

## Slices, in dependency order

### 1 — Flow lines in, chart JSON out (engine)
`propose_chart` (and the forced round, the teach floor, `trace_flow`'s skeleton) accept a
`lines` string beside `items/links/steps`; a line parser with per-line errors ("line 4: no
`->`"; dropped and named, like a bad link today); grounding snap on `= path`; the hint shows
lines first and JSON second. Gate: a fixture corpus of 40 flows in lines, Mermaid-edge and
JSON forms parses to the same JSON; the live battery's teach and draw cases report chars per
landed drawing (target: under half of today's JSON) and zero parse-dropped lines per run.

### 2 — Motion the renderer owns (client)
A token that travels the active edge on Play; reveal-in-order mode (parts appear as the step
reaches them); expand a grounded part into its children as a sub-flow from the interior
roll-up. Gate: chart tests with fake timers; reduced-motion honoured; a screenshot per state.

### 3 — Parts are objects (client + engine)
Every part and hop of a flow is selectable: rename, delete, reorder a hop, add a hop by
drawing an arrow between two parts. Each edit rewrites the lines and lands in the chat as a
chip ("you added ui -> cache"); an added hop the scan does not have is marked as a question
("the scan has no edge here — ask?") rather than refused. One agent turn is one undo step.
Gate: the lines round-trip through every edit; undo restores the turn's whole drawing.

### 4 — Selection is context (client)
Lasso parts on the AI canvas or nodes on the board and their ids plus scan facts attach to
the next turn as chips (the V3 chip surface exists and is undrawn). The turn's prompt carries
a compact description of what is on the canvas — id, label, bounds, grounded path — with
off-screen parts as a count, the way tldraw's kit does; a screenshot only when the model can
see. Gate: a turn with a selection names the selected parts in its tool calls.

### 5 — Streamed landing (engine + client)
Parts and hops appear as the tool's arguments stream, one line at a time, instead of the
whole chart at the end. Depends on the provider streaming tool arguments; measure Ollama
first. Gate: the first part is on the canvas before the tool call completes.

### 6 — Lints back to the model (engine + client)
Overlapping or clipped labels, a part with no hop, a hop with no narration, a grounded part
whose path moved — reported to the model as corrections it can act on, the way the grounding
refusal already is, and shown to the person as a small mark on the part. Gate: a planted
overlap produces the lint and the model's next call fixes it in the battery.

### 7 — Standalone (export)
Save a flow as `.flow` lines beside the plan document; export D2, Mermaid, SVG, PNG and a
GIF of the steps; open a `.flow` file from the Files rail onto the canvas. Gate: a round trip
lines → export → lines is byte-equal.

## The edge (out)

- A free-placement canvas where the model writes coordinates.
- Letting the model run JavaScript against the canvas (tldraw's `exec`); motion is ours.
- A language with syntax the model has never seen.
- Multiplayer sync; comments threads on parts (a chip to the chat is the comment).

## First shippable slice

Slice 1, after the teaching-flow slices now in flight land: it reuses today's chart JSON,
stepper and grounding unchanged, and it is where the token and legibility win is measured.
