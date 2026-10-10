# Sequence web2: accessibility and load audit of the seven surfaces

Build: 515eb86 with local patches 0001-0016 applied (worktree `wt17`), served by `sequence app` on the sample repo `shopfront-repo`, port 4197. Browser: headless Chromium 1194 via playwright-core. Axe: axe-core from npm, injected into the page.

**Method.** Each surface was measured in a fresh browser context. After boot, every open live pane was closed (Architecture opens by default), then the surface's tab was clicked, so each surface sits alone beside the chat column. Axe ran scoped to the surface root (`.v3-chat-col` for Chat, `section[data-surface=<id>]` for the rest). Keyboard: the surface's enabled, visible tab stops were counted, then Tab was pressed from the top of the page and each stop's focus indicator was recorded (a non-zero outline, or a box-shadow or border change against its unfocused state). A "trap" means focus stayed on one element for 3 Tab presses. Horizontal overflow means `documentElement.scrollWidth - innerWidth`, plus the count of controls lying outside the viewport. Load means the time from the tab click until the DOM had been quiet for 300 ms; 3 runs at 1440x900, median reported. Scripts: `audit.mjs` (whole audit), `trap.mjs` (the terminal before/after probe), `detail.mjs` and `fit.mjs` (whole-page detail). Raw data: `before.json`, `after-terminal.json`, `trap-before.json`, `trap-after.json`.

## Headline

| surface | open ms (median, n=3) | console errors | axe (serious+) at 1440 / 400 | keyboard reached | focus ring | trap | h-overflow |
|---|---|---|---|---|---|---|---|
| chat | 22 | 0 | aria-prohibited-attr ×1 / same | 4/4 | 3/4 (see note 1) | no | 0 |
| files | 91 | 0 | none / none (scrollable-region-focusable ×1 when Architecture is open too) | 2/2 | 2/2 | no | 0 |
| architecture | 116 | 0 | nested-interactive ×9, color-contrast ×1 / same | 30/30 | 30/30 | no | 0 |
| whiteboard | 58 | 0 | none / none | 6/6 | 6/6 | no | 0 |
| ai-canvas | 58 | 0 | none / none | 6/6 | 6/6 | no | 0 |
| **terminal** | 59 | 0 | color-contrast ×1 / same | 1/1 | **0/1** | **YES: Tab and Shift+Tab both swallowed, no way out** | 0 |
| browser | 57 | 0 | color-contrast ×1 / same | 2/2 | 2/2 | no | 0 |
| shell (rail, toolbar) | n/a | 0 | color-contrast ×3, nested-interactive ×1 (`.v3-session`) | n/a | n/a | n/a | 0 |

No console errors or failed requests on any surface. Open times are all under 120 ms, so load is not a problem on this repo.

## Worst problem: a keyboard trap in the Terminal (fixed in 0017)

`TerminalPane.tsx` sent every `Tab` keydown to the shell and called `preventDefault`. `event.key` is `'Tab'` for Shift+Tab too, and Escape did nothing. Once keyboard focus landed on a live terminal, no other control in the app could be reached without a mouse. That fails WCAG 2.1.2 No Keyboard Trap (Level A), and it strands the whole app, not just one control. It showed at both viewports on every run.

Fix: Tab still goes to the shell for completion. Shift+Tab is always left to the browser, so focus moves back. Esc then Tab moves focus forward once. A hidden hint wired through `aria-describedby` announces both exits.

| probe (`trap.mjs`), n=3 runs per viewport, every run identical | before 1440 | after 1440 | before 400 | after 400 |
|---|---|---|---|---|
| Shift+Tab leaves the focused terminal | 0/3 | 3/3 | 0/3 | 3/3 |
| Esc then Tab leaves the focused terminal | 0/3 | 3/3 | 0/3 | 3/3 |
| plain Tab still stays in the shell (completion) | 3/3 | 3/3 | 3/3 | 3/3 |
| other tab stops reachable from the terminal, walking back with Shift+Tab (of 21 at 1440, 12 at 400) | 0 | 20 | 0 | 12 |
| other tab stops reachable from the terminal, walking forward with Esc+Tab then Tab | 0 | 20 | 0 | 12 |
| axe on the terminal surface | color-contrast ×1 | color-contrast ×1 | same | same |

`audit.mjs` after the fix (`after-terminal.json`) still flags a trap on plain Tab, as designed. Its escape check now reports `shiftTab: true, escTab: true` at both viewports; before the fix both were false.

## Other findings, ranked

