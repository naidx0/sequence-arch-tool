# Named shopfront bake-off (fundraising paste)

**Owner quote:** Sequence versus Claude Code, OpenCode, Cursor CLI, Codex, Hermes — specific tests, how we ranked — for the site and for capital. No more “file-stuffing agent blah blah.”

**User-seat Done when:** Cover + pitch name the products and the numbers we ran (our game) and the numbers they publish (their game, dated, not our run). Sequence shopfront edges stay **15/15**.

**Inverted-fix ban:** Do not label our 200k source-dump as Claude Code. Do not put Sequence on SWE-bench / Artificial Analysis without a Sequence run. Do not mix Cursor’s 1281, OpenCode’s 18,400, and Sequence’s 3073 on one bar without naming the unit. Do not invent Claude Code / Codex / Hermes-agent shopfront scores. Do not write “50% cheaper.” Do not rewrite cover **3073** to 2924.

Raw harness + JSON: [`named-harness-shopfront-game-b.md`](named-harness-shopfront-game-b.md). Dump-fill (this repo, 73 files → 200k) is a different chart, on docs only, unlabeled as Claude Code.

---

## Our game (we ran · 2026-08-13)

**Fixture:** `packages/analyzer/test/fixtures/shopfront`  
**Ask:** “Explain how orders reaches payments and postgres.”  
**Needles:** orders→payments **http** · orders→postgres **db** · gateway→redis **must not be claimed**

| Name | What we launched | Tokens (unit) | Needles |
| --- | --- | --- | --- |
| **Sequence** | `buildAskPrompt` shopfront | **3073** cover assembled prompt (`approxTokens`) | Map has the edges; scanner **15/15** vs `ground-truth.json` |
| **OpenCode 1.18.18** `opencode/big-pickle` | `npx opencode-ai run` | **18400** CLI `usage.input` (200k-bucket live-path row) | **3/3 grounded** |
| **This Cursor cloud session** `cursor-grok-4.6-high` | live-path Read/Grep | **1281** `approxTokens` of eight files opened (not a billing meter) | **3/3 grounded** |

OpenCode billed **15784–24144** across 50k–200k haystack buckets; the cover uses the **18400** 200k-bucket row already in git. Sequence after subgraph is **2924** (different run — do not put that on the cover).

### Units glossary

| Number | Meter | Do not read as |
| --- | --- | --- |
| OpenCode **18,400** | That CLI’s `usage.input` (system + dump), live-path | A 200k window fill; “they stuffed 200k” |
| Cursor session **1,281** | File bodies this agent opened (`chars/4`) | Cursor billed input; “Cursor is cheaper therefore better” |
| Sequence **3,073** | Assembled architecture-board prompt | Eight files; OpenCode’s invoice |

1281 vs 3073 is not a winner on tokens. Sequence’s number is the **map**. Cursor’s is eight files. OpenCode’s is system + dump.

---

## Their game (they publish · not our run)

Artificial Analysis Coding Agent Index **v1.3**, retrieved **2026-08-13**, same-model Opus 4.7 (medium). Snapshot: [`docs/research/data/aa-coding-agents-snapshot.json`](data/aa-coding-agents-snapshot.json). Sequence is **not on that index**. Do not draw a Sequence bar there.

| Product | Tests they advertise | Public numbers (cite, not our run) |
| --- | --- | --- |
| Claude Code | SWE-bench Verified, Terminal-Bench, OSWorld | AA DeepSWE **27** · TB v2 **71** |
| Cursor CLI | CursorBench (private), SWE-Multi, TB 2.0 | AA DeepSWE **32** · TB v2 **71** |
| OpenCode | OpenCode Bench, SWE/TB runners | AA DeepSWE **40** · TB v2 **75** |
| Codex | SWE-Bench Pro, TB 2.0, Expert-SWE | GPT-5.5 SWE-Pro 58.6% / TB2 82.7% (vendor cards) |
| Hermes agent (Nous) | TB2 / SWE envs in-repo | No vendor-advertised % |

None of those tests are Game B (typed architecture edges). Do not run Sequence on SWE-bench to fake a rank.

---

## Replay

```bash
# Sequence assembled prompt (cover 3073 is the 200k-bucket run; do not substitute 2924)
# Scanner edges:
#   sequence score packages/analyzer/test/fixtures/shopfront
#   → 15/15 vs ground-truth.json

# OpenCode live-path (needs the named harness; 200k-bucket row is 18400)
node tools/bench/named-harness-shopfront-game-b.mjs
# model: opencode/big-pickle · CLI usage.input is the billed number, not haystack fill

# This Cursor session: list → grep → read on shopfront (no extra key).
# Do not treat CURSOR_AGENT as Cursor CLI `agent -p`.
```

Claude Code CLI still needs Anthropic `/login` or `ANTHROPIC_API_KEY`. Cursor CLI still needs `CURSOR_API_KEY` + `agent -p`.

---

## UNFINISHED (parked — do not fake)

| Name | Why parked | Resume when |
| --- | --- | --- |
| Claude Code CLI on shopfront | Binary runs; not logged in (`input_tokens: 0`) | Anthropic `/login` or `ANTHROPIC_API_KEY`; same harness |
| Cursor CLI `agent -p` | Not on PATH; no `CURSOR_API_KEY` | Separate from this cloud session |
| Codex CLI | Not launched | Codex binary + key |
| Hermes-agent as opponent | Only Sequence empty-board 1312 vs dump ~14k | Nous `hermes-agent` CLI on shopfront |
| Sequence on SWE-bench / TB / CursorBench | Wrong game for this product | Only if owner wants Sequence+ACP *driving* a coding agent on their eval |
