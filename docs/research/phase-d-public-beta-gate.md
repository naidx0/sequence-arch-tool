# Phase D — public beta gate (checklist)

**Status:** open · **Program:** mega-plan §6 (Phase D)  
**Rule:** no “public beta” claim until every row is evidenced. Owner-owned metrics and walks stay empty until filled — do not invent green.

Cross-links: [`phase-a-dogfood-scorecard.md`](phase-a-dogfood-scorecard.md) (M1–M7), [`../feature-honesty.md`](../feature-honesty.md) (D1 walks), FINISH-OPEN honesty.

| ID | Gate | Owner / evidence | Status |
|----|------|------------------|--------|
| D1 | Rewrite W5 owner walks for **web2** | Owner + `feature-honesty.md` | open |
| D2 | Seat Gates 1–3 videos current on tip | Owner walk videos | open |
| D3 | M1–M5 green for 2 consecutive weeks | Fill Phase A scorecard weeks | open (scorecard template only) |
| D4 | No lying Settings/CTA copy (free-tier, Browser, Terminal, MCP) | Code: Browser pill + `fetch_url`/`/api/net-fetch`; Terminal pill+composer; plugins + MCP belt copy honest; `d4WorkspaceCtaHonesty.test.ts` | code LANDED — owner walk videos OWNER |

| D5 | Marketing site reconnect or disconnect ghost Vercel | Owner ops | open |
| D6 | Socials one-liner is a **true** sentence only | Owner | open |
| D7 | Desktop assets **or** honest clone path only | Owner / desktop lane | open |
| D8 | Owner sign-off checklist in HANDOFF tip-bump | Docs lane **after** feature merge | open |

## D4 code notes (this mega PR)

- Composer / workspace: Browser is a workspace pill (`chromeTabModel.WORKSPACE_PILLS`) with `BrowserPane` + `/api/net-fetch` and a composer control (`composer-browser`). Terminal is a workspace pill and composer control when `onOpenTerminal` is wired.
- Settings plugins row no longer claims ask is unwired — `call_plugin` is live (`askWired: true`).
- Ask belt: MCP servers copy points at Settings editor (not “does not edit that file yet”).
- Locking: `packages/web2/src/app/d4WorkspaceCtaHonesty.test.ts`, `App.test.tsx` workspace menu, `SettingsPanel.test.tsx` free-tier copy.

## Exit

- [ ] D1–D8 evidenced (not aspirational)
- [ ] Tip-bump HANDOFF only after feature merge (docs lane; merge-lanes)
- [ ] No marketed % wins without bakeoff rows