1. **Terminal has no focus indicator.** `.terminal-pane-surface { outline: none }` in `v3.css:3667` gives 0/1 focus-visible (WCAG 2.4.7). A one-rule `:focus-visible` fix.
2. **Nested interactive board nodes.** 9 architecture nodes are `div[role=button][tabindex=0]` that contain the node's own open `<button>` (`NodeCard.tsx:392`). The rail's `.v3-session` has the same pattern. Axe rates it serious: screen readers flatten the inner button.
3. **Files squeezed beside Architecture.** Architecture is open at boot, so clicking Files gives Files and Architecture side by side at 299 px each at 1440. The Files reading column (`.files-body`) is then **19 px wide** and its note wraps one letter per line. That same state trips axe `scrollable-region-focusable` on `.files-body`.
4. **Contrast.** In the rail, `#7c7c7a` on `#1d1d1c` is 4.03:1 (`.v3-rail-pick-toggle`, `.v3-rail-section-label`), and `.v3-session-more` is 2.8:1 on hover grey. `.grp` (architecture), `.terminal-pane-meta` and `.browser-pane-meta` each fail once.
5. **Chat transcript.** `.v3-transcript` has an `aria-label` but no role (aria-prohibited-attr). The fix is `role="log"` or `role="region"`.
6. **Landmarks.** The banner and main landmarks are nested inside another landmark (moderate).

Note 1: the chat textarea has no ring of its own. Its container, `.v3-composer-shell:focus-within`, draws one, so this is a false positive of the per-element check, not a finding.

Note 2: at 400x800 no surface overflows horizontally. The sessions rail is hidden at that width, and the panes stack vertically. With two panes open, each gets about 178 px of height.

## Per-surface detail (before the fix)

### chat

Open time median 22 ms (runs 22, 22, 8), console errors: 0

| viewport | axe violations (id, impact, count, sample) | keyboard: reached / controls | focus-visible / reached | trap | h-overflow (doc px / controls off-screen) |
|---|---|---|---|---|---|
| 1440x900 | `aria-prohibited-attr` serious ×1 (`.v3-transcript`) | 4 / 4 | 3 / 4 (no ring: Message input) | no | 0 / 0 |
| 400x800 | `aria-prohibited-attr` serious ×1 (`.v3-transcript`) | 4 / 4 | 3 / 4 (no ring: Message input) | no | 0 / 0 |

### files

Open time median 91 ms (runs 91, 93, 75), console errors: 0

| viewport | axe violations (id, impact, count, sample) | keyboard: reached / controls | focus-visible / reached | trap | h-overflow (doc px / controls off-screen) |
|---|---|---|---|---|---|
| 1440x900 | none | 2 / 2 | 2 / 2 | no | 0 / 0 |
| 400x800 | none | 2 / 2 | 2 / 2 | no | 0 / 0 |

### architecture

Open time median 116 ms (runs 123, 116, 105), console errors: 0

| viewport | axe violations (id, impact, count, sample) | keyboard: reached / controls | focus-visible / reached | trap | h-overflow (doc px / controls off-screen) |
|---|---|---|---|---|---|
| 1440x900 | `color-contrast` serious ×1 (`.grp`)<br>`nested-interactive` serious ×9 (`div[data-node-id="svc:edge"]`) | 30 / 30 | 30 / 30 | no | 0 / 0 |
| 400x800 | `color-contrast` serious ×1 (`.grp`)<br>`nested-interactive` serious ×9 (`div[data-node-id="svc:edge"]`) | 30 / 30 | 30 / 30 | no | 0 / 0 |

### whiteboard

Open time median 58 ms (runs 57, 59, 58), console errors: 0

| viewport | axe violations (id, impact, count, sample) | keyboard: reached / controls | focus-visible / reached | trap | h-overflow (doc px / controls off-screen) |
|---|---|---|---|---|---|
| 1440x900 | none | 6 / 6 | 6 / 6 | no | 0 / 0 |
| 400x800 | none | 6 / 6 | 6 / 6 | no | 0 / 0 |

### ai-canvas

Open time median 58 ms (runs 59, 58, 56), console errors: 0

| viewport | axe violations (id, impact, count, sample) | keyboard: reached / controls | focus-visible / reached | trap | h-overflow (doc px / controls off-screen) |
|---|---|---|---|---|---|
| 1440x900 | none | 6 / 6 | 6 / 6 | no | 0 / 0 |
| 400x800 | none | 6 / 6 | 6 / 6 | no | 0 / 0 |

### terminal

Open time median 59 ms (runs 60, 54, 59), console errors: 0

| viewport | axe violations (id, impact, count, sample) | keyboard: reached / controls | focus-visible / reached | trap | h-overflow (doc px / controls off-screen) |
|---|---|---|---|---|---|
| 1440x900 | `color-contrast` serious ×1 (`.terminal-pane-meta`) | 1 / 1 | 0 / 1 (no ring: Terminal output) | **yes**, on `pre Terminal output` | 0 / 0 |
| 400x800 | `color-contrast` serious ×1 (`.terminal-pane-meta`) | 1 / 1 | 0 / 1 (no ring: Terminal output) | **yes**, on `pre Terminal output` | 0 / 0 |

### browser

Open time median 57 ms (runs 58, 57, 56), console errors: 0

| viewport | axe violations (id, impact, count, sample) | keyboard: reached / controls | focus-visible / reached | trap | h-overflow (doc px / controls off-screen) |
|---|---|---|---|---|---|
| 1440x900 | `color-contrast` serious ×1 (`.browser-pane-meta`) | 2 / 2 | 2 / 2 | no | 0 / 0 |
| 400x800 | `color-contrast` serious ×1 (`.browser-pane-meta`) | 2 / 2 | 2 / 2 | no | 0 / 0 |

