# Archify competitive read — what to borrow for Sequence

**Source:** [tt-a1i/archify](https://github.com/tt-a1i/archify) (agent skill, 2026).  
**Pair with:** [`chat-canvas-live-gap.md`](chat-canvas-live-gap.md) · [`ai-canvas-tool-contract.md`](ai-canvas-tool-contract.md)

---

## What Archify is

Archify is an **agent skill**, not a product shell. It instructs a coding agent to:

1. Scan a repo into structured JSON (components, flows, stories).
2. Validate that JSON against a schema before rendering.
3. Emit a **self-contained interactive HTML** map (pan/zoom, routes, guided stories).

The output is a portable artifact — great for demos and one-shot explainers.

---

## Why it reads well

| Strength | Why users like it |
|----------|-------------------|
| **Instant visual payoff** | One HTML file opens anywhere; no install |
| **Guided stories / routes** | Click-through narratives, not just a static diagram |
| **Validate-before-show** | Broken topology does not render as if it were true |
| **Plain-English triggers** | “Map this repo” → artifact, low ceremony |

---

## What Sequence already has (moat)

| Sequence | Archify |
|----------|---------|
| **Grounded scan graph** from real manifests | LLM-inferred topology from code read |
| **Living workspace** — chat, boards, sessions, review | One-shot HTML export |
| **Local-first** — core works with no key | Skill + model dependent |
| **Honest coverage / evidence rows** | Presentation layer only |
| **Five typed AI Canvas writers** + Architecture board | Generic HTML output |

**Do not** treat Archify’s inferred graph as Architecture truth. Sequence’s board stays scan-grounded (`.seqd`, ELK).

---

## Borrow list → shipped / open

| Archify pattern | Sequence response | Status |
|-----------------|-------------------|--------|
| Self-contained HTML presentation | `canvas.write_html` sandbox iframe viewer | ✅ Wave L3 |
| Interactive story / route UX | `canvas.set_story_route` + `CanvasStoryNav` + export nav | ✅ Wave L5 |
| Validate before render | Server canvas tool schemas + block type gate | ✅ |
| Plain-English “draw/map” triggers | Ask + diagram intent opens Chat + AI Canvas | ✅ L1 |
| Export portable HTML | `downloadCanvasHtml` from session canvas doc | ✅ Wave L5 |
| Repo scan → visual in one turn | SSE `canvas:block` + phase card | ✅ L4 |
| File diff summary in chat | Edit ledger strip | ✅ L4 |
| Turn timing honesty | Turn elapsed + row timers | ✅ L4 |
| Persist artifact across reload | `.sequence/sessions/<id>/canvas.json` + `/api/canvas-doc` | ✅ L4 |
| React animated widgets | `canvas.write_react` full mount via Babel + bounded fallback | ✅ Wave L5 |

---

## Strategic stance

**Compete on:** grounded topology, session memory, edit/review loop, local-first trust, Codex-class live feedback (chat + canvas side-by-side).

**Borrow on:** presentation HTML, validate-then-show, compact phase card + ledger strips, portable export — **shipped Wave L5**.

**Ignore:** replacing the Architecture board with LLM-authored maps; duplicating Markdown with a sixth canvas writer.

---

## Shipped (Wave L5)

All four Archify borrow items from the post-#133 queue are on `main` via PR #134: point-to-ask, HTML export, guided routes, full React mount.
