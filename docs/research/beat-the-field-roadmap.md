# Beating the field — the adoption roadmap (2026-09-01)

Synthesis of three research lanes: rival harness internals (Claw-SWE-Bench paper
arXiv:2606.12344 + OpenClaw/Hermes source), memory & self-improvement systems, and
eval/teaching practice. Decisions and build order; details in the sibling docs.

## The two causal facts that reframe everything

1. **Apply-failure elimination is the largest measured effect in the field's own paper**
   (bare diff-emitting adapter 19.1% → tool-edit + runner-side git diff 73.4%). Sequence
   already has this. The remaining gap is LOOP MECHANICS.
2. **The turn-budget ladder equals the score ladder** (cap 30 → 60.9%, cap 50 → 70.3%,
   cap 300 → 71.1%, uncapped → 73.4%; the winner SPENDS 67–88 turns). Nobody at the top
   stops on a round counter; they stop on model-declared completion inside a wall-clock
   budget. Harness spread doubles on cheap models (12.5pp → 27.4pp) — our exact regime.

## Build order (bench profile first, product-safe throughout)

### P0 — the amputation fixes (benchmark profile)
1. **Sandboxed full exec**: in the SWE-bench container (already isolated Docker), an `exec`
   tool that runs ANY command in /testbed, 180s timeout, exit code always reported, output
   head+tail capped, every exec a first-class evidence row. The product's local-repo
   whitelist is untouched — the container IS the sandbox. Un-warns the prompt: repro
   scripts become the expected move (Phase 4 of the shared prompt we already ship).
2. **Stopping policy**: wall-clock deadline (adapter timeout minus buffer) as the real
   bound; round cap raised so the deadline binds first (≥150 in bench profile); finish
   reasons classified `stop|error|empty|timeout`; one whole-task retry on empty/error
   (field default). Delete scarcity language from bench prompts — it teaches
   under-exploration.
3. **Minimal bench tool surface**: a `swebench` profile exposing read/search/edit/
   propose/exec/git_diff + our graph advantage (locate_symbol, who_calls); nothing
   conversational. Smaller stable prefix, lower tool-choice entropy.

### P1 — cache-shaped context (the OpenClaw 96%-cache-hit lesson)
4. Stable prefix invariant (system prompt + tool schemas frozen per task — largely held
   already via promptWithTools); transcript appended monotonically; a pre-call prune pass
   over OLD tool results only, with OpenClaw's published numbers (skip below 30% window;
   soft-trim results >4k chars to first/last 1.5k; placeholder at 50%; never touch last 3
   assistant turns). Ledger on disk stays full fidelity; only the rendered view trims.
   Track cache-hit rate per run — under 90% means the loop rewrites history.
5. **Overflow compact-and-retry**: classify provider context-overflow, summarize oldest
   ledger rounds (keep last ~20k tokens, never split call/result), append, retry once.

### P2 — edit + read robustness (cheap-model regime)
6. Fuzzy-normalized edit matching (NFC, smart quotes/dashes, whitespace-insensitive lines)
   before rejecting oldString; structured rejection carrying the closest region; per-path
   failure counter escalating to "your view is stale — re-read".
7. Read hygiene: dedup stub on identical re-read (partially built), HARD refusal of the
   4th identical read pointing at the earlier evidence row; negative cache on missing
   paths.

### P3 — measurement upgrades (from the eval lane)
8. Gold+empty patch validation of all 50 instances (3× each); noise band via 3× panels;
   pass^k reported beside pass@1; four trajectory metrics (empty-patch, stuck-loop,
   localization-match, steps-per-resolve).

### Product track (parallel, non-bench)
- Sequence memory files + failure distill + skill efficacy (memory doc) — NOTE: both
  leaders scored with memory OFF; this is product value, not bench ROI.
- Teach rubric v2 + misconception remediation + predict-on-canvas (teaching doc).

## What we deliberately do not build
- Embedding/vector retrieval (no evidence in any top harness; grep+graph wins).
- Repo maps (none of the five use one; our graph tools already exceed this).
- Cross-task memory for benchmarks (leaders disabled it and won).
