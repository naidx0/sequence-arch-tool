# Subagent failure diagnosis — why explore agents Stop (2026-08-04)

**Status:** Research + actionable fixes (not "disable subagents")  
**Context:** Tier completion runs on `cursor/tier-completion-p1-4112` succeeded with BUILD waves; **explore/gap-analysis fan-out** repeatedly Stopped + parent "Waiting for subagent".

---

## Symptom

```
Platform/correctness gap scan Explorer  → Stopped
UX/legibility gap scan Explorer       → Stopped
Agents/workflow gap scan Explorer     → Stopped
Parent                                → Waiting for subagent
```

Sometimes loops: re-plan → spawn again → Stopped again.

---

## Root causes (ranked by evidence)

### 1. Skill misfire — `autonomous-loop` matches "gap analysis"

`autonomous-loop/SKILL.md` description:

> *"critic swarm hunts **gaps** against docs/vision.md"*

Saying "full gap analysis" loads the skill → Step 1 mandates **parallel critic swarm** (3–4 explore subagents). That is correct for overnight R&D loops; wrong for a one-shot report.

**Fix:** Tighten skill `description:` to require explicit phrases ("run autonomous loop", "hand off overnight"). Keep subagents for BUILD; use parent-direct for gap reports unless user says "swarm".

### 2. Context bomb — every subagent inherits `CLAUDE.md` § READ THESE FIRST

Mandatory list (~3,800 lines across 9 docs) before any task:

- HANDOFF.md, product-principles, final-product-design, vision, usability-standard, owner-feedback-log, how-to-verify, autonomous-loop.md, loop-log.md

Explore agents spend budget reading canon, then timeout → **Stopped**.

**Fix (subagent prompt injection):**

```
CONTEXT DIET: Do NOT read HANDOFF.md, loop-log.md, or autonomous-loop.md.
Read ONLY: [list 2–3 files]. Return markdown report in ≤25 tool calls.
```

### 3. `orchestrated-build` parent starvation

Skill says parent **never reads large files** — only dispatches. For analysis tasks the parent becomes a dispatcher with no synthesis material when children die.

**Fix:** orchestrated-build applies to **multi-file BUILD programs** only. Analysis/planning: parent reads; subagents BUILD only.

### 4. Parallel explore overlap

Three explorers with overlapping missions (all read vision.md + loop-log + grep codebase) duplicate work, race context limits, and fail together.

**Fix:** One scout per phase OR parallel with **disjoint lenses + disjoint paths** from `tier-completion-orchestration-plan.md` wave matrix.

### 5. Platform lifecycle — not your code

| Trigger | Effect |
|---------|--------|
| User sends new message while subagents run | Children cancelled → Stopped |
| Conversation summarized mid-flight | Orphaned children; parent waits |
| Subagent timeout (large repo + e2e) | Stopped with no partial return |
| UI state | "Waiting for subagent" after children dead |

**Fix:** BUILD subagents `run_in_background: true`; parent continues; on stop, **synthesize once**, re-dispatch **tighter** (smaller scope), max **one** retry.

### 7. Expand UI infinite “loading chat” (2026-08-05) — `source: internal` has no pod

**Symptom:** Clicking a Task subagent row (e.g. `bc-416a84b9`) spins forever on the cloud agent chat page. Expand cards often freeze on **“Planning next moves”** with an **Explorer** badge even after the run is `IDLE` server-side — the parent UI is not streaming Task completion into that row.

**Evidence:**
- All Task children are `source: "internal"`, `branchName: null`, `setupStatus: null`, `environment: null`, **no resolvable pod** (`backgroundComposerPod` missing).
- Parent (`source: desktop`) has a real pod; children do not.
- Successful builders (e.g. Phase1 repair) still have **no pod** but **do** persist full transcripts via MCP `batch-fetch-details` + `include_transcripts`.
- Meta “summarize failure” spawn (`bc-416a84b9`) left `transcript.messages: []` and ~35ms activity — empty shell → guaranteed hang.

**Root cause (two layers):**
1. **UI:** Expand path waits for a cloud-pod chat stream that internal Task agents never get. It does not fall back to the transcript API.
2. **Orchestrator:** Spawning summarize-on-failure children creates orphan `bc-*` ids with empty transcripts.

**Fix (keep using subagents — do not limit count):**
- Treat the **Task tool return text** as canonical; do not rely on expand UI for `internal` runs.
- **Never** spawn meta summarize/plan-next children — parent synthesizes; on failure re-dispatch the **same BUILD role** once with tighter `MAY TOUCH` + CONTEXT DIET.
- Verify non-empty Task return (or transcript message count) before proceeding.
- Platform ask: expand for `source=internal` should load **transcript-first** when no pod exists.

### 6. AGENTS.md — unlikely root cause, but matters for routing

| Version | Content |
|---------|---------|
| `main` @ `468fcc4` | Anti-loop: "NO subagents for gap analysis" |
| `tier-completion-p1-4112` | **Orchestration:** Grok=plan/MADR, Composer=BUILD, subagents encouraged with wave ownership |

If desktop and cloud read different `AGENTS.md` revisions, behavior diverges. **Single source:** merge P1 branch orchestration section to `main`.

**Not the cause:** Original `e0f4518` AGENTS.md (62 lines dev notes only) — innocent.

---

## What worked on `tier-completion-p1-4112`

| Round | Mode | Outcome |
|-------|------|---------|
| r191–r193 | BUILD waves 1A/1B/1C, disjoint ownership | Tier-1 100%, bindings green |
| r197 | MADR/docs (parent or Grok) | P2 verify docs |
| r204 | Schema moat BUILD | L2/L3 catalogs + impactChains tests |

**Pattern:** Sequential BUILD with file boundaries; no 3× explore gap swarm.

---

## Subagent prompt template (fixed)

Use for BUILD waves (from orchestration plan):

```
ROLE: Builder — Phase PX Wave Y slot Z. You do NOT spawn subagents.

CONTEXT DIET: Read ONLY these paths: [explicit list]. Skip CLAUDE.md reading list.

MAY TOUCH: packages/analyzer/src/**
MUST NOT TOUCH: packages/web/**

DELIVERABLES:
1. [numbered]
2. Locking test: [file]

GATE (run before return):
pnpm -r build && [subset]

RETURN FORMAT:
- files changed
- tests added
- gate tail (last 20 lines)
- blockers (if any)

MAX: 40 tool calls. If blocked, return partial + blocker — do not loop.
```

For **SCOUT** (optional, one agent):

```
Read ONLY vision.md §3 and [one package]. Return gap table: tier | file:line | scenario | test?.
≤20 tool calls. No subagents. No commits.
```

---

## Recommended skill/doc edits (future round)

1. `autonomous-loop/SKILL.md` — narrow description triggers
2. `tier-completion-orchestration-plan.md` — remove "Do NOT read autonomous-loop" from template; add CONTEXT DIET
3. `CLAUDE.md` — add: *"Subagents: skip § READ THESE FIRST unless orchestrator passes explicit paths"*
4. `AGENTS.md` — keep orchestration routing (Grok plan / Composer build), not anti-subagent ban

---

## Monitoring checklist

When subagents fail, log:

- [ ] Which skill matched?
- [ ] subagent_type (explore vs generalPurpose)?
- [ ] Tool call count before stop?
- [ ] Did user message arrive mid-run?
- [ ] Was conversation summarized?
- [ ] Retry count (should be ≤1)?
