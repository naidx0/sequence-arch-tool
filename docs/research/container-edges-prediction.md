# Do container edges exist? — registered before looking

**Written 2026-09-05 before reading a line of the surfaces.**

The measurement that raises it: **10 services and 30 modules carry a path, and all forty have zero
edges.** Every edge in this graph is file-to-file.

## What I expect

1. **No module-to-module or service-to-service edge exists as data.** The degree-0 count already
   says this for the forty nodes measured; I expect it to hold for every container in the graph, and
   for `ArchEdge` to have no notion of a container endpoint.
2. **At least one surface derives them at render time.** The Architecture board draws something at
   the service level, so it must be aggregating file edges upward somewhere.
3. **And the derivations will not all be the same.** This is the assembly-drift law's third instance
   in a day — `teachContext`, `reasoningEffort`, the whole lesson — and a rollup written once per
   consumer is exactly the shape that has been wrong every time. I expect the board, the impact
   answer and the risks answer not to share one function.

**What would surprise me:** a single shared `rollupEdges` that every consumer calls. That would mean
the layer is fine and the only gap is that `buildQueue` chose a node kind the graph never connects.

## Why it matters either way

If containers are derived per-surface, then *"what depends on this module"* can have a different
answer on the board than in an impact answer, and neither is checkable against the other. If they
are derived nowhere, then every module- and service-level claim the product makes is either absent
or invented, and that is a scanner gap with the same shape as the re-export one — which was **one
edge in eleven**.

## The number to report

**Module pairs that share a file edge and have no module edge**, counted the way the re-export
change was: the size of what is missing, before any fix.

---

# READ — measured, and my registration was wrong in an instructive way

## The numbers

| | |
|---|---|
| module-to-module or service-to-service edges **as data** | **0** |
| edges with any container endpoint | **6** — all `file → datastore:Database`, `db_read`/`db_write` |
| **module pairs joined by at least one file edge, with no module edge** | **141** |
| service-level derivations that exist | **2** |
| edges they produce | **1** and **162** |
| **overlap between them** | **0** |

## Where each surface gets its edges

| surface | source | imports? |
|---|---|---|
| Architecture board | **refuses to lift at all** | excluded, deliberately |
| impact (`impactEvidenceChains`) | `serviceLevelRisksInput` | **excluded** |
| risks (digest, ask intents) | `serviceLevelRisksInput` | **excluded** |
| **the prompt** (`indexDigestForAsk`) | **its own rollup** | **included** |

## What I got wrong, and what it means

I registered three expectations. **Two were wrong.**

- *"No container edge exists as data"* — six do, all to a datastore. Containers are legal edge
  **targets**; what does not exist is container-to-container.
- *"The derivations will not all be the same"* — three of the four **do** agree, and share one
  function. The board even carries a written decision with three reasons for refusing to lift an
  import, naming a real incident: *"an import lifted to a service edge is that same shape of error,
  at scale."*

**The one I got right is the one that matters, and it is worse than drift between two rollups.**
Three consumers hold that an import is not a service-level claim. The fourth is the **prompt**, and
it rolls imports up into **162 service-to-service edges** that the product itself refuses to draw or
to reason about.

So the model is told, as structure, exactly the thing `docs/CANON.md`'s first non-negotiable forbids
the board from drawing: *something asserted at the system level that was only ever measured at the
file level.* The board will not show it, impact will not use it, risks will not count it — and the
prompt states it.

## The blast radius, stated the way the re-export one was

The re-export gap was **one edge in eleven missing**. This is the opposite shape: **162 service-level
edges present in what the model reads and absent from everything that checks it.** Every answer the
model gives about how services relate is grounded in a claim no other surface will corroborate, and
a reader who follows it to the board finds nothing there.

**141 module pairs** share a file edge and have no module edge — the count asked for. That number is
the size of the layer nothing derives at all, since `serviceLevelRisksInput` lifts to
service/datastore/topic and never to module.

## The fix is a decision, not a patch, so it is not in this commit

Two coherent positions, and they cannot both hold:

1. **An import IS a service-level dependency** — then the board is wrong to refuse it and impact and
   risks are wrong to skip it, and the hairball problem the board names has to be solved rather than
   avoided.
2. **An import is NOT one** — then the prompt must stop rolling imports up, and 162 edges leave what
   the model is told.

The board's reasoning is written down and specific; nothing states the prompt's. On the evidence
here **(2) is the one the codebase already believes three times over**, but this is an owner-level
call about what the product claims, not a build decision, and it is recorded as one.
