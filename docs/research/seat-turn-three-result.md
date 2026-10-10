# The seat read on turn three — the checks pass, the thread does not

**Stage three of three, 2026-09-06T21:14:00–21:22Z, card held, tree at `7c591f1c`. Read as a software
engineer with a hard system in front of them, which is the identity now public.**

## Validity, established before the read and re-checked after

| condition | check | result |
|---|---|---|
| a stale server | `/api/build` `startedAt` vs `builtAt` | clear (app restarted first — it *was* stale) |
| a build older than the code, either half | `server.stale`, `client.stale` | both clear |
| a chart from a process nobody restarted | `startedAt` compared before and after | unchanged across the read |

Named before the run, and one of them fired: the app was stale on the first check and was restarted
before the card was taken.

## The conversation

| turn | ask | seconds | files read |
|---|---|---|---|
| 1 | Which files depend on `scan.ts`, and what breaks if it changes? | **141** | 4 |
| 2 | Of those, which one would I have to change first? | **123** | **0** |
| 3 | Show me how that file uses what `scan.ts` returns. | **113** | 5 |

## The mechanical checks all pass

- turn 3 names `scan.ts` — **yes**
- turn 3 names a concrete dependent file — **yes**
- the reply cites evidence it read — **yes**
- a picture is on the page — **no**

**Three of four green, and the conversation is broken.** That is the finding about the instrument as
much as about the product: these checks measure whether the right tokens appear, and every one of
them can be satisfied by an answer that does not follow the thread.

## What an engineer actually got

**Turn 1 answers, and reads the wrong files.** It names `cli.ts`, `diagramCli.ts`, `doctor.ts`,
`index.ts`, `collectEnvReads.ts` — from `who_calls`, which is right — while the four files it
actually *read* were `files.ts`, `fileSignals.ts`, `policyScans.ts` and `policyScans.test.ts`, none
of which it mentions. The answer came from a tool result; the reads went somewhere else.

**Turn 2 does not answer the question.** Asked *"of those, which one would I have to change first?"*,
it replied:

> The first change you'd make is to edit the scan-logic file itself: `packages/analyzer/src/scan.ts`.
> All 84 dependent files … will automatically reflect the new behavior without requiring separate
> edits.

The engineer asked which **dependent** to change first. It returned to the subject of turn 1 and told
them to edit `scan.ts`. **It read zero files to decide that.**

**Turn 3 answers about a file nobody named.** *"That file"* should resolve to whatever turn 2 named —
which was `scan.ts`. Instead turn 3 discusses `fileSignals.ts`, and its first sentence is:

> The file `packages/analyzer/src/explain/fileSignals.ts` does not contain an explicit call to
> `scan.ts`.

So the pronoun resolved to a file from turn 1's *reads* rather than turn 2's *answer*, and the reply
opens by reporting a negative about it.

## Read for the first tier, this fails; read for the third, it nearly passes

**As a lesson** it is tolerable: a learner asking about `scan.ts` is told what depends on it, that
changing it is the central edit, and is shown a related file. Nothing is fabricated — the 84 callers
are real, `fileSignals.ts` is real, and the negative it reports is true.

**As an engineer tracing a dependency it fails at turn 2 and never recovers.** The question *"which
one first"* is the actual work — it is a judgement about ordering across 84 callers — and it was
answered by pointing back at the file the engineer already knew about. Turn 3 then compounds it by
resolving *"that file"* against the wrong antecedent.

**Per the ruling, that is the finding and not a mixed result.**

## Two more things an engineer would notice

**Two minutes a turn.** 141, 123, 113 seconds. Six and a half minutes for three questions, of which
one was not answered.

**No picture, in three turns of a dependency question.** For a product whose claim is that it draws
your system, an engineer asking exactly the question a diagram answers got prose about 84 files.

**Correction to this section, 2026-09-06, after it was written.** The sentence originally here —
*"the chart derivation requires a teach concept; on a first-tier ask there is none, so nothing
draws"* — was too strong about the product, and it was checked only after it had been committed and
quoted. Two things are true that it left out:

- **The Architecture board draws the scanned graph with no turn at all.**
  `packages/web2/src/app/App.tsx:266` supplies `project: (graph) => seqdFromGraph(graph,
  graph.nodeDetail)`, and `seqdFromGraph.ts` opens by naming its own job: *ArchGraph → SeqDiagram for
  the product board (scan origin)*. It is fed by `repo/loaded` — a scan. No teach concept, no chat,
  no model. The store's `null`-projector arm exists to **refuse** a document that did not come from a
  graph, so the board is only ever the scanned graph.
- **`propose_chart` is reachable on a first-tier ask.** It is in `ASK_TOOL_ALLOWLIST`, it is
  deliberately not mutating, and `askToolsForJobMode` filters only `ASK_MUTATING_TOOLS` — so it is
  not removed on a non-teach turn. The belt run is the proof it is live: with `TOOLS` trimmed the
  model called it 11 and 9 times.

**So what is teach-gated is the *derived* chart** — the fallback at `askPipeline.ts:~2805`, guarded
by `input.teach === true`, which is also the only place `lastChartThisTurn` is set. On a first-tier
ask the model may still draw by calling the tool, and it did not in this read.

**The finding stands, narrower and more precise:** on the conversational path, an engineer's ask has
no fallback that draws and the model did not choose to draw — three turns, zero pictures. It is not
that the product cannot draw outside teach mode; it is that the chat does not, and the one surface
that always draws is a different tab the engineer was not in.

## What this does not claim

- **Not that the model is at fault.** Turn 2 had no file contents and no carry to reason from — it
  read nothing. What it lacked is what the carry exists to supply and what the carry currently
  supplies in 600-character fragments.
- **Not a statistical result.** One conversation, three turns. It is a seat read: it says what a
  person sitting there gets, and it is the cheapest instrument here — the previous one produced five
  defects in four browser reads.
- **Not that the checks should be deleted.** They caught nothing here, which is the point: they
  should be joined by one that asks whether the pronoun in turn 3 resolves to turn 2's answer, since
  that is the failure a person sees immediately and no token check can see at all.
