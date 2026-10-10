# C3.1 — Desktop inventory (cloud vs owner Mac)

**Status:** measured inventory · **Program:** mega-plan §5 Phase C · **Item:** C3.1  
**Rule:** public CTA stays clone + `./start.sh` until signed release assets exist (D7). Do not tip-bump HANDOFF here.

Cross-links: `packages/desktop/README.md`, `tools/desktop-smoke.mjs`, [`phase-d-public-beta-gate.md`](phase-d-public-beta-gate.md) D7, AGENTS.md desktop note.

## What `@sequence/desktop` is

Electron shell around the same stack as `./start.sh`: spawns `packages/analyzer/dist/cli.js`, loads `packages/web2/dist`, adds a **native folder picker** (bypasses the browser `$HOME` jail). No second server.

## Commands

| Command | Role |
|---------|------|
| `pnpm --filter @sequence/desktop build` | `tsc` → `dist/` |
| `pnpm --filter @sequence/desktop test` | 11 headless tests (no window) |
| `pnpm --filter @sequence/desktop prepare-server` | deploy analyzer + copy web2 → `server-bundle/` |
| `pnpm desktop` / `pnpm desktop:dist` | Electron window / electron-builder installers |
| `node tools/desktop-smoke.mjs` | Real window boot gate (needs GUI + Electron binary) |

Electron JS installs with pnpm; the ~186 MB binary may need `node packages/desktop/node_modules/electron/install.js` (or `pnpm approve-builds`).

## Platforms (`electron-builder.yml`)

| OS | Targets | Evidence |
|----|---------|----------|
| Windows | NSIS x64 | README: verified on Windows 11 |
| macOS | dmg + zip (arm64 + x64) | Config only — not smoke-verified in-repo |
| Linux | AppImage + deb | AppImage can build in cloud; deb needs package metadata; window smoke unreliable |

## Cursor Cloud (measured)

- Headless unit tests + `tsc` + packaging **logic** tests: OK.
- Electron binary: fetchable via `install.js` on current cloud VMs (older “403 forever” claims can be stale).
- **Window smoke fails / does not settle** in headless cloud — not a packaging-logic red.
- Default agent boot is `pnpm app -- --no-open` — **not** desktop.
- CI does not require desktop-smoke; hygiene locks packaging invocation only.

## Owner Mac / Windows

- Mac: `pnpm desktop` / `desktop:dist` expected for engineers; notarization + icons = owner later (C3.5).
- Windows: strongest verified installer path in repo docs.
- Signing / GitHub Releases / marketing download CTA: **owner lane**, not agent-blocked code.

## Honest CTA (binds C3.2 / D7)

**Public:** Clone and run `./start.sh` (or `.\start.ps1`). No “download Sequence” until signed assets + Seat Gate evidence.

**Engineers:** optional unsigned desktop after Electron binary fetch + `pnpm build && pnpm desktop`.

**Cloud agents:** use browser stack (`pnpm app -- --repo … --no-open`); do not treat desktop-smoke green as a cloud gate.

## Exit for C3.1

- [x] Inventory written and indexed (this file)
- [ ] C3.2–C3.4: install path vs clone honesty, notifications E2E, auto-update policy (owner/ops)
- [ ] C3.5 code-signing: owner-later
