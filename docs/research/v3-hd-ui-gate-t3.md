# V3 HD UI gate vs T3 Code (2026-09-14)

Owner ask: finish open V3, then gate Sequence against T3 Code for HD chrome quality
(contrast, glass, icons, soft-switch, empty/filled/narrow).

## Method

| Step | Result |
|------|--------|
| Clone | `pingdotgg/t3code` → `C:\Users\<user>\OneDrive\Documents\GitHub\t3code` (sibling; **not** vendored) |
| Sequence build | `pnpm --filter @sequence/web2 build` — green |
| Sequence locking | `vitest` `src/v3/V3App.test.tsx` — **21/21** (HUD, approvals, multi-open rim, overlays, effort, optimistic switch, context glass) |
| Reachability | `searchReached` + `helpTruthful` updated for V3 Cmd/Ctrl+K + overlay host — green |
| Full web2 suite | Still red on retired-Shell CSS locks (`Shell.test`, `App.test` palette hint, some Composer/board CSS specs) — pre-Decision-22 stub debt on `shell.css`; overlay/chat/rail CSS restored for wired surfaces |
| e2e | Playwright package not resolvable in this environment (`pw-no`); Chromium cache present but e2e scripts not run |
| Screenshots | Owner-seat capture deferred to a live `pnpm app` walk — checklist below is the compare card |

## Checklist (MACOS-GRAPHITE-MEDIUM + interface-design)

| Check | Sequence V3 | T3 Code (read of `apps/web`) | Verdict |
|-------|-------------|------------------------------|---------|
| Contrast / near-black room | Graphite dark ladder + gold accent | Tokenized dark/light + primary accent | Sequence OK for Graphite laws; T3 is its own brand |
| Tokens | `--accent #E8C547`, `--glass-*` in `graphite.css` | Tailwind + `--glass-blur` / surface utilities | Sequence locked to Decision 22–24 |
| Layout legibility | Fill-screen; rail + chat + live stack | Sidebar + chat routes | Sequence matches Decision 23 |
| Spacing rhythm | `--sp-*` / `--row-h` | rem-based compact geometry | Sequence compact (Law 3) |
| Empty states | Surface skins in `v3.css` + restored overlay CSS | Route-level empties | Sequence owner-visible skins landed Wave 1 |
| Icons | Sheet-09 `Icon` on workspace tabs | Lucide / local UI set | Sequence OK |
| Glass | Balanced `--glass-inset`, quiet tabs, focused live rim | `surface-glass` utility | Sequence OK; no tab bloom |
| Type ladder | Instrument Sans + JetBrains Mono | App font stack | Sequence OK |
| Specificity traps | Overlay styles under `.v3-overlay-panel` | Component-scoped | Watch for stub CSS regressions |
| Latency HUD / soft-switch | Thinking HUD + optimistic `activateSession` | Provider-thread UX | Sequence Wave 4 OK |

## Gaps still honest (do not claim done)

- Full `@sequence/web2` suite green while `shell.css` remains Decision-22 retired — need either V3-owned replacements for Shell/App CSS locks or explicit skip of retired-shell tests.
- Owner screenshots for empty/filled/~360px on every surface — run after `pnpm build && pnpm app`.
- Targeted e2e (`test:e2e:terminal`, `:browser`, `:wbask`, `:shell`) when Playwright is installed for the package.

## Compare note (not a bakeoff win)

T3 is an agent-harness control surface (multi-provider, remote). Sequence is architecture-grounded chat+canvas. Gate is **chrome craft**, not feature parity. Sequence should feel as sharp as T3 on glass, density, and switch latency — without adopting T3's accent or layout.
