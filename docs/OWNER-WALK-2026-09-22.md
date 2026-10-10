# Owner walk, 2026-09-22 — the harness is built of walls

Max's thesis, in his words:

> "too many guardrails and parameters around these dumb models because these
> dumb models can't think around parameters, they run into walls. When they run
> into these walls, they kind of stop, they freeze up, they stop responding,
> they cancel processes … We kind of need them to work, think, collaborate,
> build."

This is the diagnosis of everything he reported in this walk, measured from
the session record (`Bastion/.sequence/sessions/session-7851/chat.json`), the
model itself, and the running engine. **Every finding below is one wall.**

The model is `minicpm5-hermes:latest` — 2.5B parameters, Q8, llama family,
`num_ctx` 65,536. It is a **thinking model**: every reply carries a separate
`reasoning` field beside `content`.

---

## 1. Photo 3, dissected turn by turn

Turn 17 of the session, "on the arch board I want to add a new program …":

| # | what the model did | what the harness did |
| --- | --- | --- |
| 1 | `propose_topology`, an edge with no `id` | **refused the whole proposal**: `edge needs "id", "from" and "to"` |
| 2 | `propose_topology`, edge family `db_read` | **refused the whole proposal**: `family "db_read" — expected one of http, grpc, queue, db, import, call, control` |
| 3 | `propose_topology` again | accepted: 1 node, 1 edge — the board shows "local workspace harness" |
| 4 | prose ending in a fence whose label sat on the wrong line | leaked into the transcript as `sequence-tool )` |
| 5 | `**Proposing a new \`svc:local-harness\` …**` | rendered with the asterisks showing |

**Why `db_read`?** Because that is what the digest calls it. The model is shown
the repository's edges as `e1:db_read`, and the tool then refuses the word the
repository taught it. The vocabulary we show and the vocabulary we accept
disagree, and the model is the one that pays.

**Why the stray fence?** The forced-draw round (below) tells the model:
`Reply with EXACTLY ONE ```sequence-tool fence`. A 2.5B model trying hard to
obey wrote the fence with its label on the next line, which the stripper does
not recognise, so the fragment was printed.

It took three calls and two refusals to place one box. Each refusal is a wall.

## 2. The empty turns

Turns 5 and 11 are **empty** — no text, no usage recorded. Turn 11 happened at
18:28 UTC, *after* yesterday's clamp fix was running. It was not idle: 10 work
rows, 5 files read by the pre-research step, then nothing.

Measured against the model directly, with the same `reasoning_effort` his
profile sends (`medium`):

| effort | content | reasoning |
| --- | --- | --- |
| (none sent) | 117 chars | 272 chars |
| medium | 126 chars | 383 chars |
| none | 161 chars | 0 chars |

The model thinks on every turn. On a long, hard prompt a thinking model can
spend its whole output on reasoning and emit no content. The provider captures
that reasoning — `provider.ts` reads `delta.reasoning ?? delta.reasoning_content`
into `reasoningOut` and fires `onReasoning` — and then **nothing listens**:
`onReasoning` has no caller anywhere outside `provider.ts`, and the stream has
no reasoning event. So a turn that only thought reads as a turn that did
nothing, and the model's actual thinking is thrown away.

## 3. "I like seeing the thinking behind the agent"

Same root cause as §2. The thinking **exists** — hundreds of characters per
turn, "We need to answer … So I need to produce …" — and is discarded one hop
from the screen. The composer shows "Working" because that is all it is sent.

## 4. The forced-draw round is the loudest wall

When a draw-worded question produces no drawing, `askPipeline` forces an extra
provider call with:

```
--- YOU HAVE NOT DRAWN ANYTHING ---
The user asked for something ON the canvas … Prose is not a drawing. Reply with
EXACTLY ONE ```sequence-tool fence calling one canvas.write_* tool … or
propose_topology for architecture … Keep it COMPACT. Do not call read tools.
```

Three faults in one paragraph:

