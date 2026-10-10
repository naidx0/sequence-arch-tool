# Ask control-flow graph (B1.5)

**Status:** living · **Phase:** B1 · **Code:** `packages/analyzer/src/server/askPipeline.ts`, `askIntent.ts`, `askTools.ts`  
**Not a product claim:** measured win rates stay on the Phase B bakeoff scorecard.

## Intent router (B1.1)

`classifyAskIntent(question)` → `draw | explore | edit | chat` (heuristic; metrics on every ask).

Order: draw → edit → explore → chat.

## Paths

```
question
   │
   ▼
classifyAskIntent ──────────────────────────────┐
   │                                          │
   ├─ draw ──► short round cap (≤2)           │
   │            │                             │
   │            ▼                             │
   │         tool loop                        │
   │            │                             │
   │            ├─ propose_topology / canvas.write_* succeeds
   │            │     → EARLY EXIT (B1.2)     │
   │            │     → prose or forced-final │
   │            │                             │
   │            └─ no diagram yet             │
   │                  → unproductive / ceiling│
   │                                          │
   ├─ explore ─► default round cap            │
   │            + unproductive-round stop     │
   │            (signatures, not raw ids)     │
   │                                          │
   ├─ edit ────► propose_files (once/turn)    │
   │            │                             │
   │            ├─ proposal succeeds          │
   │            │     → EARLY EXIT (B1.4)     │
   │            │     → Review = diff-first   │
   │            │                             │
   │            └─ no proposal yet            │
   │                  → default loop          │
   │                                          │
   └─ chat ────► default path                 │
```

## Shared loop guards (all intents)

| Guard | Effect |
|-------|--------|
| Round ceiling | `resolveAskRoundCap` — draw ≤ `DESIGN_DRAW_ASK_TOOL_ROUNDS` (2) |
| Unproductive rounds | Stop after `resolveUnproductiveRoundLimit(intent)` identical evidence signatures — explore gets 3, others 2 (B1.3) |
| Once-per-turn | One successful `propose_topology` / `propose_files` / canvas write per turn |
| Permission breaker | Stop after N consecutive denials |
| Forced final | Never empty transcript when tools ran or ceiling hit |
| Tool result cache | Identical read-tool args reuse evidence within the turn |

## Draw path Done when (user seat)

One ask that says “draw / diagram / on the board” lands a topology (or canvas block) and ends without burning remaining tool rounds on a refused second propose. Provider-call count for a clean success is **1** (plus harness forced-final only when the model left no prose).

## Edit path Done when (user seat)

One ask that says “fix / implement / refactor” stages a `propose_files` proposal, stops the tool loop, and leaves Review (per-file diff + Accept/Deny) as the next seat — not another tool round.

## Gaps still open

- Intent does **not** yet change tool allowlists (metrics + caps + early-exit only).
- **B1.3** explore: `EXPLORE_UNPRODUCTIVE_ROUND_LIMIT = 3` (one extra dig vs chat); further bakeoff tuning stays OWNER.
