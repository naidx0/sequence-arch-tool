# Tier-2 UX decisions (P2 / loop r197)

- **Status:** Accepted (verify docs) — grounded in shipped code
- **Phase:** `tier-completion-orchestration-plan.md` Phase 2 (T2-a … T2-h)
- **Related:** ADR-012 · `productFinalWiring.test.ts` · `packages/export/src/mermaid.ts`

This MADR records the **documentation-complete** bar for tier-2 UX & comparability
(`vision.md` §6). Code for these items already shipped; P2 VERIFY locks the decisions in prose
so later phases do not re-litigate them.

---

## T2-d — Try chip dedup → ADR-012 Option C

**Decision:** Ask vs map role split (`tryChipsForRole`). Arch strip shows **map** sketches;
Assistant idle strip shows **ask** questions. No cross-role borrow.

See [`docs/adr/ADR-012-try-chip-dedup.md`](../adr/ADR-012-try-chip-dedup.md).

**Locks:** `tryChipsModel.test.ts`, legibility stops `arch-try-strip` / `assistant-idle-try`.

---

## T2-e — Mermaid bar: export cap (not owner aesthetic sign-off)

**Decision:** Document the export cap rather than waiting on owner aesthetic sign-off for
"Mermaid bar complete."

| Fact | Source |
|------|--------|
| Cap | `MAX_MESSAGES = 40` in `packages/export/src/mermaid.ts` |
| Honesty | Leading Mermaid comment: `%% 40 of N calls shown — closest to entry: …` |
| Behavior | Messages closest to entry kept; never silent truncation |
| Empty | `%% no service-level interactions found in this scan` |

Shipped in **r95** (`loop-log.md`, `mermaidSequence.test.ts`). Owner feedback remains that
quality is "on the right track" (`owner-feedback-log.md`) — the **product bar for P2** is
honest capping + depth-ordered participants, not Pixel-perfect Mermaid beauty. Further polish
is optional and does not block tier-2 100%.

**Locks:** `packages/export/src/mermaidSequence.test.ts` · `export-diagram.mjs` (when Chromium present).

---

## T2-f — English graph BYO path

**Decision:** Live native-English annotate is a **BYO-key** verify path, not a free-hosted claim.

Manual checklist (also in `productFinalWiring.test.ts` header):

1. `pnpm build` then `pnpm app -- --repo <abs-path>` (or attach from Home).
2. Settings → **Connect AI** → **Use your own API key** → provider → Save.
3. Architecture board: `PlainCanvas` calls `fetchExplain` + `fetchAnnotations`
   (`aiClient` → `POST /api/explain`, `/api/annotate`).
4. Badge → **AI-labeled** when explain mode is `ai`; card bullets / breakout `fileSubtitles`
   fill from `nodeAnnotations`.
5. Click a service → MADR breakout → confirm English subtitles on files.
6. Optional: Assistant ask with selection — cites evidence or "not in scan".

Free hosted default stays undeployed (`FREE_TIER_NOT_LIVE_MSG`). Structure without a key remains
available (local-first).

**Locks:** `productFinalWiring.test.ts` F1 wiring contracts.

---

## T2-h — Cursor parity: shipped vs honest gaps

### Shipped (wired + locked)

| Capability | Where | Lock |
|------------|-------|------|
| Write MADR gateway card | `buildMadrGateway` · Open on demand | r120 in `productFinalWiring` |
| Research brief + Promote to Build | `buildResearchBriefGateway` · `board-gateway-promote` | r120–r121 |
| Live research fetch+cite | `POST /api/research` · BYO key | r121 |
| Decision pack (MADR + notes) | `buildDecisionPackGateway` · `DECISION_PACK_ACTION` | r122 |
| Multi-file Accept gate | `applyMultiFileProposal` · `checkMultiFileProposal` · path jail | r122 |
| Checker before write | `checkGraphMutation` + policy checker on accept | F4 / G-E |

### Honest gaps vs Cursor Agent (do not claim shipped)

| Gap | Why it matters |
|-----|----------------|
| No streaming multi-edit UI | Cursor streams hunk-by-hunk; Sequence applies via gateway Accept after checker |
| No inline diff hunk review | Open-each file + Accept overwrite; not a side-by-side diff rail |
| No general coding agent loop | Sequence is graph/architecture-first; Programs/ACP cover bounded workflows, not IDE chat-as-editor |
| Free hosted gateway undeployed | BYO works; `FREE_TIER_NOT_LIVE_MSG` is honest |
| BYO per-call model on free gateway | Advisory / incomplete vs Cursor model picker everywhere |

**Tier-2 bar:** document decision pack + multi-file accept as shipped; keep the gap list above
visible in product docs. Closing gaps is **not** required for P2 100%.

---

## Other T2 checklist items (code already landed)

| ID | Status | Note |
|----|--------|------|
| T2-a G3 zoom floor | Shipped | `fitViewOptions` minZoom · `groupedCanvas.zoom.test.ts` |
| T2-b breakout map | Shipped | Line number + scroll stop |
| T2-c G4/G15 cosmetic | Shipped | TALKS TO + copy |
| T2-g Copilot proposal legibility | Shipped / in-flight per wave | Legibility stop for proposal + steps |

---

## Consequences

- Phase 2 VERIFY (r197) treats T2-e/f/h as **docs-complete** when this file + ADR-012 are
  committed — no further code required for those IDs under the orchestration plan.
- Owner aesthetic Mermaid sign-off and Cursor-parity stretch goals remain **optional / P6+**,
  not tier-2 blockers.