- **It shouts.** Capitals, a banner, "EXACTLY ONE", "Prose is not a drawing".
- **It offers the wrong surface.** "show me on the arch board" is an
  architecture request, but whenever canvas tools are live the demand leads
  with `canvas.write_*`. Photo 1's closing note says it outright: *"I asked the
  model to produce a canvas block twice this turn and it never called a drawing
  tool."* It was asked for the wrong thing twice.
- **It ends with a reprimand.** If the model still does not draw, the turn is
  closed with a paragraph blaming it, appended below whatever it did write.

## 5. The goal is the prompt

`index.json`: the chat's title **and** its goal are both the raw first sentence,
verbatim and misspelled — *"this long running task and goal from earlier make
tand decide on the logic behind this fe…"*. He wants a summary, written by the
model: "dive, explore and explain the Bastion repository with possible
changes". A goal names an outcome; a pasted prompt names nothing.

## 6. The context window "is nowhere to be seen"

The ring is mounted and works; it draws nothing when the window is unknown.
The window is probed **once, at boot** (`connect.tsx`), and otherwise only when
the model is switched. Today the app booted just after Ollama had been
stopped, so the probe failed. The fallback table has no row for
`minicpm5-hermes`, so the ring stayed empty for the whole session — even
though, with Ollama up, the same engine reports `contextWindow: 131072`.

## 7. Bold that contains code

Rendering the exact line from photo 3 through `ProseMessage`: the output keeps
the literal `**`. Inline code is split out first, which leaves the opening and
closing markers in different fragments, so the pair is never matched. Bold
that contains no code works; bold around a code span, which is how a model
writes about identifiers, never does.

## 8. The board furniture at low zoom (photo 2)

The bottom-right cluster — folder, Imports, the layout pair, card detail —
crowds and overlaps. To be measured in the browser, not guessed.

## 9. The two drawing surfaces

His rule, which the prompt and tool descriptions should state plainly:

- **AI Canvas** — free-form. Draw whatever is asked when it has nothing to do
  with the mapped system: a concept, a sketch, a chart, a flow of ideas.
- **Architecture board** — grounded and deterministic. Real services, real
  files, real edges from the scan; proposals land on it as proposals.

## 10. What the instructions weigh

With an empty project, the ask path's standing instructions are ~1,450 tokens,
with 15 absolutes (NOT / NEVER / MUST / ONLY / EXACTLY) and 30 all-caps words.
The tool belt adds 21 definitions, ~3,340 tokens, every call. The largest
descriptions are for tools an ordinary question never touches
(`propose_chart` 995 characters, `write_plan` 714, `update_todos` 562).

---

# The plan

Ordered by how many turns each wall costs him. Each fix carries a locking test,
and the agent-level fixes are measured live with `pnpm agent:live` against the
same model, because that is the only instrument that saw these faults.

1. **Coerce, don't refuse — `propose_topology`.** A missing edge id is
   generated from its endpoints. A family is normalised (`db_read`, `database`
   → `db`; `rest`, `api` → `http`; `publish`, `event` → `queue`; anything else
   defaults to `call`). One bad edge no longer sinks the good ones — it is
   dropped and named. An edge whose endpoints are not real still refuses,
   because that is the grounding, not a formality.
2. **The forced round speaks plainly and asks for the right surface.** A board
   question is asked for `propose_topology`; a canvas question for the canvas.
   No banner, no "EXACTLY ONE", no fence syntax. If it still does not draw, the
   answer stands on its own without a reprimand appended.
3. **Strip malformed tool fences** — the label on the wrong line, the
   half-written fence — so a model's failed attempt never reaches the reader.
4. **Stream the thinking.** A `reasoning` event on the wire, carried from
   `onReasoning`, shown in the thinking block as it arrives. A turn that only
   thought now shows what it thought, instead of an empty bubble.
5. **The goal is a summary.** Titled by the model from the request — a short
   outcome, not the pasted sentence. Falls back to a trimmed first clause only
   when no model answers.
6. **The ring re-probes when it does not know.** After any turn completes with
   the window still unknown — a completed turn proves the model is up.
