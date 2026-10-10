# The prompt stops rolling imports up — registered before the change

**Written 2026-09-05 with the baseline measured, before touching `indexDigestForAsk`.**

## The ruling and the law behind it

**What the model reads as structure must be what the product is willing to draw.** The codebase has
decided three times — the board, impact, risks — that an import is not a service-level claim, with a
written incident behind it. The prompt was the one consumer that disagreed, rolling imports up into
**162 service-to-service edges** with **zero overlap** with the 1 the other three compute.

## The baseline, measured

| | makemore | sequence |
|---|---|---|
| digest size | 620 chars | 89,237 chars |
| **indexed at all** (`shouldIndexDigestForAsk`) | **false** | true |
| rolled service edges | **0** | **162** |
| services | 1 | 10 |
| digest edges | 2 | 300 |

## What I expect to move

- **Rolled service edges: 162 → at most 1.** The non-import cross-service edges are what
  `serviceLevelRisksInput` already finds, and it finds one.
- **The indexed digest gets smaller.** 162 rolled edges leave it; the exact token count is reported
  after.
- **The makemore twenty do not move, and cannot.** `shouldIndexDigestForAsk` is **false** for a
  620-character digest, so `indexDigestForAsk` never runs on makemore — the rollup this change
  touches is code those twenty conversations do not execute. That is measured, not assumed, and it
  is the whole reason this can land while their figures are under a standing ruling.
- **"answered from N of M edges" does not move.** M is the scanned graph's edge count, computed from
  the graph and not from the digest index. Predicted unchanged at 2,857.
- **The sequence condition may move**, and in which direction is genuinely open: the model loses 162
  claimed connections it could lean on, so an answer about how services relate has less to say and
  more reason to say so honestly.

**Refuted if** rolled service edges do not fall to ≤ 1, if the makemore dry-run numbers change at
all, or if "N of M" moves — each would mean I have misread which code path owns which number.

## The shape of the fix

The import filter is not copied into the rollup. It becomes **one exported predicate** that both
`serviceLevelRisksInput` and `indexDigestForAsk` call, so a fifth consumer cannot quietly disagree
the way the fourth did. That is the assembly-drift law, applied to the rule that started this.

---

# READ — landed, every registered number as predicted

| | before | after |
|---|---|---|
| **rolled service edges (sequence)** | **162** | **0** |
| indexed digest | 25,460 chars | **4,018** |
| makemore: indexed at all | false | **false** |
| makemore dry-run charts | 15 of 28 | **15 of 28** |
| sequence dry-run charts | 9 of 13 | **9 of 13** |
| graph edges, the M in "N of M" | 2,858 | **2,858** |

**Every registered expectation held.** 162 → 0 (predicted ≤ 1; the single non-import service edge
`serviceLevelRisksInput` finds is not among the digest's trimmed 300). The indexed digest is **84%
smaller**. makemore cannot move and did not. "N of M" is unchanged, because M is the scanned graph's
edge count and never came from the digest index.

## Two things the change surfaced that the prediction did not cover

**The counter would have lied.** My first patch incremented `omittedInternalEdges` — which means
*"both endpoints inside one component"* — for import edges too. The model reads that count in the
index's omission line, so it would have been told a true total with a false cause. It has its own
counter now, and its own line:

> *"…250 file-level edges (imports) are NOT shown as service connections — an import relates two
> files, not two services; call read_topology or search_files for the file-level facts."*

That is the honest form of the ruling: the model is told the edges exist, told what they are, and
told how to get them — rather than handed them as system structure or silently denied them.

**The test fixture encoded the old belief.** `productionShapedDigest` made every edge an `import`,
so *"the cross-component edges survive whole"* was asserting that imports become service edges. With
the rule applied, the honest answer is that none of them do. The fixture now carries real
service-level edges (`http`) alongside the imports, so both halves are testable: cross-component
edges survive, and imports are omitted as file-level.

## Recorded where the decision lives

`ConnectedBoard.tsx`'s decision block — the one naming the svc:gateway incident — now carries
**2026-09-05: the fourth consumer comes into line**, with the 162, the 25,460 → 4,018, and the
standing offer: *if a reader needs those connections for an honest answer, make them DATA with this
incident's rule applied, rather than keep telling the model a thing the board will not show.*
