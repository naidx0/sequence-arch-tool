# Chat → Canvas live visualization — gap list

**Owner target (2026-08-27):** Users react like *“Codex’s visualization got really good”* — real, fast, efficient tool calling and drawing, visible side-by-side with chat so they can reason in real time.

**Pick sheets:** [`chat-canvas-live-ledger.html`](chat-canvas-live-ledger.html) (today vs target) · [`thinking-loading-fusion-ledger.html`](thinking-loading-fusion-ledger.html) (**pick 1** — braille + wash on reasoning row only)

**Locked contract:** [`ai-canvas-tool-contract.md`](ai-canvas-tool-contract.md) · **Archify borrow map:** [`archify-competitive.md`](archify-competitive.md)

---

## What ships today (post PR #134 — L3–L5)

| Piece | Status |
|-------|--------|
| Chat + AI Canvas **split view** | ✅ `WorkspacePane` when Chat + AI Canvas tabs open |
| **Ask SSE** + work rows in transcript | ✅ `tool:start` / `tool:done`, file reads, topology proposals |
| **`canvas:block` stream event** | ✅ api-types + askPipeline |
| **Canvas doc in session store** | ✅ `session.canvasDoc` + reducer |
| **Tool execution for `canvas.write_*`** | ✅ ask tool loop when AI Canvas surface / diagram intent |
| **Real-time block render** | ✅ `ConnectedAiCanvas` + live highlight |
| **Auto-split on first block** | ✅ host command opens Chat + AI Canvas |
| **AiCanvas ledger UI** | ✅ icons, `Type · title`, mono status, mermaid box |
| **Thinking motion (fusion pick 1)** | ✅ braille reasoning row + row-scoped wash; glimmer + glyph pulse on reads; **no AgentRunBar** |
| **Five canvas tool schemas** | ✅ `canvasTools.ts` + write tests |
| **Phase card** | ✅ Wave L4 — live tool + crumb + timer |
| **Turn elapsed** | ✅ Wave L4 — “Worked for Ns ›” at turn top |
| **Edit ledger strip** | ✅ Wave L4 — +/− summary from proposals |
| **Canvas persist to disk** | ✅ `.sequence/sessions/<id>/canvas.json` + `/api/canvas-doc` |
| **HTML / React viewers** | ✅ Wave L3/L5 — sandbox iframe + full React mount |
| **Point-to-ask on canvas block** | ✅ Wave L5 — block header → composer chip |
| **Archify HTML export** | ✅ Wave L5 — one-click portable HTML |
| **Guided story routes** | ✅ Wave L5 — `canvas.set_story_route` + in-canvas nav |

---

## Target behavior (user-seat Done when)

1. User asks a question that implies a diagram or plan (“map blast radius”, “draw the flow”).
2. **Chat + AI Canvas split opens automatically** (or stays open if already split).
3. Chat shows:
   - Turn elapsed (“Worked for 12s ›”) — **✅**
   - **One** live phase line for the current tool — **✅**
   - Inline work rows (fusion pick 1) — **✅**
   - Collapsed edit summary when files change — **✅**
4. **Canvas updates within one frame** of each `canvas.write_*` completing — **✅** (vitest + store)
5. On turn end, canvas doc persists; reload restores blocks — **✅**

---

## Wave L1 — Wire ✅ (merged PR #131)

**Done when:** Split view shows blocks landing while turn streams — **met** (store tests + ConnectedAiCanvas).

---

## Wave L2 — Motion ✅ (fusion pick 1, PR #132)

| Task | Status |
|------|--------|
| Drop AgentRunBar; live reasoning = inline tool row | ✅ |
| Braille orbit on reasoning row | ✅ |
| Accent wash on reasoning row only | ✅ |
| Glimmer on all live labels + glyph pulse on reads | ✅ |
| Block `live` CSS on AI Canvas | ✅ (L1) |
| `prefers-reduced-motion` fallbacks | ✅ |
| Phase card (Codex compact card) | ✅ (L4) |

---

## Wave L3 — Full five writers ✅ (PR #133)

Per `ai-canvas-tool-contract.md`: HTML sandbox, SVG inline, React bounded preview, markdown, mermaid.

Each writer: schema test (exists) + viewer test.

---

## Wave L4 — Polish ✅ (PR #133)

| Feature | Status |
|---------|--------|
| Turn-level elapsed | ✅ |
| Phase card (named current tool + timer) | ✅ |
| Edit ledger strip | ✅ |
| Canvas persist + reload | ✅ |
| Point-to-ask on canvas block | ✅ Wave L5 |
| Architecture vs AI Canvas routing | ✅ (topology → board; artifacts → AI Canvas) |

---

## Wave L5 — Archify parity ✅ (PR #134)

| Feature | Status |
|---------|--------|
| Point-to-ask on block | ✅ chip + composer focus |
| Self-contained HTML export | ✅ `downloadCanvasHtml` |
| Full React mount | ✅ `@babel/standalone` + `createRoot` |
| Guided story routes | ✅ `canvas.set_story_route` + `CanvasStoryNav` |

---

## Non-goals (keep surfaces honest)

- **Architecture board** stays scan-grounded (`.seqd`, ELK) — not freeform AI stickies.
- **Whiteboard** stays human ink.
- **AI Canvas** is typed blocks only — five native writers, closed set.
- No fake progress — every row and block traces to a real `tool:start` / `canvas:block`.

---

## Manual test checklist

1. `pnpm build && pnpm app -- --repo /workspace --no-open --port 4173`
2. Open Chat; ask with AI Canvas tab or “draw a mermaid flow for auth”
3. Confirm split opens; canvas blocks land with icon headers + live glow
4. Confirm reasoning row: braille spinner + indigo wash (not full column)
5. Confirm live phase card + turn elapsed tick while streaming
6. Confirm edit ledger when model proposes file changes
7. Reload — canvas blocks restore from session
8. HTML/React blocks render in sandbox viewers (not raw `<pre>`)
9. Click **Ask about this** on a block — chip lands in composer
10. **Export HTML** downloads a portable artifact with story nav when set
11. Story route steps scroll/highlight the active block

---

## Relation to Codex screenshot

| Codex | Sequence |
|-------|----------|
| Environment provisioning card | Phase card tied to active tool (**✅**) |
| Visualization / workspace panel | **AI Canvas** block stream (**✅**) |
| File diff summary | Edit ledger under work rows (**✅**) |
| Side-by-side chat + workspace | **Split view** (**✅**) |
| Fast tool feedback | SSE `canvas:block` + fusion pick 1 rows (**✅**) |

The reaction we want is the same: *I can see what it’s doing, it’s fast, I can reason with the visual while the model works.*
