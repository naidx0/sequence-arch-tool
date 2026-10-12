# MADR — Model roles (local default + advisor + vision)

**Status:** Accepted (owner request 2026-08-15) · **Date:** 2026-08-15  
**Canon:** [`product-final-plan.md`](../product-final-plan.md) (amended same PR)  
**Inspiration:** [omp / Oh My Pi](https://omp.sh/) (`can1357/oh-my-pi`) — **not** a clone of the terminal harness.

## Context

OMP exists to make **local models usable**. One frontier model doing every turn is
expensive; one local model doing planning, review, vision, *and* the work is
dumb. OMP splits **intent into roles**:

| Role | Job | Typical model |
|------|-----|----------------|
| `default` | Hands — most tokens, tools, edits | Local (Ollama / LM Studio) |
| `advisor` | Watches each worker turn; injects aside / concern / blocker | Frontier (mostly **reads**) |
| `vision` | Image turns only | Cheap/free OpenRouter (e.g. GPT-5.6-Luna) |
| `plan` | Work-mode structuring | Stronger than default, still not the reviewer |
| `task` / `smol` | Subagent fan-out | Cheap |

The cost trick: an advisor that **reads** the worker and writes a short note is
~1/20th the spend of asking the frontier model to *do* the work. Local default
stays private. Vision stays off the hot path.

Sequence is a **visual workbench**, not a terminal agent. We take the **cost
architecture and goal DAG**, not LSP/DAP/eval/ttsr/collab.

## Decision

| # | Question | Choice |
|---|----------|--------|
| 1 | Default | Existing Connect AI **Model** is the worker. Local OpenAI-compat is first-class. |
| 2 | Advisor | Optional second binding (own model / host / key). After each ask, if bound and **not** the same endpoint as default, a read-only JSON pass runs. Failure **skips** (never fails the ask). |
| 3 | Vision | Optional binding persisted. **Not called on text-only turns.** Image turns are UNFINISHED until chat can attach a picture. |
| 4 | Plan | Optional. Work `jobMode` uses `plan` when set, else default. |
| 5 | Keys | Per-role key/host allowed so local default + OpenRouter advisor is real. Never returned unredacted. Missing role fields **inherit** default. |
| 6 | Local-first | No advisor / no key ⇒ chat and board still work. Roles are additive. |
| 7 | Goals | Work **goal network** is process Architecture (`diagramFamily: process`, origin `design`/`chat`) plus Task Board cards. Not a scanned service map. Not fake parallel agents. |
| 8 | Subagents | ACP “Local coding agents” stay the spawn path. Goal nodes do **not** auto-fork worktrees in this wave. |

## Honesty

- Advisor is a second billed call. We say so. We do not pretend the local model “became GPT.”
- Same model+host as default ⇒ skip advisor (it would just echo).
- Vision field is storage + UI, not a working camera, until image turns exist.
- Goal network nodes are plan objects, never `origin: scan` unless a repo was actually scanned.

## Locking-test shapes

- `validateAiConfig` accepts `roles.advisor.model`; redacts advisor `apiKey` to `••••last4`.
- Advisor consult runs after the worker when bindings differ; worker text still returns if advisor throws.
- Plan Tasks → Goal network parent + children with `goal:` ids; empty Architecture may be seeded as process family.
- Connect AI source contains `ai-role-advisor` and `ai-role-vision` fields.

## Non-goals (this wave)

OMP LSP/DAP/native-rs, `/collab`, time-traveling stream rules, automatic worktree
subagents, OpenRouter `openrouter:advisor` server tool as the only path.
