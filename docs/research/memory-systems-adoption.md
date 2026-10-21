# Sequence memory — adoption plan from the open-source field (2026-09-01)

Research pass over supermemory, mem0, Letta/MemGPT, Zep/Graphiti, LangMem, Hermes-Agent
memory, Prime Agent's continual harness, and the self-improvement literature (Self-Refine,
Reflexion, Voyager, Agent Workflow Memory arXiv:2409.07429, ReasoningBank arXiv:2509.25140,
Dynamic Cheatsheet, Evo-Memory). Full citations in the research trail; this doc keeps the
decisions.

## The finding that matters most

**Sequence is already convergent with the best designs.** Prime Agent's continual harness
(evidence-backed supplemental refinements, immutable base, rollback) is the exact shape of
our existing `RefineProposal` accept/deny/rollback + verify gate. Agent Workflow Memory
(induce reusable workflows from successful trajectories) is our existing `skillDistill.ts`.
Hermes's bounded curated memory file is the pattern our own MEMORY.md uses. Adoption is
mostly EXTENSION, not new machinery.

## The three adopted patterns (local-first, no vector DB, no-key-still-works)

1. **Hermes bounded curated file** — `.sequence/memory/MEMORY.md`, hard ~800-token cap,
   `§`-delimited entries, injected as a frozen snapshot each round (prefix-cache-friendly),
   edited via an add/replace/remove memory tool, and — the elegant part — **a write past
   the cap ERRORS with the current entries**, forcing consolidation. The cap is the
   forgetting policy. No retrieval infrastructure at all.
2. **ReasoningBank/AWM distilled items, keyword-routed** — memory items as small files
   `{title, one-line description, body}` distilled from BOTH successful and failed
   trajectories (ReasoningBank's ablation: failure memories carry much of the gain).
   Retrieval by deterministic signals we already have: intent id (skill router, built),
   file-path overlap, grep. No embeddings.
3. **Zep's bi-temporal invalidation on an append-only ledger** — `.sequence/memory/
   facts.jsonl`: a fact is written only when a verify gate or real command confirmed it;
   contradiction APPENDS a superseding row (`invalidatedBy`, `invalidAt`), never deletes.
   Provenance survives; the ledger is greppable. Consolidation runs as a deterministic
   between-sessions pass (Letta's "sleep-time", minus the LLM requirement).

Rejected: passive per-message LLM extraction (noise, cost, violates the no-key law),
embedding retrieval (the deterministic router is testable), RL-tier training loops.

## The file plan

```
.sequence/memory/
  MEMORY.md            # curated working set, hard cap, always injected
  facts.jsonl          # gate-verified claims, append-only, bi-temporal
  failed-approaches.md # the mirror skillDistill never had: what NOT to retry, with receipts
  house-style.md       # conventions harvested from corrections
  flaky-tests.tsv      # purely mechanical: failed-then-passed tests, evidence run ids
```

Writes: agent edits only MEMORY.md (tool, mid-round); the HARNESS appends facts/flaky rows
at round end from gate outcomes; the between-sessions pass distills skills (successes) and
failed-approaches (failures), each landing as a RefineProposal through the existing
accept/deny/rollback.

## The self-improvement loop (build order)

1. **Failure distill** — invert `skillDistill.ts`'s success filter; target
   `failed-approaches.md`. Small diff, large measured gain in the literature.
2. **Skill efficacy tracking** — stamp trajectories with which skills/memories were
   injected; per-skill success-rate deltas are pure arithmetic; a skill that correlates
   with failure earns a demotion RefineProposal. A skill stays only while it provably
   helps — Voyager's verification loop with our verify gate as the reward.
3. **Consolidation pass** — dedupe/merge skills, fold accepted refines into MEMORY.md,
   invalidate facts whose evidence files changed since `verifiedAt` (git tells us free).
4. **Promotion tiers** — distills land session-local; committing to the repo's
   `.sequence/memory/` is an explicit accept (the RefineProposal UI already is this).