7. **Bold survives code** — the markers are paired before code is split out.
8. **The board furniture at low zoom** — measured, then fixed.
9. **The two surfaces, named in the tool descriptions** as §9 states them.
10. **The belt is trimmed per ask** — tools a plain question cannot use are not
    offered to it.

Then the whole battery again, live, and each photo's prompt run through it.

---

# What shipped against the plan

Each item carries a test built from the reported shape.

| # | fix | where | locked by |
| --- | --- | --- | --- |
| 1 | `propose_topology` repairs spelling and says so in its evidence: a missing edge id is made from the endpoints, `db_read` reads as `db`, `microservice` as `service`, a missing label comes from the id, a repeated node is dropped and named. A node carrying scan evidence and an edge to a node that exists nowhere still refuse. | `askTools.ts` | `propose-topology.test.ts` (8 new cases, both photo-3 refusals) |
| 2 | The forced draw round asks in one plain sentence for the tool that fits the surface named — the board gets `propose_topology`, the canvas a `canvas.write_*`. No banner, no fence syntax. When nothing is drawn, one factual line replaces the three-sentence reprimand. | `askPipeline.ts` (`drawSurfaceFor`, `forcedDrawDemand`) | `ask-tool-loop.test.ts` |
| 3 | A tool fence with its label on the next line, or cut off by the output cap, is parsed or reported, and never printed. | `askTools.ts` (`parseFencedToolRequests`) | `tagged-tool-block.test.ts` (turn 17's exact tail) |
| 4 | The thinking streams: a `reasoning` event on the wire, shown in the sparkle fold while it arrives and kept on the turn as a closed "Thought" fold. A long think counts as progress, so it no longer reads as a stalled provider. | provider → pipeline → route → store → `V3Chat` | `reasoningStream.test.tsx`, `ask-tool-loop.test.ts` |
| 5 | A goal has a name: four to nine words from the model (thinking off, 15 s bound), the title trimmer when no model answers. The goal text stays verbatim. The rail title follows the name while it is still ours, including the Bastion row, whose "edited" title was only the goal's own text. A Plan turn that writes a plan makes the request the goal; merely asking in Plan sets nothing, and a cleared goal stays cleared. The goalbar re-reads after every turn. | `goalName.ts`, `sessionsStore.ts`, `repoServer.ts`, `V3Chat.tsx` | `goal-name.test.ts`, `V3GoalRun.test.tsx` |
| 6 | The context ring re-probes after a turn lands while the window is unknown. There is no published row for MiniCPM, because its variants differ. | `V3Chat.tsx` | `contextRingReprobe.test.tsx` (fails on the old code) |
| 7 | Bold that contains code renders. Code spans are masked before the bold markers are paired. The same change went into both renderers. | `proseBlocks.ts`, `ProseMessage.tsx`, `Transcript.tsx` | `proseBlocks.test.ts` |
| 8 | Measured on this repository at 25%: far labels are counter-scaled to screen size, so "Desktop" and "Gateway" printed as one word. Colliding far labels now yield to the better-connected card (selected always wins, hover restores). At 25%, 3 of 11 yielded and 0 overlaps remain. The furniture wrap keyed on the window, not the board: at 1100 px the board was 338 px and the Kinds pill sat under the toolbar, 11 overlapping pairs. A container query on the board fixed that (the first version lost on specificity), the toolbar no longer shrinks under its buttons, and it wraps its own groups. Result: 0 overlaps, 0 controls off the edge. | `farLabels.ts`, `Board.tsx`, `NodeCard.tsx`, `board.css` | `farLabels.test.ts`, `boardFurnitureContainer.test.ts` |
| 9 | The two surfaces are named where the model reads them: `propose_topology` is "the grounded map of this repository", and every canvas writer opens with "the free-form surface … for anything that is not the mapped architecture". The canvas hint had told the model not to use bold at all; that line is gone. | `askTools.ts` | `two-surfaces.test.ts` |
| 10 | The plain-turn belt went from 10,803 to 9,108 characters (~2,700 to ~2,280 tokens). Five descriptions keep their rules and lose the capitals and the arguments. `propose_plan`, the lesson plan, is now on Teach turns only. | `askTools.ts` | the belt tests |

**Still open, named rather than done.** First, the "ask ONE clarifying question: compact or detailed" hint on `propose_topology` is itself a wall of the kind this walk is about. It came from an earlier ruling and eight test files pin it, so removing it is a decision for him, not a trim. Second, `mayDropReasoning` retries a thought-only turn with thinking off only when no `reasoningEffort` is set, and his profile sends `medium`. His empty turns now show what the model thought. They will not retry.

---

# `/plan` — the planning workflow (owner, 2026-09-22, mid-walk)

> "in default we should be running in slash build, but once people have
> something difficult to do, like in cursor, they can use slash plan to invoke
> a certain set of tools which helps the model create number one a goal, number
> two a to-do list, and number three an in-depth plan … in markdown … diagrams,
> MADR views … flow charts … before and after … expected gains by this much
> percent … not a select guide rail that it has to absolutely follow … this
> guidance framework to just hint at the model."

## What it is

`/plan <task>` switches the composer to Plan and runs one planning turn that
produces three artefacts:

1. **The goal.** Named the same way as §5, and it becomes the session's goal.
2. **The work list.** `write_plan` steps, which are the goalbar's todos. "Work
   on goal" runs them in Build.
3. **The plan document.** Markdown, written to `.sequence/plans/<session>.md`.
   It opens on a **Plan** tab of the AI Canvas, and can also be opened beside
   chat in Files.

## The canvas gets tabs

The AI Canvas becomes a strip of free-form surfaces, like browser tabs:
**Canvas** (today's default) and **Plan**, plus any the person adds. Each tab
is its own block document, so a plan never piles onto the scratch surface. The
plan tab holds:

- the Markdown plan as its spine;
- a **before / after** pair of Mermaid flowcharts, the system loop without the
  change and with it;
- **MADR** blocks (context, options, decision, consequences) for each real
  choice;
- a **gains** card (`propose_chart` `before-and-after` or `scorecard`) with the
  expected change and its direction, for example accuracy up, latency down,
  each marked as an estimate with its basis;
- redrawn slices of the real Architecture board, pulled from `read_topology`,
  so the plan points at real nodes.

## Guidance, not gates

The planning turn gets a **guidance section**, a short checklist of what a good
plan usually contains, written as an offer ("a plan usually …, include what
fits"). It has no refusals, no forced round and no "EXACTLY", and a plan that
leaves a part out is still a plan. What we measure is how often each part
appears across the live battery, and the wording changes if a part never
appears. That matches the rest of this walk: the harness hints and the model
decides.

## Build order

1. Canvas tabs (a `surface` field on canvas blocks, a tab strip, persistence per
   session).
2. `/plan` command, plus the Plan-turn guidance section and writing the plan
   document.
3. The Plan tab's layout: spine, before/after, MADR, gains, board slices.
4. The live battery gets a `/plan` case scored on how many parts appear. That is
   reported as a rate, not as pass or fail.

---

# Second pass — `/plan` built, and what the live model did with it

## Built

- **`/plan <task>`** switches the composer to Plan and sends the task. The
  engine takes the prefix off and marks the turn a planning turn
  (`analyzer/src/server/planTurn.ts`). Bare `/plan` still only switches the
  mode.
- **The guidance** is an offer: goal and steps through `write_plan`, the plan
  document, and optional pictures (a before/after, decision records, the
  expected effect as an estimate). It says none of it is required. On a
  planning turn the standing "ask ONE clarifying question" line is replaced,
  because the person has already chosen the scope.
- **The AI Canvas has tabs.** Blocks and charts carry a `surface`, each tab is
  its own pad (the default keeps its old storage key), `+` opens the next
  one, and a block written to a tab brings that tab forward. On a planning
  turn, a write that names no tab goes to the Plan tab.
- **The Plan tab reads in two columns**: the Markdown on the left, its pictures
  level with it on the right.
- **The plan is a file too**: `.sequence/plans/<thread>.md`.
- **A planning turn may write six canvas blocks.** An ordinary turn still
  writes one.
- **The planning floor.** A planning turn that ends without a plan document
  gets one written from its evidence, with thinking off. Its numbered or
  "Steps" list goes through `write_plan`. It never refuses.

## Found by the live battery, and fixed

| found | fix |
| --- | --- |
| The compound question read 11 times and answered nothing. The new nothing-drawn note then filled the empty answer, and the judge passed it. | A turn that researched and wrote nothing is asked once to answer from its evidence. The note is appended after the funnel. The judge reads past the harness's own notes. |
| The rescue came back thinking-only (30 tokens, 53k characters of thought). His profile's effort setting blocks the provider's own retry. | The rescue writes with thinking off. |
| `links[0].to: unknown item "prev"` refused a whole before/after chart, and the model gave up on it. | A link to an item the chart lacks is dropped and named. Claims about the repository are still checked. |
| The model read the guidance as rules: "the instructions require calling propose_chart". | The guidance now says none of it is required, and to carry on past a refusal. |
| `/plan` asked clarifying questions instead of planning. | The scoping line is replaced on planning turns. |
| `aiCanvas.css` had an unclosed comment, so every rule after it (SVG sizing, story nav) was dead in the browser. | Closed. `stylesheetComments.test.ts` now checks every stylesheet. |

## The battery (Bastion; `/plan` on a scratch copy so his sessions are untouched)

- plain, lookup, bare-draw, compound, arch-add: all pass. `arch-add` is his
  turn-17 prompt verbatim, and it now lands with **0 refusals** (it had 2).
- The thinking reaches the wire on every turn, from 2.7k to 53k characters.
- `/plan`, three runs before the floor: 0 refusals and no clarifying
  questions. The plan document landed in 2 of 3 runs and the board proposal
  in 3 of 3. The pictures landed on the wrong tab, and `write_plan` never ran.
- `/plan` after the planning floor (rate B): the document landed 2 of 3 again,
  and one run ended with a good plan in prose and nothing on the tab. The
  thinking-off rescue had answered in tool calls, and those were discarded.
- `/plan` after the rescue runs those calls (rate C): **the document landed 3
  of 3**, the expected-effect chart landed on the Plan tab in 1 of 3, and the
  board proposal landed 3 of 3, with 0 refusals.
- **Not yet measured live:** the steps. The battery sends no thread, so the
  engine has no session to hang a goal on and `write_plan` is not offered. In
  the app a session always exists. Unit tests cover the steps
  (`goal-name.test.ts`, the planning tests in `ask-tool-loop.test.ts`). The
  before/after Mermaid appeared in 0 of 9 runs. That is the guidance line to
  reword next, if he wants it more often.

**Named, not done.** `arch-add` sometimes still asks compact-or-detailed on an
ordinary (non-plan) turn. That line is the earlier ruling, pinned by eight
test files, and it is his to change.

---

# Third pass: the ML Harness walk (three photos and a transcript)

His words, in order, and what each became. Head `ee343317` on `origin/main`
(`git ls-remote`), installed into the app; the app was closed at install time
and wants a restart.

| He said | Found | Done |
|---|---|---|
| "Under the thought … a spacing thing … make it more secretive and easy to look at." | A closed Thought fold is 0fr tall, but its body kept its vertical padding and its left rule: an 8px sliver with a stray `\|`. | `chat.css`: a closed fold's body drops padding and the rule (`48b64362`). |
| "Reading topology seems to get spamming tools … one service, one service … we want a bit more depth." | Four `read_topology` calls on one service in his turn. Each returned the digest's first 50 of 143 files and `truncatedFiles: 93`, and no argument could reach the other 93. Modules came back as bare ids. | With the graph, one service returns its **modules with the scan's description and file count**, files outside modules, edge count; `module` returns one module's full file list; the description and the hint say one call per level (`askTools.ts`, `48b64362`). Locked by a synthetic-module test in `ask-tool-belt.test.ts`. |
| "Chat name should be … the summary of the request … build XYZ feature." | The title was the trimmed first message, re-derived on every chat write. | The chat is named once, on its first reply, from the first exchange, by the model with thinking off and the goal name's timeout; `generatedTitle` / `titleGenerated` in the index; a person's rename still wins; the chat-memory write returns the index and the client dispatches it so the rail shows it (`sessionsStore.ts`, `goalName.ts`, `repoServer.ts`, `connect.tsx`, `48b64362`). Without a model configured the trimmed message stays. |
| "Run unattended … Trust repository. Check mark isn't letting me tick it." | The box is disabled until the repository is trusted, and the V3 shell never rendered the one control that trusts one (`TrustStrip` belongs to the retired composer). | Settings → Workspace has **Trust this repository**; the box is re-read from the server after and then ticks (`SettingsPanel.tsx`, `settingsClient.ts`, `48b64362`). |
| "Under the kinds, when I click Show it overlaps … at 25% it flips over. Minimize it to one icon so it fits." | The open key was a flex item of the furniture row, so it grew, wrapped and moved the pills beside it. | One glyph shut (count and hint in the accessible name); open, a popover anchored to the pill, out of the row's flow, one chip per line, above the bars; closes on Hide, Escape or a press elsewhere (`KindLegend.tsx`, `board.css`, `699c3565`). |
| "Click on the ML service, there's 55 nodes … turn these micro file services into macro … then micro." | `serviceInterior` placed every direct child; 6 modules drowned in 49 loose files. Module descriptions never showed: the scan's line starts with a file count and the glance filter drops that as inventory. The camera stayed at 100% when a module opened. | A service with modules opens to its **modules**, loose files are counted in the bar, a module opens to its files, Back goes up one level and names where it goes (`fa1fcec3`, `24b8d6dd`, by a builder). Module cards lead with what they define: `Defines abort, run, ready (17 ts files in web)` (`ee343317`). The fit latch waits for the level just opened (`Board.tsx`, `ee343317`). |
| "The output I got, which is nothing" (the transcript). | The question ended "…draw on the ai canvas … to teach me", so it classified **teach**, and the draw contract keyed on the draw intent alone. The teach floor was gated on the Teach toggle (off in his Plan chat) and on a lesson concept a first broad question has not got. The reply ended "Let me draw this on the canvas." and nothing checked that promise. | A drawing is owed when the question asked for one in any intent, or when the answer **promised** one; a chart counts as a drawing; a teach turn's closing check-in does not cancel the round (`askPipeline.ts`, `endsWithDrawPromise`, `48b64362`; three tests in `ask-tool-loop.test.ts`). |

## Gates at `ee343317`

- `node --test tools/ci/*.test.mjs`: exit 0, 318 pass.
- analyzer `npm test`: exit 0, 2937 pass.
- web2 `vitest run`: exit 0, 275 files, 3183 pass.
- web2 `vite build`: exit 0.
- Installed: `resources/server/packages/{analyzer,web2}/dist` (robocopy /MIR; the
  new `read_topology` text is in the installed `askTools.js`).

## Named, not done

- **The teaching "flow" view** (UI and tokens → gates and tests → harness;
  engine → gates). The macro level is modules-first; a role-ordered flow needs
  edges rolled up from file imports to modules, which nothing computes yet.
- **Module descriptions are what the scan defines**, not a sentence about the
  job. A better line means changing `describeCluster` (pinned by four tests) or
  asking the model; both are a ruling.
- **The camera fix is by analysis.** The builder saw the 100% camera in the
  real app; jsdom lays out synchronously and the strengthened refit test
  ("pressing Fit moves nothing") passed before the change too. The change is
  the effect-order fix the symptom names; his next module open is the proof.
- The chat name needs a configured model; the battery sends none.
