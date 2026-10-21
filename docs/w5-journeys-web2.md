# W5 Journey A/B — web2 rewrite (P7)

**Status:** living · **Surface:** `packages/web2` only · **Started:** 2026-08-26  
**Purpose:** Owner Journey A/B walks rewritten for the Graphite rebuild. Do **not** cite `packages/web`.

Owner sign-off of these walks is still **required** before any “replaces Cursor” / public-beta social claim (`docs/decisions/public-beta-replace-cursor-madr.md` W5). Until signed, treat walks as the **script**, not the claim.

---

## Socials — one true sentence (until desktop assets ship)

> Clone the repo and run `./start.sh` (macOS/Linux) or `.\start.ps1` (Windows) — Sequence is local-first; bring your own AI key when you want chat.

Do **not** advertise a downloadable desktop installer on socials until release assets are published and Seat Gate 4 is green. Unsigned Electron builds exist under `packages/desktop` for engineers; they are not the public path yet.

---

## Journey A — from scratch (blank → grounded)

| Step | User-seat Done when (web2) |
|------|----------------------------|
| 1 | Cold boot opens **chat alone** (no forced board). Sessions label visible. |
| 2 | Attach a compose/K8s/Helm repo (or `--repo`) → Architecture graph draws from scan evidence. |
| 3 | Ask a grounded question → answer cites files/lines or says not-in-scan. |
| 4 | Select a node → context chip / ask carries selection. Draw toggle works on Architecture when whiteboard doc allows. |
| 5 | **Review** opens for proposals; Accept writes through jail. Optional: Start a workflow → Activity author → real `POST /api/program/run`. |

**Gate evidence:** Seat Gate 1 video + Seat Gate 4 cold install (when run).

## Journey B — attach existing (explain this repository)

| Step | User-seat Done when (web2) |
|------|----------------------------|
| 1 | Attach shopfront (or real repo) → services/datastores/topics readable on Architecture. |
| 2 | Files & functions rail: click a function → canvas re-sorts / flow playback. |
| 3 | External edit → rail **Not tracking** + **Retry** → rescan clears stale (Seat Gate 3). |
| 4 | Settings → Workspace: Tool permissions editor + Autonomy opt-in; Notifications “Tell me when a run finishes”. |
| 5 | Activity: curated built-in or freeform start; Pause / Resume / Waiting on you (Seat Gate 2). |

**Gate evidence:** Seat Gates 2–3 artifacts on the finish-open mega PR.

---

## Explicitly not in these walks

- Browser / Terminal / AI-canvas panes (disabled until shipped).
- Wave 6 hierarchical nesting (CUT).
- Hosted free AI tier (undeployed — BYO key only).
- Competitor A/B bars (P6 stays **UNVERIFIED** until owner measures).
