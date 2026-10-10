# Public beta + Replace Cursor — program MADR

**Status:** Accepted (owner 2026-08-12) · **Branch:** `mxcr/public-beta-replace-cursor-229d` · **Base:** tip `main` @ Main Agent Moat merge (#60)

## Context

Owner wants Sequence as a **full public beta** people can download/use from socials, and as an **entire coding tool** that replaces Cursor — not a soft “visual companion” beta.

**Ambient shell (definition):** a ProductShell command seat where the agent (and user) can run real repo commands under approval/allowlist — equivalent to Cursor agent bash / integrated terminal — not only Craft/harness verify nodes.

**Agent window (photo):** Cursor-like org — sessions/repos stack · chat/agent work · tools/plan/git — mapped onto Sequence chrome **chat | board | Index** (sessions densify in chat; Changes/Tools/command log on Index/Programs). No VS Code outer-column redesign.

## Decision

1. **Public beta bar** = planned capabilities executed + install/deploy path + trial docs + site CTA for download/start — Track G **in program** (no longer parked as “don’t touch”).
2. **Replace Cursor bar** = ask-native tools (read/search/edit propose/git/command/MCP) + Accept/Deny writes + Index git + denser agent window + visual board moat.
3. **No ambient unrestricted PTY** in v1 beta — approval-gated allowlisted `run_command` + visible command log (Cursor parity for agent work without shell injection). Expand allowlist as owner walks demand.

## Why soft-beta before

| Gap | Why “not Present” | Fix in this program |
|-----|-------------------|---------------------|
| Tool loop fence-only | Provider returns text; hopes for ````sequence-tool` | Structured tools + stronger hint; propose_files / run_command / git_* |
| Edit hope-JSON | Accept only if answer contains `{files:[]}` | `propose_files` tool → SSE `edit:proposal` → FileEditProposalBar |
| Git/MCP Index-only | Human clicks Index; agent can’t call | Ask tools wrap gitWorkspace + mcp call |
| No shell | Verify allowlist only inside Programs | ProductShell command seat + ask `run_command` |
| Sessions thin | `<select>` / basic stack | Repo-grouped Recent stack (agent window left) |
| Track G oob | Hosted/signing parked | Install path + site Get Sequence + release notes; hosted kick documented |

## Waves

| Wave | Done when | Owner |
|------|-----------|-------|
| W0 | #60 on `main` (owner can test tip) | **done** |
| W1 | `propose_files` + `run_command` + `git_status`/`git_diff` ask tools; SSE edit:proposal; client wires bar | **done** (branch) |
| W2 | ProductShell command log seat (allowlist gate) + ask `call_mcp` + SSE `command:log` → Index Commands | **done** (branch) |
| W3 | Agent window: sessions by repo/Recent densify; Index Tools/Changes remain | **done** (branch) |
| W4 | Public beta pack: README/trial, site download CTA, `sequence doctor`/start path, HANDOFF release checklist | eng (trial doc + site CTA present; release assets / socials send = owner) |
| W5 | Owner walk sign-off Journey A/B + daily-driver ask→tools→Accept→commit→test command | owner — **blocking claim** |

## Consequences

- Final-plan Track G row moves from Out-of-band → **In program (public beta)**.
- Soft-beta language retires once W1–W4 green + W5 owner walk.
- Background agents / unrestricted PTY remain out of scope for this beta (document honestly on trial page).
