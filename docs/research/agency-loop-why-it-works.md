# Agency loop — why it worked, why it was failing

**Date:** 2026-08-04  
**Audience:** Max (owner) + future orchestrators  
**Companion skill:** `.cursor/skills/agency-loop/SKILL.md` (also `~/.cursor/skills/`)

---

## The chat that worked (pattern)

Parent narrates like this:

1. Read handoff / vision / open queue → **triage** feasible vs owner-blocked
2. One mega branch, baseline gate
3. Waves (Site → Eng → UX → QA)
4. Each slot: **Composer 2.5** BUILD with a named task → **Completed**
5. Light metrics: explored N files, ran M commands
6. Commit cluster → push → **one PR**
7. No mid-loop "should I continue?"

That is orchestration theater that stays honest: the expensive model decides;
the builder executes; the user watches one PR.

---

## Why new chats felt broken

| Symptom | Root cause |
|---------|------------|
| Subagents Stop constantly | CONTEXT BOMB — mandatory CLAUDE.md "read these first" (~many docs) before any work |
| "Waiting for subagent" forever | Explore swarm died; parent never synthesized |
| Skill loads wrong playbook | Saying "gap" / "audit" matched `autonomous-loop` → critic swarm |
| Agency "fails often" | Parallel overlapping explorers + user messages cancelling children |
| Output doesn't look like the mega chat | Parent implementing instead of narrating waves; no Completed lines |

Diagnosed in detail: [`subagent-failure-diagnosis.md`](subagent-failure-diagnosis.md).

---

## What we changed so it stays fixed

1. **`agency-loop` skill** — universal playbook; explicit invoke phrases; bans swarms
2. **`autonomous-loop` description** — overnight language only (already tightened r211)
3. **CONTEXT DIET** — required in every BUILDER prompt
4. **Model routing** — Grok/session plans · Composer builds (owner preference)
5. **Install path** — `~/.cursor/skills/agency-loop` for all projects + repo vendor copy

---

## How to invoke forever

| You say | Agent does |
|---------|------------|
| `agency loop` | Load agency-loop skill; mega branch; Composer waves |
| `gap analysis` / `what's left` | Parent reads (or 1 scout) — **no** swarm |
| `run autonomous loop overnight` | autonomous-loop skill (critic rounds) |
| Single file fix / one Grep / one-liner | **No skill, no subagent** — parent does it |
| Multi-phase + parallel file ownership | Agency loop BUILD waves |

**Owner rule (2026-08-04):** like subagents for orchestration, but not for simple
tasks that need no parallel optimization — search alone, single-line edits, and
solo planning stay in the parent.

---

## Universal vs Sequence-only

| Artifact | Scope |
|----------|-------|
| `~/.cursor/skills/agency-loop/` | **All** Cursor projects on that machine |
| `.cursor/skills/agency-loop/` in repo | This repo + clones / cloud |
| User Rule paste (INSTALL.md) | Always-on hint in Agent |
| `.claude/skills/autonomous-loop` | Sequence overnight ratchet |
| `.claude/skills/orchestrated-build` | One big verified change |

Copy the skill to `~/.cursor/skills/` once; then every new project inherits the format when you say **agency loop**.
