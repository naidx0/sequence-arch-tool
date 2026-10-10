# Sequence — pitch deck (Cursor-readable)

> **How to view in Cursor**
>
> - **This file** — open here, then Markdown preview (`Cmd/Ctrl+Shift+V`). This is the format that actually loads in the IDE.
> - **HTML deck (Light + Navy)** — **deleted 2026-08-20** with the v1 marketing site it lived in. Its full-bleed figures were captures of the v1 UI being deleted at Wave 7, so it was retired rather than re-pointed. **This markdown file is the living source.**
> - **PDF** — **deleted 2026-08-26**. The old file still pointed at GitHub Releases / Task Board from the v1 era. Share this markdown (or rebuild a Graphite-era PDF later). There is no trysequence.app/pitch.pdf mirror while the marketing site is retired.
>
> Soft Sequence-first narrative · no locked pricing · no competitor name-dropping.

---

## 01 · Cover

# Sequence*

VS Code re-engineered for AI coding — the bridge between AI coding and system design.

Local-first · grounded · open source · clone + `./start.sh`

---

## 02 · Problem

### Architecture lives in chat threads and stale diagrams.

Text-only AI coding leaves the system map in your head. Whiteboards cannot prove an edge. Engineers re-draw maps by hand, ship guesses, and lose sync between code and design.

| | |
|--|--|
| **today** | chat on the left, system map in your head |
| **cost** | ungrounded plans, invisible dependencies, slow onboarding |
| **need** | one page where evidence and editing stay aligned |

---

## 03 · Product

### Local-first visual coding harness.

Familiar chat on the left. Grounded architecture board on the right. `.seqd` — a portable, agent-readable diagram IR — so text and drawing stay in sync. The harness is the heart of a gentler coding workflow: see the system, then change it.

| | |
|--|--|
| **shell** | chat alone by default · Architecture + Whiteboard on demand (web2) |
| **artifact** | `.seqd` native — Mermaid/SVG are projections |
| **sync** | draw on board → assistant adapts → doc updates |
| **agents** | monitorable workflows on the graph |

---

## 04 · Journey A — from scratch

### Start from scratch — plan becomes diagram.

Builder / vibe coder: visual-first when designing a new system.

1. Open Sequence → **chat alone** (no forced board). Composer works.
2. Ask: “I want to create an insurance company — what does that process look like?”
3. Left: assistant answer. Right: live SeqDiagram of the plan — not “go Export.”
4. Draw on the board to change the plan → assistant adapts → `.seqd` updates.
5. Export `.seqd` / SVG / Mermaid; run an agent workflow when ready to land files.

---

## 05 · Journey B — attach

### Attach a repo — day-one grounded overview.

Staff engineer on a sensitive repo: local attach, honest scan, exportable brief.

1. Attach large repo locally — no key wall.
2. “Explain this repository to me.”
3. Board shows services, flows, subsystems in plain English.
4. Export a `.seqd` brief for teammates and agents.
5. Latency ask → agent workflow with harness-visible steps.

---

## 06 · Moat

### Six things that do not copy-paste.

1. **Visual-first harness** — chat and grounded board on the same page.
2. **Grounded** — every edge from real evidence when a repo is attached.
3. **`.seqd` native** — IR is the collaboration artifact; board is the experience.
4. **Draw ↔ chat sync** — drawing updates assistant context and doc.
5. **Agent workflows on the graph** — monitorable, local, model-agnostic.
6. **Graphite craft** — brand-true product surfaces (`docs/brand/graphite/`), not stock UI.

---

## 07 · Local-first

### No login wall. No key wall.

Core value works offline on your machine. Scan, architecture board, whiteboard, and files rail are path-jailed to your project. There is no web2 Terminal pane yet. AI is optional — Settings → Connect AI when you want it.

| | |
|--|--|
| **scan** | local analyzer — compose + source evidence |
| **keys** | under `.sequence/` — never uploaded |
| **status** | “local-first — no key” always honest |

---

## 08–09 · Product shots

**No living captures in this deck yet.** v1 ProductShell / HTML-deck figures were deleted with the marketing site (2026-08-20). Do not imply shots are present. When Graphite-era screenshots exist, put them here; until then share the app via `./start.sh` and [`docs/w5-journeys-web2.md`](../w5-journeys-web2.md).

---

## 10 · Get it

### Run Sequence locally.

Clone the repo and run `./start.sh` (macOS/Linux) or `.\start.ps1` (Windows). Grounded maps, draw-to-chat, and agent workflows — on your machine, with no upload. There is **no public desktop download** yet (unsigned Electron builds exist for engineers under `packages/desktop`; do not advertise them as a release).

- [GitHub](https://github.com/naidx0/sequence-arch-tool) — source · `git clone` then `./start.sh`
- See [`docs/w5-journeys-web2.md`](../w5-journeys-web2.md) for the one true socials sentence

---

*Sequence · open source · local-first — no key*
