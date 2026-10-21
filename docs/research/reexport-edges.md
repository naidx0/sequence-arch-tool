# The product has been missing one dependency edge in eleven

**Measured on this repository, 2026-09-05, before and after.**

## The number, first

| | before | after |
|---|---|---|
| **total edges** | **2,600** | **2,851** (+251) |
| files with at least one inbound edge | 448 | **470** |
| files whose inbound count changed | — | **185 of 1,023** |

**8.8% of this repository's dependency edges did not exist in the graph**, and **22 files that
looked like nothing depended on them have dependents.** Every claim the product has made about who
uses what — impact, risks, cycles, the derived chart, "answered from 211 of 2,591 edges" — was made
against a graph missing roughly one edge in eleven.

## What was missing

`export { renderBrief } from './brief.js'` and `export * from './x.js'`. A re-export makes the
exporting file depend on the exported one exactly as an import does: the module is loaded, its code
runs, and a change to it changes this file's surface. The parser handled `import_statement` and had
no branch for `export_statement` at all.

**Only an export WITH A SOURCE is a dependency** — `export const a = 1` depends on nothing, and a
rule that counted it would invent an edge out of every file in the repository. That half is tested.

## How it was found, which is the part worth keeping

Not by an audit. **A picture was incomplete.** The derived chart of `brief.ts` drew four importers,
a reader asked why `index.ts` was absent, and the answer was neither a cap nor a bug in the drawing:
the chart was right about the scan and the scan was wrong about the repository.

A barrel `index.ts` is exactly where a codebase concentrates re-exports, so the gap was largest
precisely where a reader is most likely to look for "what uses this".

## The charts, re-checked edge by edge

Every link in every derived chart traces to a real scanned edge, before and after:

```
brief.ts        : cli.ts->brief.ts, analyzer/src/index.ts->brief.ts,
                  repoServer.ts->brief.ts, brief.ts->schema/src/index.ts
bigram_counts.py: nn_bigram.py->bigram_counts.py, sampling.py->bigram_counts.py
nn_bigram.py    : nn_bigram.py->bigram_counts.py
sampling.py     : sampling.py->bigram_counts.py
```

`analyzer/src/index.ts -> brief.ts` is the edge the seat read caught as missing, now drawn, and
readable because the label rule extends a colliding name until it identifies one file.

## What this does not fix

Only JavaScript and TypeScript. Python's `from x import *` re-export shape and any other language's
equivalent are unmeasured, and this page does not claim them.
