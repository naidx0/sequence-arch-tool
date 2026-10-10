# GRAPHITE → SEQUENCE: THE TOKEN-COLLISION REFERENCE

> ### ⚠ READ THIS AS A REFERENCE, NOT AS A PLAN (reframed 2026-08-20 by the v2 pivot)
>
> **What survives, and is load-bearing: §1.0, the nine hard token collisions below.** Nine names
> exist in both systems and **not one of them agrees on value** — `--dot` even changes type, from a
> colour to a length. `packages/web2` needs that table verbatim, and
> `docs/research/v2-architecture-and-gaps.md` cites it. The measured values were verified against
> both files directly.
>
> **What does not survive: the migration itself.** The W0–W16 wave plan below re-points
> `packages/web/src/product/product.css` family by family. That file is deleted at Wave 7 with the
> rest of `packages/web` (`docs/PIVOT-V2.md`) — there is nothing left to migrate. v2 starts from the
> Graphite tokens directly, in `packages/web2`. Read the wave sections for *which token families
> exist and what each one is for*, never as a sequence of steps to execute.
>
> **The brand source of truth is the frozen `docs/brand/graphite/`** (`_core.html` + twelve
> sheets). Cite `graphite/` and never an `ml-harness` path — see
> `GRAPHITE-DECISIONS.md`.

**Graphite side (as measured):** 121 book tokens + 7 sanctioned app additions = 128. The values were
read from Graphite's own substrate and its implemented token layer in the `ml-harness` repository;
the authority for Sequence is the frozen copy at `docs/brand/graphite/_core.html`.
**Sequence side (as measured, v1):** `packages/web/src/product/product.css`, 223–225 custom properties — the two lanes disagree on the count — 8760 lines, 69 hard-coded hexes, 49 test files reading it. **That file is being deleted**; the numbers are kept because they are the evidence for how large the collision surface was.

**The headline number:** only **9 token names** exist in both systems, and **not one of them agrees on value**. Three of those nine (`--sp-2`, `--sp-4`, `--sp-6`) will apply silently and wrongly on a naive merge, and one (`--dot`) changes type from a colour to a length. This is a rename-then-swap, never an in-place value change.

I have verified the nine collisions and the load-bearing values directly against both files. Everything else below is quoted from the lanes with its file:line intact.

---

# 1. THE TOKEN MIGRATION

## 1.0 The nine hard collisions — rename BEFORE importing Graphite

Do this first, as its own commit, with no value changes. Every one of these applies cleanly and wrongly if Graphite's file is merged on top.

| Sequence name | Sequence value | Graphite value | Live refs | Failure mode if not renamed first |
|---|---|---|---|---|
| `--sp-2` | `var(--s2)` = **8px** | **2px** | 26 | Every gap silently shrinks 8→2px. No error, no test failure that reads as spacing. |
| `--sp-4` | `var(--s4)` = **16px** | **4px** | 3 | 16→4px |
| `--sp-6` | `var(--s5)` = **24px** | **6px** | — | 24→6px |
| `--dot` | `rgba(220,222,224,0.08)` (grid ink) | `6px` (status-dot diameter) | 1 | `background: 6px` — invalid declaration, dropped silently, the canvas dot grid vanishes with no console error. |
| `--accent` | `var(--acc)` = `#4e7fd4` | `#8E8AF2` / `#4F45C9` | many | Wrong hue everywhere, looks plausible. |
| `--scrim` | `rgba(0,0,0,0.66)` | `rgba(4,4,6,.64)` dark / `rgba(19,19,21,.36)` light | — | Light scrim is half the opacity; Sequence has no concept of it. |
| `--ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | `cubic-bezier(.2,.7,.3,1)` | 13 | **Only the third control point differs (0.2 → 0.3)** — survives a careless diff. |
| `--topbar-h` | `40px` | `44px` | — | +4px silently |
| `--row-h` | `26px` | `30px` | 1 | +4px silently |

Plus one **prefix** collision that breaks nothing mechanically but ruins the file: `--t-*` means *duration* in Sequence (`--t-hover:90ms`) and *type size* in Graphite (`--t-14:14px`). Rename all Sequence `--t-*` to `--dur-*` in the same commit.

**Step order (non-negotiable):**
1. Rename Sequence's colliding names to `--seq-*` (`--seq-sp-1..6`, `--seq-dot`, `--seq-ease`, …). Zero value change. Tests should be green.
2. Import Graphite's 128 tokens onto `:root` in three theme states.
3. Re-point Sequence names at Graphite names, one family at a time (§1.1–1.12).
4. Delete the `--seq-*` shims.

## 1.1 Surfaces — 4 rungs → 6, blue-slate → true neutral

| Sequence | Value | → Graphite | Dark | Light |
|---|---|---|---|---|
| `--ground`, `--paper`, `--bg`, `--canvas` | `#0d1013` | `--bg-base` | `#0D0D0F` | `#F6F6F7` |
| `--rail` | `#11171c` | `--surface-1` | `#141416` | `#FBFBFC` |
| `--card`, `--panel` | `#151c22` | `--surface-2` | `#1A1A1D` | `#FFFFFF` |
| `--raised`, `--hover`, `--elevated` | `#1b2127` | `--surface-3` | `#232327` | `#FFFFFF` |
| — | *(none)* | **`--bg-ground` NEW** | `#08080A` | `#EFEFF0` |
| — | *(none)* | **`--surface-4` NEW** | `#2C2C31` | `#FFFFFF` |

The blue cast is measurable, not cosmetic: `--card` `#151c22` has a B−R delta of **+13**; `--surface-2` `#1A1A1D` has **+3**. `--line` `#27313a` is **+19**.

**Assignment law (Graphite page 02):** `--bg-ground` = behind the window / the stage a specimen is photographed on. `--bg-base` = the app's own ground and transcript. `--surface-1` = structure that never moves (rail, pane, panels, composer). `--surface-2` = content objects the conversation produced (cards, chips, bubbles, code, **node cards**). `--surface-3` = transient (popovers, menus, selected segment, disabled fill, keycaps). `--surface-4` = interrupting (dialogs, approval card) — *use sparingly*.

**Light-mode consequence:** surfaces 2, 3 and 4 are all `#FFFFFF` in light **by design**. Any Sequence component that relies on a surface step to be visible works in dark and vanishes in light. If it needs an outline in light it needs one in both, and that outline is `--edge`.

## 1.2 Edges — opaque hex → white alpha, + a third step

| Sequence | Value | Refs | → Graphite | Dark | Light |
|---|---|---|---|---|---|
| `--line`, `--line-hair`, `--line-soft`, `--border-soft`, `--border`, `--product-border` | `#27313a` | 104 | `--edge` | `rgba(255,255,255,.09)` | `rgba(19,19,21,.11)` |
| `--line-2`, `--line-rule`, `--border-strong`, `--elev` | `#38434d` | 102 | `--edge-strong` | `rgba(255,255,255,.16)` | `rgba(19,19,21,.20)` |
| — | *(none)* | — | **`--edge-faint` NEW** | `rgba(255,255,255,.05)` | `rgba(19,19,21,.06)` |

Behavioural, not cosmetic: Sequence's opaque hexes are tuned to sit on exactly one surface; Graphite's alpha edges compose correctly over all six rungs. `--edge-faint` is for hairlines *inside* a card only (card head from body, one spec row from the next). Note `--elev` is an *elevation* name pointing at a *hairline colour* — it is a mislabel, delete it.

## 1.3 Ink — 5 names for 4 values, and the duplicate is the most-used one

| Sequence | Value | Refs | → Graphite | Dark | Light |
|---|---|---|---|---|---|
| `--ink`, `--text` | `#dcdee0` | 159 | `--ink-1` | `#F5F5F7` | `#131315` |
| `--calm`, `--muted-strong` | `#b9bdc1` | 25 | `--ink-2` | `#C3C4C9` | `#4C4D53` |
| **`--sub`** | `#b9bdc1` **(byte-identical to `--calm`)** | **134** | `--ink-2` | | |
| `--mute`, `--muted` | `#83888c` | 106 | `--ink-3` | `#8A8B93` | `#6C6D75` |
| `--faint` | `#5a5f63` | 3 | `--ink-4` | `#56575E` | `#9A9BA2` |

**`--ink-4` is disabled-only.** It measures 2.70:1 dark / 2.56:1 light — below the 3:1 non-text floor in both themes, by design. Any Sequence `--faint` that carries information (a timestamp, a unit, a count, a "0 results") moves to `--ink-3`, not `--ink-4`. Audit all 3 sites.

**One measured exception to carry over:** on `--surface-4` in dark, `--ink-3` falls to **4.10:1**, below the 4.5:1 text floor — so on dialogs and the approval card, metadata moves up one step to `--ink-2`.

## 1.4 Accent — one blue → two indigos, and the polarity of the label flips

| Sequence | Value | Refs | → Graphite | Dark | Light |
|---|---|---|---|---|---|
| `--acc`, `--signal`, `--signal-text`, `--ring`, `--accent-text`, `--accent-48`, `--magic`, `--control` | `#4e7fd4` | 115 | **split** — see below | | |
| — | | | `--accent` (text, strokes, focus, dots) | `#8E8AF2` | `#4F45C9` |
| — | | | `--accent-solid` (**fills only**) | `#6C63E0` | `#5B51D6` |
| `--acc-ink`, `--signal-ink`, `--accent-ink`, `--ctrl-primary-ink` | `#0b1220` | | `--accent-on-solid` | `#FFFFFF` | `#FFFFFF` |
| `--acc-1` | `#2f4d78` | | `--accent-edge` | `rgba(142,138,242,.40)` | `rgba(79,69,201,.34)` |
| `--acc-2` | `#6f9ae0` | | `--accent-solid-hover` = `color-mix(in srgb, var(--accent-solid) 86%, #fff 14%)` | | |
| `--acc-wash` | `rgba(78,127,212,0.1)` | | `--accent-wash` | `rgba(142,138,242,.14)` | `rgba(79,69,201,.09)` |
| `--acc-line` | `rgba(78,127,212,0.32)` | | `--accent-edge` | as above | |
| `--acc-0`, `--ctrl-hover` | `#0a1c36` | | `--state-hover` | `rgba(255,255,255,.045)` | `rgba(19,19,21,.045)` |
| `--acc-3` | `#9dbcec` | | **NO HOME — delete** | | |
| — | | | **`--state-press` NEW** | `rgba(255,255,255,.085)` | `rgba(19,19,21,.085)` |
| — | | | **`--state-selected` NEW** | `rgba(255,255,255,.07)` | `rgba(79,69,201,.09)` |

Three things here are behaviour changes, not swaps:

- **The stroke/fill split has no automatic rule.** 115 `var(--acc)` call sites must each be judged: is this a *fill* (→ `--accent-solid`) or a *mark* (→ `--accent`)? A value bright enough to read as text on a dark ground is too bright as a large fill.
- **`--acc-ink` inverts.** `#0b1220` → `#FFFFFF`. Every primary-button label flips polarity. This follows from the hue: `#4e7fd4` is light enough to need dark text, `#6C63E0` is not.
- **Hover polarity flips.** Sequence hovers *bluer* (`--acc-0 #0a1c36`), Graphite hovers *lighter and neutral*. The written rationale at `product.css:32-40` (an AA ceiling computed against `#151c22`) is **void** once the surface ramp changes — re-measure, do not carry the argument over.

## 1.5 Verdicts — 3 hues → 5, plus the derivation engine

| Sequence | Value | → Graphite | Dark | Light |
|---|---|---|---|---|
| `--ok` | `#5e9c72` | `--fits` | `#57D2A6` | `#0C7B53` |
| `--warn` (= `var(--topic)`) | `#c09551` | `--spills` | `#F0B45F` | `#8F5A00` |
| `--deny`, `--danger` | `#b06a62` | `--wont` | `#F47C7C` | `#C2352F` |
| — | *(none)* | **`--unknown` NEW** | `#8A8B93` | `#6C6D75` |
| — | *(none)* | **`--info` NEW** | `#6FB5E8` | `#1667A8` |
| `--deny-wash` | `rgba(176,106,98,0.07)` hand-written | `--wont-wash` **derived** | | |
| — | | **`--mix-wash` NEW** | `14%` | `10%` |
| — | | **`--mix-edge` NEW** | `46%` | `38%` |
| — | | **10 derived tokens NEW** — `--fits-wash/-edge` … `--info-wash/-edge`, each `color-mix(in srgb, var(--X) var(--mix-wash), transparent)` | | |

**Never mix your own wash.** Sequence currently types the hue and the alpha twice (`--deny-wash`, `--acc-wash`), so changing `--deny` leaves the wash on the old hue.

Two absences are substantive, not naming: for a product whose non-negotiable is *grounded, not guessed*, shipping **no colour for `unknown`** is a product gap. `--unknown` is grey on purpose — "not known, and refusing to guess", not a mild warning.

**Also NEW — 7 run-state aliases**, so a state's colour is decided once: `--st-neutral: var(--ink-3)`, `--st-active: var(--info)`, `--st-attention: var(--accent)`, `--st-stalled: var(--spills)`, `--st-failed: var(--wont)`, `--st-done: var(--fits)`, `--st-archived-opacity: .6`. Run rows reference the `--st-*` role, never the underlying verdict token.

## 1.6 ⚠ NO CLEAN MAPPING — the five kind hues (the largest structural gap)

`--k-entry #83888c` · `--k-service #4e7fd4` · `--k-store #5e9c72` · `--k-topic #c09551` · `--k-agent #8e7ca6`, plus ~14 aliases (`--entry/--svc/--store/--topic/--agent`, `--arch-kind-*`, `--http/--grpc/--queue/--db`).

Graphite has **no kind namespace**, and page 06.3 forbids the obvious substitute in both directions: `--viz-*` is "for **series**, not for meaning". Worse, three of the five are byte-identical to Sequence's own status vocabulary:

- `--k-service #4e7fd4` **==** `--acc`
- `--k-store #5e9c72` **==** `--ok`
- `--k-topic #c09551` **==** `--warn` (literally `--warn: var(--topic)`)
- `--k-entry #83888c` **==** `--mute`

**Recommendation (needs an owner ruling — see §5, R2):**
1. Move the hue to the `--viz-*` namespace, **skipping `--viz-1`** because it is byte-identical to `--accent-solid` in light (`#5B51D6`) and to `--accent` in dark (`#8E8AF2`).
2. Move the **carrier** off the border (see §5, R1).

| Kind | → | Dark | Light |
|---|---|---|---|
| service | `--viz-2` | `#5EA8DC` | `#1A6FA8` |
| agent | `--viz-3` | `#E07BB4` | `#AB3782` |
| storage | `--viz-4` | `#4ECFB0` | `#0B7566` |
| topic | `--viz-5` | `#D6A45A` | `#845E0C` |
| **module** | `--viz-6` | `#9AA3FF` | `#4A56C4` |
| entry | `--ink-3` (no hue — an entry point is a *position*, not a kind) | | |

This also frees `--viz-1` and makes room for module, which the board currently cannot express at all.

## 1.7 ⚠ NO CLEAN MAPPING — the `--h0..--h4` sequential ramp

`--h0 #191b1d --h1 #22303f --h2 #2e4761 --h3 #3a5f85 --h4 #4e7fd4` — one hue, five steps, a heat scale. Graphite ships six **categorical** series colours and five pieces of chart furniture (`--viz-baseline/-band/-grid/-axis/-crosshair`) and **no sequential ramp of any kind**. A heat ramp cannot be built from categorical hues.

**This is a gap on the Graphite side, not Sequence's.** Do not delete it. Keep it as a declared Sequence extension — `--seq-heat-1..5`, derived from `--viz-2` by `color-mix`, justified at the point of declaration — and raise it in the handback. Note `--h4` is a third alias of `#4e7fd4` (accent = service kind = ramp top); the derivation must break that.

## 1.8 Radius — the closed 3px/2px set → a six-step ramp

Sequence's doctrine (`product.css:74-75`): *"the closed set: 3px / 2px / dots 50%, nothing else"*, `--r-panel: 3px` (74 refs), `--r-ctl: 2px` (62 refs). Graphite: `--r-4:4px --r-8:8px --r-10:10px --r-14:14px --r-18:18px --r-full:999px` plus one named 2px survivor `--r-bar`. **`--r-6`, `--r-12`, `--r-16`, `--r-20` do not exist** — writing one yields an invalid `border-radius` and a square corner, deliberately.

Map by **role**, not by name:

| Role | Sequence today | → |
|---|---|---|
| inline code chips, colour swatches, keycaps, checkbox | `--r-ctl` 2px | `--r-4` |
| icon buttons, tool rows, kv rows, file headers, small tab pills, segment buttons | `--r-ctl` 2px | `--r-8` |
| buttons, rail rows, thread rows, run rows, two-line chips, segmented control shell, code blocks | `--r-ctl` 2px | `--r-10` |
| panels, cards, **node cards**, chart frames, empty states, stages, do/don't | `--r-panel` 3px | `--r-14` |
| the window, the composer, the user bubble, page header, hero cards, dialogs | `--r-panel` 3px | `--r-18` |
| verdict badges, provenance tags, chips, dots, avatars, plus button, **the send button** | mixed | `--r-full` |
| VRAM/budget segments (8px tall), chart legend keys (3px tall) — **and nothing else** | literal 2px ×2, 1px ×2 | `--r-bar` 2px |

Aliases to re-point: `--r-card/--r-frame/--r-node/--radius-card/--radius-panel` → `--r-14`; `--r-ctrl/--r-sm/--r-field/--radius-chip` → `--r-8` or `--r-10`; **`--r-composer-btn` → `--r-full`** (verified: it currently resolves to `--r-ctl` = 2px, and `product.css:3836` documents the square as deliberate policy — Graphite page 39 explicitly overrules it: *"our own design system specified a square and was wrong."*).

Two rules travel with the ramp:
- **Never nest equal radii.** Inner radius = outer minus its inset. The composer is `--r-18` with `--sp-10` padding, so its model selector is `--r-8`. 18 − 10 = 8.
- **The pill is reserved.** `--r-full` means "this is a state or a label", never "this is an interactive container". The composer is `--r-18`, not `--r-full` — a pill with a circular send reads as a search box.

## 1.9 Spacing — the missing rungs are the whole problem

Sequence's ladder has **no 2, no 6, no 10, no 20, no 40, no 56**, and 6px and 10px are exactly the two values it writes most: **6px raw ×127, 10px raw ×79 = 206 declarations that exist only because there is no token to name them.** `--gutter: 10px` is declared and used **zero** times.

| Sequence | Value | → Graphite |
|---|---|---|
| `--s1` | 4px | `--sp-4` |
| `--s2` | 8px | `--sp-8` |
| `--s3`, `--panel-pad` | 12px | `--sp-12` |
| `--s4` | 16px | `--sp-16` |
| `--s5` | 24px | `--sp-24` |
| `--s6` | 32px | `--sp-32` |
| `--s7` | **48px** | **NO HOME** — ramp jumps 40→56. Round to `--sp-40`. |
| `--s8` | **64px** | **NO HOME** — above Graphite's 56px ceiling. Round to `--sp-56`. |
| `--gutter` | 10px | `--sp-10` |
| — | | **NEW: `--sp-2` 2px, `--sp-6` 6px, `--sp-10` 10px, `--sp-20` 20px, `--sp-40` 40px, `--sp-56` 56px** |

Graphite's base is 2px; Sequence's is 4px — Graphite can express half-steps Sequence cannot. The assignments are **binding, not illustrative**: 2 icon-to-label · 4 inside chips · 6 button gaps · 8 row padding · 10 button horizontal padding · 12 card and composer padding · 16 panel padding · 20 transcript sides · 24 page header · 32 between page sections · 40 between major sections · 56 page bottom. The scale skips 14, 18, 28, 36, 48 — **a 14px gap is an invented number**, and Sequence has 24 of them.

## 1.10 Type — Inter → Instrument Sans, and every half-pixel loses its slot

`--sans`/`--disp` `'Inter Variable','Inter',…` → `--font-sans: "Instrument Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`. `--mono` → `--font-mono: "JetBrains Mono", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace` — same primary face, different fallback chain. Instrument Sans was chosen deliberately *against* Inter: *"a neo-grotesque with a compact skeleton that holds its shape at 10 and 11px."*

| Sequence | Value | Usages | → | px |
|---|---|---|---|---|
| `--fs-h` | 17px | | `--t-17` / `--lh-17` | 17 / 22 |
| `--fs-title` | 14px | | `--t-14` / `--lh-14` | 14 / 21 |
| `--card-title-size` | **13.5px** | 8 | `--t-13` / `--lh-13` | 13 / 18 |
| `--fs-ui` | **12.5px** | 17 | `--t-12` / `--lh-12` | 12 / 16 |
| `--fs-sm`, `--fs-mono`, `--card-sub-size` | **11.5px** | 80 + 27 | `--t-11` / `--lh-11` | 11 / 15 |
| `--fs-mono-sm` | **10.5px** | 12 | `--t-10` / `--lh-10` | 10 / 14 |
| `--fs-micro`, `--micro-size` | **9.5px** | 51 + 14 | `--t-10` (**the floor**) | 10 / 14 |
| `--text-xl` | 26px | | `--t-26` / `--lh-26` | 26 / 30 |
| `--edge-tag-size` | **8.75px** | | **UNREPRESENTABLE** — below the floor → `--t-10` | |
| — | | | **NEW: `--t-15`/`--lh-15` (15/23), `--t-20`/`--lh-20` (20/26, reserved), `--num: tabular-nums lining-nums`** | |

**255 usages sit on a half-pixel. 102 places render text below the 10px floor** (8.5px ×2, 9px ×26, 9.5px ×9, `--fs-micro` ×51, `--micro-size` ×14). Four sizes are also off the top or between rungs: 28px (`.product-attach-hero-title`, above the 26px ceiling) → `--t-20`; 18px → `--t-17`; 16px ×4 → `--t-15`.

**Line-height is an incompatible model, not different values.** Sequence: four unitless ratios by role (`--lh-tight:1.25 --lh-ui:1.45 --lh-mono:1.55 --lh-prose:1.6`). Graphite: nine px tokens locked one-per-size. No single ratio reproduces the ramp — `--t-17/--lh-17` is 1.29 while `--t-14/--lh-14` is 1.50. **Every `line-height` call site moves from a role token to a size-paired token.** The worst offender is `.product-composer-input`: `font-size:12px; line-height:22px` — a 1.83 ratio, 6px of dead air per line in the most-used control in the product, reverse-engineered from a 28px button rather than from the type.

Weights and mono: body **450**, headings **600**, labels/controls **550**, `.btn.solid` 600, `.verdict` 700. **Mono always sets one step down from the sans beside it.**

## 1.11 Density and layout

| Sequence | Value | → Graphite | Value | Δ |
|---|---|---|---|---|
| `--topbar-h` | 40px | `--topbar-h` | **44px** | +4 |
| `--row-h` | 26px | `--row-h` | **30px** | +4 |
| `--index-rail-w` (declared twice) | 300px | `--rail-w` | **280px** | −20 |
| `--ctrl-h` | 28px | `--control-h` | 28px | rename only ✓ |
| `--composer-btn` | 28px | `--icon-btn` | 26px (send stays 28) | −2 |
| `--ctrl-h-xs` / `-sm` / `-lg` | 20 / 24 / 32px | **collapse — see below** | | |
| — | | **NEW** | `--row-h-thread:28px`, `--pane-w:392px`, `--col-max:720px`, `--dot:6px` | |
| — | | **NEW clamps** | `--rail-w-min:216px --rail-w-max:400px --pane-w-min:320px --pane-w-max:640px --col-min:420px` | |

**The control ladder collapses from a size ladder to a role ladder.** Graphite has one `--control-h` (28px) and one `--icon-btn` (26px), and every other height is a *component* value, not a scale rung: 24px = `.btn.sm`/`.chip`/`.seg button`/`.plusbtn`/`.modelsel`; 22px = `.verdict`/`.repochip`; 20px = `.minitabs button`/`.railhead .acts button`/`.kbd`; 16px = `.prov`; 38px = `.runrow`/`.chip.two`. Delete `--ctrl-h-xs/-sm/-lg`. Sequence's most-used control is currently `--ctrl-h-sm` (24px, 41 usages vs `--ctrl-h` 22) — a rung Graphite does not have as a *default*.

Sequence currently ships **icon buttons at six sizes** (20/22/24/26/28/32) and **chrome bars at five heights** (30/36/38/40/44). Both collapse.

## 1.12 Motion, elevation, focus, and the rest

**Motion:** `--t-hover` 90ms → `--dur-1` **110ms**; `--t-ui` 130ms → `--dur-2` **170ms**; `--ease` third point 0.2 → **0.3**. `--t-panel:180ms --t-cam:240ms --t-hop:400ms` have **no Graphite home** — Graphite ships two durations. Keep as declared `--seq-dur-*` extensions (board camera work genuinely needs them) with a justification comment.

**Elevation:** `--shadow-pop` → `--e1`; `--shadow-menu` → `--e3`; `--shadow-modal` → `--e4`; `--ctrl-shadow: none` → `--e0`. **`--e2` (composer at rest) has no Sequence source.** Every Graphite dark elevation carries an inset top highlight Sequence has nowhere — `--e1: inset 0 1px 0 rgba(255,255,255,.05), 0 1px 2px rgba(0,0,0,.40)`. That highlight is what makes a raised surface read as raised on a flat neutral ramp. Light's ramp is structurally different: the **first value is a 1px spread ring, not a blur** — `--e1: 0 0 0 1px rgba(19,19,21,.05), 0 1px 2px rgba(19,19,21,.06)`. Pairing: card = `--surface-2` + `--e1`; composer = `--surface-1` + `--e2` → `--e3` focused; window = `--e4`.

**Focus:** structurally identical, both operands change. `--focus-ring: 0 0 0 2px var(--ground), 0 0 0 4px var(--acc)` → `0 0 0 2px var(--bg-base), 0 0 0 4px var(--accent)` **plus `border-radius: inherit`**, which matters far more once radii go 3px → 14px. Note `--accent`, not `--accent-solid`. `--focus-w`/`--focus-offset` are dead once focus is a box-shadow rather than an outline. Sequence currently ships `outline: 2px solid var(--ctrl-focus); outline-offset: 2px` at `product.css:2352` — a single ring.

**Selection / scrollbar (all NEW):** `--selection-bg` `rgba(142,138,242,.28)` dark / `rgba(91,81,214,.20)` light; `--scrollbar-thumb` `.14`/`.18`; `--scrollbar-thumb-hover` `.24`/`.30`.

**Diff (all NEW, 4 tokens):** `--diff-add-bg/-gutter`, `--diff-del-bg/-gutter`. Background wash only — **never colour the foreground text of a diff line**; `.tx` stays `--ink-1` in every state, and the gutter is an `inset 2px 0 0` box-shadow, not a border.

## 1.13 Delete outright

- **24 `--steel-NN` shims** (`product.css:166-187`). Their numbering is internally broken and must not be preserved: `--steel-25` = `--line-2` (the *stronger* hairline) while `--steel-30` = `--line` (the weaker) — the ordering inverts, twice; `--steel-70` and `--steel-85` are the same ink. Mapping: `00/02/04/05`→`--bg-base`; `08/10/12/8`→`--surface-2`; `14/15`→`--surface-3`; `18/25`→`--edge-strong`; `20/30`→`--edge`; `50/72`→`--ink-3`; `70/80/85/90`→`--ink-2`; `92/98`→`--ink-1`.
- **~50 alias tokens across three naming generations** (Ledger → Console → settings). `--hover: var(--raised)` and `--ctrl-hover: var(--acc-0)` are two different hover answers in the same block. Graphite has exactly one alias layer (the six `--st-*` roles) and says so.
- `--acc-3`, `--specular`, `--focus-w`, `--focus-offset`, `--shadow`, `--shadow-soft`.

## 1.14 Keep as declared Sequence extensions (with a justification comment at the declaration)

Graphite's own precedent for this is `tokens.css`'s 7 sanctioned additions — a derivation of an existing token, or a shipped constraint the book does not model, each named and justified in place. It is **not** a licence for a new colour, radius, type size or spacing value.

- **Stroke widths** `--w-hair:1px --w-edge:1.2px --w-flow:1.5px --w-struct:1.5px --w-rule:2px` — Graphite has *no* stroke-width token at all (its `.i` uses a literal 1.5). A board genuinely needs them: an edge and a border are different objects.
- `--arch-card-w:160px --arch-card-h:96px`, `--composer-row-h`, `--product-composer-reserve`, `--ctrl-press-travel:1px`.
- `--seq-heat-1..5` (§1.7), `--seq-dur-panel/-cam/-hop` (§1.12).
- **Blocked on the kind decision:** `--wb-fill-*` whiteboard fills (all `color-mix` over `--card` and the kind hues), `--edge-rest-filter`.

## 1.15 Coverage arithmetic

**118 Graphite token names have no Sequence counterpart at all.** Whole namespaces missing: `--viz-*` (11), `--diff-*` (4), `--state-*` (3), `--st-*` (7), `--e0..--e4` (5), verdict + wash/edge (15), `--mix-*` (2), `--t-*`/`--lh-*` (18), `--r-*` (7), `--sp-8..56` (8), grounds/surfaces/edges (9), `--ink-1..4` (4), accent family (6), selection/scrollbar (3), layout + clamps (11), fonts/motion (5). The ones that carry real product behaviour — viz, diff, state, st-\*, mix — are not cosmetic additions.

---

# 2. THE BINDING LAWS

Each is stated so a test can enforce it. Effort is the *test*, not the fix.

### L1 — Chrome is never coloured
No declaration whose property is `border*`, `outline-color`, or which targets `h1`–`h6`/`hr`/a section rule, may resolve to `--fits|--spills|--wont|--unknown|--info|--accent|--accent-solid|--viz-*`.
**Whitelist (exactly 4):** `.verdict` 1px `--X-edge`; the ring inside `.prov`; `.dev` 2px `--info` left rule; `.chip.sensitive` `--spills-edge`.
**Test:** parse all 5 sheets, resolve every border/outline value through the var chain, assert ∈ `{--edge, --edge-strong, --edge-faint, transparent, currentColor}` ∪ whitelist. **Current violations: 5 node-kind border rules (`product.css:7602-7620`), `.arch-rf-legend { border: 1px solid var(--ink) }`, `.arch-rf-edge-declared { stroke: var(--deny) }`.**

### L2 — The accent can never be mistaken for a verdict
`--accent` / `--accent-solid` may appear only on: `.sendbtn`, `.btn.solid`, the focus ring, `--state-selected`, `--st-attention`, checkbox/radio/toggle on-state, the slider fill.
**Test:** whitelist of selectors; any other rule referencing an accent token fails. Corollary: a chart series may never take `--accent` (that job is `--viz-1`), and a run row may never reference `--fits` directly instead of `--st-done`.

### L3 — Never hard-code a hex
Zero `#RRGGBB` outside the `:root` token blocks. **Current: 69** in `product.css`, including case-duplicate pairs that are the same colour written twice (`#83888C`/`#83888c`, `#DCDEE0`/`#dcdee0`, `#B9BDC1`/`#b9bdc1`, `#5A5F63`/`#5a5f63`).
**Test:** regex count == 0 across all 5 product sheets.

### L4 — One ladder, four assertions
- Every `padding|margin|gap|row-gap|column-gap` value ∈ `{2,4,6,8,10,12,16,20,24,32,40,56}` **and written as `var(--sp-N)`**. Current: 597 of 713 are raw px; 101 sit on odd values (1,3,5,7,9,11,13) the 4px base cannot express.
- Every `font-size` ∈ `{10,11,12,13,14,15,17,20,26}` as `var(--t-N)`. Current: 179 raw declarations across 15 distinct values, 8.5px–28px.
- Every `line-height` is `var(--lh-N)` matching its size token.
- Every fixed `height|min-height` ∈ `{16,20,22,24,26,28,30,38,44}` as a token.

**Test must read all five sheets.** The existing `controlLadder.v32.test.ts` reads `product.css` only and covers 11 selectors — which is exactly why `.program-icon-btn` 32px, `.program-intent-icon` 22px, `.program-drawer-close` 26px and `.product-madr-mini-arch-toggle` 32px survive in the three unguarded sibling sheets.

### L5 — Six radii and one named survivor
Every `border-radius` ∈ `{4,8,10,14,18,999}` via `var(--r-*)`, plus `--r-bar` (2px) permitted on exactly two selectors. Zero occurrences of 3px, 2px elsewhere, 1px, or 0.
**Test:** also assert `var(--r-6|--r-12|--r-16|--r-20)` appears zero times — writing one yields an invalid declaration and a square corner, by design.

### L6 — Three theme states resolve
Tokens declared on `:root`, not on `.product-app`. Bare `:root` = complete light palette. Dark declared twice: `@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]) }` and `:root[data-theme="dark"]`. `color-scheme` agrees with the palette in each block.
**Test:** three JSDOM/Playwright passes asserting `--bg-base` = `#F6F6F7` (no attr + system light), `#0D0D0F` (no attr + system dark), and that `[data-theme]` wins in both directions. **Current: `prefers-color-scheme` appears zero times in `packages/web/src`; the default theme is `'light'` and renders dark pixels while telling the OS the page is light.**

### L7 — Never invent a number
Any value the engine computes renders as `<span class="ph">‹label›</span>` — single guillemets `&#8249;`/`&#8250;`, never `< >`; `.ph-on-dark` on a filled ground.
**Test:** fixture-free render of each surface; assert no numeric literal appears in a slot listed as engine-computed (counts, sizes, elapsed, costs, branch names, user file paths). Literals permitted only where derivable from what is drawn.

### L8 — Focus is a double ring and is never removed
Every `outline: none` (or `outline: 0`) in the product tree is accompanied, in the same rule, by `box-shadow: 0 0 0 2px var(--bg-base), 0 0 0 4px var(--accent)` and `border-radius: inherit`.
**Test:** AST pass over the 5 sheets.

### L9 — One glyph, one written meaning
A single inline SVG sprite. Every `<Icon name>` used anywhere resolves to a symbol that has a row in an `ICON_MEANINGS` table giving its meaning **and** the surfaces it appears on. No symbol name may be an alias of another. Every added symbol carries a written justification.
**Test:** (a) every rendered name ∈ table; (b) every table entry has a non-empty meaning; (c) zero unreachable drawings; (d) **zero name aliases** — currently 67 names → 56 drawings via 11 aliases, with one drawing (`LEDGER_GLYPHS.message`) unreachable and 17 names never rendered; (e) assert `▶ ❚❚ ■ ✓` appear zero times as literal text (currently 12 call sites).

### L10 — One stroke weight
`stroke-width: 1.5` is set once on `.i`; no symbol sets its own `stroke-width` or `fill`. Sanctioned exceptions, named: `ic-more` (filled, r=.9) and the three zero-length cap-dot paths (`h.01`) in `ic-alert`/`ic-info`/`ic-help`.
**Test:** assert zero `stroke-width=` attributes in the sprite; assert no product SVG uses a weight other than 1.5. **Current: `strokeWidth={14}` ×3, `{2}` ×2, `{2.1}` ×2, `{1.9}`, `{1.6}`.**

### L11 — Every colour-coded state also carries a word
No state is communicated by colour alone. A verdict badge contains the verdict as text; a run row carries the state word beside the dot; a provenance tag is a word before it is a tint.
**Test:** render each state component; assert an accessible text node exists alongside every hue-bearing element.

### L12 — Contrast floors
`--ink-3` is never used on `--surface-4` in dark (4.10:1). No dimming may take readable text below 4.5:1 — the board's current `opacity: 0.4` puts the title at **3.12:1** and the subtitle at **2.55:1**.
**Test:** computed-contrast assertion over the ink×surface matrix plus every `opacity` applied to a text-bearing container.

### L13 — No page-level horizontal scroll
Wide content is wrapped in an `overflow-x: auto` container; the document never scrolls horizontally.
**Test:** at 1440px and 700px, `document.documentElement.scrollWidth <= clientWidth`.

### L14 — The board's own laws (new, Sequence-specific — see §4)
Kind is never carried by a border. A state change may move only `border-color`, `background`, `opacity` — never size or position. Selection outranks every other carrier, and must be *more* visible than the state it replaces, not less. A node card's content fills its box or the box shrinks.

---

# 3. RANKED WORK

Ordered by user-visible impact, with Max's four priorities weighted to the top. **W0 is a prerequisite for W1–W5** and is itself highly visible (it changes every colour and every corner in the app).

---

### W0 — The token layer swap · **XL (~5–7 days)** · *prerequisite*
**Changes:** rename the 9 collisions to `--seq-*`; lift the token layer from `.product-app` to `:root` in three theme states; import Graphite's 128 tokens; re-point all 223 Sequence names family by family (§1); delete the 24 `--steel-*` and ~50 aliases; write the light palette.
**Files:** `product.css` (token blocks + every call site), `styles/programs.css`, `styles/madr.css`, `styles/settings.css`, `ledgerTheme.ts`, `useProductCanvasColorMode.ts`.
**Locking test asserts:** L3 (0 hexes), L5 (radius set), L6 (3 theme states), and that `getComputedStyle(:root).getPropertyValue('--sp-2')` is `2px`, not `8px`.
**Blast radius:** 49 test files read `product.css`. Five carry hard locks: `brandTokens.test.ts` (extracts both token blocks by the literal selector string `"html[data-theme='dark'] .product-app"`), `chromeDensity.v31.test.ts`, `workspace/popoutConsole.test.ts`, and `surfaceRamp.v31.test.ts:90`/`:196` (same selector string). Lifting to `:root` breaks those two independently of any value change. `product.css:17` records the surface ramp's 1.11:1 card-on-ground contrast as *"Locked by surfaceRamp.v31.test.ts"* — Graphite's `#1A1A1D` on `#0D0D0F` is 1.118:1, so the lock must be **re-derived, not just re-run**.

---

### W1 — The architecture board's back half · **XL (~6–8 days)** · *Max: "off-putting"*

**The mechanism, stated plainly.** `layoutOptionsFor('layered')` sets `'elk.direction': 'RIGHT'`, so entry and gateway sit left and datastores and topics accumulate on the right. Those two kinds carry the two hues that are also the status vocabulary — `--k-store #5e9c72` **is** `--ok`, `--k-topic #c09551` **is** `--warn` — so the downstream half of every board is a wall of green and amber that means *passed* and *warning* everywhere else in the product. Those same cards are the emptiest: no `detail.whatItDoes` → no subtitle, and `expandable` is false for storage and topic, so a 96px `min-height` block box holds one ~16px line of text over **≈60px of dead ground**. On top of that, selecting a node drops its border from 3.17–4.09:1 to **1.54:1** (`--acc-line` over `--card`) and dims everything else to **3.12:1 / 2.55:1**; the bottom-left corner ships React Flow's *light* library chrome (`#fefefe` buttons) overlapping the kind legend, whose border is `var(--ink) #dcdee0` at **12.75:1** — three to seven times louder than any node or edge on the canvas; and two grids at 24px (dots, static) and 26px (lines, tracking) beat against each other.

**Changes, in order:**
1. **Move the kind carrier off the border.** Border → `--edge` for every node in every resting state. Kind → the 6px dot + a mono `--t-10` kind tag, on `--viz-2..--viz-6` (§1.6), entry neutral.
2. **Fix selection so it wins the eye, not just the cascade.** `--state-selected` fill + `--accent` at full strength on the dot/ring, never `--acc-line`'s 1.54:1.
3. **Fix dimming.** Raise the floor from `opacity: 0.4` to a value that keeps title ≥4.5:1, or dim only the *edges* and desaturate cards rather than fading text. Also: `dimmed` currently fires on any single-node click, not just playback — gate it to playback and explicit path-focus.
4. **Fix the card box.** `display: flex; flex-direction: column`, content-driven height with `min-height` as a floor, so a one-line card is a one-line card. The full-bleed expand row currently floats ~40px above the bottom edge when no subtitle renders.
5. **Kill one grid.** Keep the dot field, move it *inside* the transform, delete the 26px line background.
6. **Theme the React Flow chrome and stop the collision.** Pass `colorMode="dark"` with an explicit `--xy-background-color: transparent` (otherwise `.react-flow` paints `#141414` over the ground), style `.react-flow__controls`/`__selection` from tokens, and pin the Controls cluster clear of `.arch-rf-bottom-chrome` (both currently `z-index: 5`, 1–3px apart, order-broken).
7. **Quieten the legend.** `border: 1px solid var(--edge)`, `--r-14`.
8. **Hide the eight non-functional handles.** `nodesConnectable={false}` yet eight 8px `!important` nubs are painted per node, half-hanging outside the card — the single most "wireframe" tell on the surface, worst on the sparse back-half cards.
9. **Type onto the ramp:** 12.5→13, 11.5→11, 9.5→10, 9→10 (edge labels; hide below a zoom threshold rather than shrinking).
10. **Radius 3px → `--r-14`; add `--e1`.** Card-on-ground is currently 1.109:1 with `box-shadow: none` in all five states — which is *why* the hue was pushed onto the border in the first place. Give it tone + elevation and the border can go quiet.
11. **Fix `.arch-rf-edge-declared`.** It strokes `--deny` (red = "failed/blocked"). A configuration claim source could not confirm is `--unknown`, not a failure.
12. **Delete the dead chrome:** `.arch-rf-cmd` (+`-caret`, `-kbd`) has no renderer; `.arch-rf-lvls`/`.arch-rf-lvl*`/`.arch-rf-layout*` have no renderers; the `:has(.propbar)` lift targets a `position: static` element and a non-existent component; `ProductBoard.tsx:142` is `void visibleNodeIds;` — search and role filter are computed and discarded.
13. **Fix the legend filter.** Filtering to Storage or Topic drops every edge (`archNodeModel.ts:186`) and the ELK effect's deps `[doc, level, layoutId]` omit `kindFilter`, so survivors keep full-graph coordinates and the camera zooms to a sparse wreck.

**Files:** `product.css:7102-7995`, `arch/ArchCanvasBoard.tsx`, `arch/ArchNodeCard.tsx`, `arch/archNodeModel.ts`, `arch/archKinds.ts`, `arch/useProductCanvasColorMode.ts`, `ProductApp.tsx`, `ProductBoard.tsx`.
**Locking test asserts:** no `.arch-rf-*` border/stroke resolves to a verdict or accent token (L1); dimmed title contrast ≥4.5:1 (L12); a node with no subtitle renders height ≤ 2 text lines + padding; exactly one background-image on `.arch-rf-root`; `.react-flow__controls` and `.arch-rf-bottom-chrome` bounding boxes do not intersect; zero `#fefefe`/`#eee`/`rgba(0,89,220,…)` in the rendered board; `.arch-rf-edge-declared` stroke resolves to `--unknown`.

---

### W2 — Modules on the board · **L (~4–5 days)** · *Max: "it doesn't show the modules"*
Modules are representable in data and **invisible in the picture**. `ArchPresentKind` has no `module`; `presentKindFor()` returns `'service'` for module/file/package/function, so the one path that shows sub-service granularity (`microDocFromParts` → `openMicroPartsScope`) draws a board of mislabelled blue "Services". `ARCH_KIND_LEGEND` has five entries and no Module. `partsPreview` is computed at `archNodeModel.ts:174` and has **zero readers**. `level` is hard-pinned to `'L2'` at `ArchCanvasBoard.tsx:244`, so the L3 "internal parts on cards" view is unreachable. `ArchNode.parentId`, `SeqDiagramGroup{memberIds}` and `SeqDiagramBoundary{memberIds, external}` all exist in schema and **nothing renders them** — `seqdFromGraph.ts:81-84` flattens children into a `detail.parts` string list printed on the card face.

Sequence's own book already says the code is wrong here: `fragments/group-ii.html:1090` assigns `module → --k-entry` and `group-i.html:579` writes the cascade rule; the book names four board kinds (service, datastore, topic, **module**) and says agent ownership is not a board kind. The code shipped five, invented `entry` and `agent`, and dropped module.

**Changes:** add `module` as a first-class present kind on `--viz-6`; add a Module legend entry; render `parentId`/`groups` as React Flow parent/child (RF 12 supports nested nodes natively) so a service can *contain* its modules; render `partsPreview` or delete it; un-pin L3 behind `l3DiffersFromL2()`; stop `microDocFromParts` fabricating a linear `part-0 → part-1 → part-2` chain (it violates the file's own stated doctrine *"never fabricates topology"* and Law 4).
**Files:** `arch/archKinds.ts`, `arch/archNodeModel.ts`, `arch/ArchCanvasBoard.tsx`, `arch/ArchNodeCard.tsx`, `board/microDocFromParts.ts`, `board/seqdFromGraph.ts`, `arch/archLevels.ts`.
**Locking test asserts:** a doc containing a node with `parentId` renders a container node with that child inside it; `presentKindFor({kind:'module'})` === `'module'`; the legend has 6 entries including Module; no synthesised edge exists whose `origin` is not `deterministic|llm|design` with evidence.

---

### W3 — The canvas becomes Miro-shaped · **XL (~7–9 days)** · *Max: "more Miro board style"*

Ranked within the item by how strongly each absence reads as "not Miro":

1. **The grid does not pan or zoom.** `.product-board-whiteboard-viewport-grid` is a **sibling** of the transformed layer; nothing ever writes `background-position` or rescales `background-size`. Content slides and scales across a nailed-down backdrop. **This is the single biggest tell.** Fix: move the field inside the transform (or drive `background-position`/`-size` from the camera), and make it a **dot** field, not lines.
2. **Plain wheel zooms; two-finger scroll never pans.** `handleWheel` maps `deltaY` straight into `wheelBoardZoom` with no `ctrlKey` branch; Architecture leaves RF's `zoomOnScroll: true / panOnScroll: false`. Miro and Figma both do the opposite. Fix: scroll pans, ctrl/cmd+scroll zooms, on both surfaces.
3. **No multi-select, no marquee on Canvas.** Selection is three **scalars** (`selectedWhiteboardShapeId`, `…StrokeId`, `…LinkId`); a miss on empty space starts a pan, so there is no rubber-band path at all. Architecture *does* have shift-drag marquee via RF defaults but paints it in `rgba(0,89,220,.08)` — a blue that exists nowhere in the palette.
4. **No resize handles.** A sticky drawn too small can never be enlarged, only deleted and redrawn. `updateWhiteboardShape` is only ever called with `{x,y}`, `{textAlign}`, `{fill}`.
5. **No frames/groups on either surface.** `WHITEBOARD_SHAPE_KINDS` has no frame kind and no containment. Nothing moves a set of objects together, titles a region, or zooms to one.
6. **No snapping, no alignment guides.** `snapToGrid`/`snapGrid` never passed; move writes raw coordinates.
7. **No minimap anywhere.** Zero `MiniMap` references in the whole package.
8. **Two zoom clusters, two corners, two languages.** Arch: RF Controls, bottom-left, un-tokened. Canvas: hand-built `.product-board-zoom`, bottom-right, tokened, with `−`/`+`/`Fit`. Neither shows a percentage. Fit policies differ too: padding 0.2/maxZoom 1/minZoom 0.6 vs padding 0.08/maxZoom 3.
9. **Cursor is `crosshair` even when the only gesture is pan** — `-draw` class applied unconditionally, and it wins on source order over `cursor: grab`.
10. **Selection has no bounding box on either surface** — Arch is a border-colour swap, Canvas is `stroke-width: 1.5 → 2.5`. No handles, no rect, no count.

**Keep, do not regress:** the orthogonal elbow router with obstacle avoidance and longest-run label anchoring (better than Miro); the screen-anchored contextual format bubble on Canvas selection; sticky notes and tables (but promote them out of the "Tools" popover onto the rail).

**Files:** `board/WhiteboardBoard.tsx`, `board/draw/WhiteboardLayer.tsx`, `board/whiteboardModel.ts`, `board/draw/WhiteboardShapeFormat.tsx`, `arch/ArchCanvasBoard.tsx`, `product.css:2772-4700`, `board/useBoardViewportGestureLock.ts`, `canvas/fit.ts`.
**Locking test asserts:** grid `background-position` changes when the camera pans and `background-size` scales with zoom; wheel without ctrl changes pan offset and not zoom; a drag on empty space with the select tool produces a selection rect and a multi-item selection; a selected shape exposes 8 resize handles; cursor is `grab` when tool==='select'; one fit policy shared by both surfaces.

---

### W4 — The icon vocabulary · **L (~4–5 days)** · *Max: "no too much icon reuse"*

The complaint is correct and the diagnosis is two failures, not one. **(a) One drawing, many meanings:** the three-circle graph (`workflow`/`network` — one drawing) means AI model, service node, data access, Workflows, Build end-to-end, map view, routing, blast route and work-session identity — **11 meanings**. The tray-arrow (`export`/`arrow-up` — one drawing) is Export, Save, **Send message** and "Send the result somewhere". The pencil (`draw`/`pen`) is Draw, New board, Rename, Add note, Plan tasks and **"Accept & write all files"**. The X (`x`/`deny`) is 26 harmless dismissals plus 2 consequential rejections. **(b) One meaning, many drawings:** "More" is `overflow` (topbar), `chevron` (board foot, arch toolbar) and `list` (scratch) — three marks; "Accept" is a checkmark in chat and a **pencil** in the gateway card, and the pencil version is the one that overwrites files; "Attach" is `attach` vs `plus`; "Save" is `export` vs `file`; "Investigate" is `search` vs `branch`.

The single most visible instance: the topbar overflow menu shows **two duplicate pairs in one 7-row popup** — pencil for both "New" and "Draw", tray-arrow for both "Export" and "Save".

**The Graphite move is not to prune glyphs — it is to introduce a vocabulary so reuse becomes visible.** Graphite is *not* strictly one-icon-one-meaning: `ic-check` legitimately means "passed, accepted, done". The actual test is whether one glyph stands in for two things a reader must tell apart — which is why Graphite drew `ic-file` ("distinct from ic-dataset, which is a table") and `ic-code` ("distinct from ic-terminal, which is a shell").

**Changes:** port the 58-symbol sprite + the `.i` class (16/14/12/18/20 sizes, one 1.5px stroke that does not scale) + the written name→meaning table; delete all 11 aliases; fill the 17 unused names (`save`, `open`, `check`, `store`, `play/pause/stop` already exist as drawings and directly resolve five of the collisions above); replace the 12 literal `▶ ❚❚ ■ ✓` text characters; add `ic-gear` (Sequence's `settings` glyph is geometrically Graphite's `ic-sliders` = *hyperparameters*, and `AccountSettings.tsx:23` even calls its class `settings-gear`); add four chevron directions and rotate the disclosure caret; give the six-preset session icon picker six *distinct* drawings (two pairs currently render identically).
**Files:** `ui/Icon.tsx`, `ui/iconVocabulary.v31.test.ts`, ~25 call-site files, `product/sessionModel.ts`, `programs/*`.
**Locking test asserts:** L9 + L10 — zero aliases, zero unreachable drawings, every rendered name in the table, every table entry names its surfaces, zero literal glyph characters, and **no two entries in the same menu render the same symbol**.

---

### W5 — Spacing, type and the control ladder · **XL (~6–8 days)** · *Max: "fix the spacing", "consistent throughout"*

Sequence's product surface is **84% un-tokenised on spacing**: 597 of 713 padding/margin/gap declarations are raw pixels; 866 raw px declarations across padding/margin/gap/height/font-size in five sheets.

Worst surfaces, in order:
1. **Settings is authored twice at two densities in two sheets.** 11 selectors declared in both `product.css` and `styles/settings.css` at identical specificity; load order means **`product.css`'s copy never renders — it is dead code**. `.settings-page-card` `padding: 26px 28px 30px` loses to `22px 22px 24px`; `.settings-block` `gap:24px; padding:20px 0` loses to `padding:16px 18px; gap:20px`. Delete the `product.css` block, then re-base `settings.css` to 16/12.
2. **The first-run guide `.fr-*` runs a wholly private rhythm** — four type sizes (11/12.5/13/16), spacing at 2/3/5/6/7/9/11/13/16/18px. Not one value is on the ladder. Rewrite rather than patch.
3. **The pill/badge primitive ships four horizontal paddings across 14 rules** (`2px 6px|7px|8px|9px`). 7px and 9px are on no ladder. Collapse to one primitive.
4. **Icon buttons at six sizes; chrome bars at five heights; four row pitches** (17/19/26/32px) for the same class of row. Thread rows are 32px, 4px taller than Graphite's 28px; `--row-h: 26px` is referenced **once** in the whole surface.
5. **Two pick-row lists inside the same composer at 32px and 40px**, one behind `var(--menu-row-h, 32px)` — a token declared **nowhere** in any of the five sheets.
6. **101 declarations on odd pixels** the 4px base cannot express, producing adjacent-sibling contradictions (`.fr-dots { gap: 7px }` beside `.fr-actions { gap: 8px }`; `.settings-page-title { gap: 5px }` beside `.settings-page-close { gap: 6px }`).
7. **14 paddings at ≥16px** where Graphite caps at 16 (panel) / 12 (card), topped by `.product-board-whiteboard-empty { padding: 48px 24px }`.

**Files:** all five sheets — `product.css`, `styles/programs.css`, `styles/madr.css`, `styles/settings.css`, plus `controlLadder.v32.test.ts`.
**Locking test asserts:** L4, extended to **all five sheets** (currently `product.css` only, 11 selectors) plus a global "no raw pixel in padding/margin/gap/height/font-size in the product tree".

---

### W6 — The composer and the signature send button · **M (~2 days)**
The circular filled send button is named the signature element in **six separate places** across Graphite (README:38, README:386, `_core.html:392`, page 10, page 19 ×2, page 39, DESIGN_DIRECTIVES §5), always with the negative clause *"round, not a square with soft corners"* — and Graphite page 39 records that its **own** design system specified a square and was wrong. Sequence ships it at `--r-composer-btn` → `--r-ctl` = **2px**, with `product.css:3836` documenting the square as deliberate policy.
**Changes:** send → 28×28, `--r-full`, `--accent-solid` fill, `--accent-on-solid` `ic-send` at 14px, `border: 0` in every state, hover `color-mix(… 86%, #fff 14%)`, active `scale(.94)`, disabled `--surface-3` + `--ink-4` (**never a dimmed accent**), and disabled while the field is empty. Composer shell → `--r-18`, `--surface-1`, `--e2` → `--e3` focused, padding 10/10/8. Field → `--t-14`/`--lh-14`. `.plusbtn` 24px `--r-full`. `.modelsel` 24px `--r-8` borderless. Under-composer strip 20px `--minitabs` outside the border. Fix the 12px/22px line-height.
**Files:** `ProductComposer.tsx`, `product.css:2210-2600`, `:3836`.
**Test asserts:** computed `border-radius` on the send button ≥ 999px; `--r-composer-btn` resolves to `--r-full`; composer `border-radius` is 18px; zero accent on the composer when the field is empty.

### W7 — Buttons, inputs and controls · **L (~4 days)**
Sequence has two button weights; Graphite has six shapes on one 28px chassis (`.btn`, `.pill`, `.ghost`, `.solid`, `.sm`, `.iconbtn`) plus eight input shapes composed from the same tokens (Graphite ships **no** `.input`/`.select`/`.toggle`/`.slider` class — every page-11 specimen is inline-styled from button-chassis tokens, so Sequence must author those classes fresh against the values). Disabled becomes `--ink-4` + `--edge-faint` + transparent, replacing Sequence's `opacity: 0.45` — *a dim, not an absence*. **Solid is a budget: exactly two sanctioned uses in the entire product** — send, and the primary action of an approval. Destructive is not a variant class: it is `.btn` with `--wont` on glyph and label only, neutral fill/border/hover, and the disabled destructive drops the red entirely. Focus → the double box-shadow ring, replacing `outline: 2px solid` + offset.
**Test asserts:** L2, L8; every control height resolves to a token; zero `.btn.solid` outside the two whitelisted call sites.

### W8 — Chrome: rail, top bar, pane, transcript, tool rows · **L (~4 days)**
Three headers on one 44px line (`--topbar-h` 40→44). Rail 300→280px with clamps. Rows: 30 (rail/folder/account) / 28 (thread) / 24 (section head, mono uppercase **`.08em`** — page 17's `.09em` is the error, the CSS is right). Top bar padding `0 12px`, gap 8px, right cluster 6px, `--e0`, one 1px `--edge` bottom hairline. Pane header `0 10px`, right cluster gap **2px** (deliberately tighter). Transcript: `--col-max` 720px centred, padding 20/20/8, **16px between turns**; user = bubble at 82%/`--r-18`/`--t-14`, assistant = plain full-width prose at `--t-15`/`--lh-15`, **no bubble, no avatar, no role marker**. Tool rows 26px/`--r-8`/`0 10px`, stacked at 2px with `margin-left: -10px` so glyphs align with prose. Verdict badge shrinks to 16px/`0 6px` inside a 26px row.
**Test asserts:** the three header heights are equal and 44px; thread row 28px; turn gap 16px; assistant prose has no background and no border.

### W9 — Semantic vocabularies: verdicts, provenance, run states · **L (~4 days)**
Ship the three vocabularies that **share hexes but never share tokens**: `.verdict` (22px, `--r-full`, mono `--t-10`, weight **700**, `.08em`, uppercase, colour + wash + 1px wash-edge — the only caps in the product); `.prov` (16px, `--r-full`, mono `--t-10`, weight **500**, `.07em`, **no border**, never rendered without the number it describes); `.dot` (6px + `.hollow` 7px/1.5px + `.ringed` `::after inset -3px` + `.pulse` 1.8s→.42, coloured by `--st-*`, always beside a word, **never a row background or border**). Provenance is the biggest conceptual win available: Sequence's "declared vs traced" honesty pattern *is* Graphite's provenance grammar, and the strings `provenance`/`Provenance` appear **0 times** in Sequence's 401KB book.
**Test asserts:** L11; `.prov` has no `border` property; run rows reference `--st-*`, never `--fits`/`--wont` directly.

### W10 — Overlays, dialogs and the approval card · **M (~3 days)**
Sequence's book contains `tooltip` ×2, `popover` ×1, `dialog` ×0, `approval` ×0. Graphite dedicates two pages to four transient surfaces plus the approval card. Build them: `--surface-3` for transient, `--surface-4` for interrupting (*sparingly*), `--e3`/`--e4`, `--scrim`.

### W11 — Empty, loading and error states · **M (~3 days)**
`.empty` = **dashed `--edge-strong`** at `--r-14` with an icon and the mandatory three parts. Currently `.arch-rf-scope-empty` is `position:absolute; inset:0; background: var(--card)` — an opaque sheet over the whole canvas with one paragraph, no icon, no radius, no frame — and `BoardEmpty.tsx` is a *second, unrelated* empty language. Add skeletons and streaming (Sequence's book mentions `skeleton` ×2, `streaming` ×0).

### W12 — Light theme · **L (~4 days)** · *also a live bug today*
`getLedgerTheme()` defaults to `'light'`; `applyLedgerTheme` writes `html[data-theme='light']` **and** `documentElement.style.colorScheme = 'light'`; there is **no `html[data-theme='light']` rule anywhere** in `packages/web/src`. So first run renders Console dark pixels while telling the OS the page is light — native scrollbars, `<select>` dropdowns, date pickers, autofill and form chrome are drawn light on a near-black app. Fix falls out of W0 if W0 writes the light palette; the switch and `color-scheme` must be wired to it in the same change.

### W13 — Board density, overflow and zoom · **L (~4 days)**
No LOD, no culling, and edges re-route against **every** node on every render: `routeOrthogonalElbow({ obstacles: boxes })` is called inline with no `useMemo` where `boxes` is all nodes, in a component subscribed to `useNodes()`/`useEdges()` — O(E×N) during drag and pan. `onlyRenderVisibleElements` unset. `minZoom={0.2}` against a 12.5px title renders text at **2.2px**. The 11-node shopfront fixture hides all three; a real scanned repo does not. Add memoisation, culling, and a level-of-detail ladder (drop the expand row, then the subtitle, then the port, then the title). Keep the existing honest caps (`INTERIOR_LIST_MAX = 20` with a **reachable** "+N more", `MAX_BOARD_FLOWS = 5`) and write them down.

### W14 — Programs / workflows consistency · **M (~2 days)**
Inside one panel, the same template gets different icons in the rail and the library (`PR triage` = `github` vs `terminal`; `Dogfood` = `terminal` vs `wrench`), and `branch` means *parallel* in the rail and *decision* in the intents list while `split-right` means *parallel* in the intents list. Adopt the run-row grammar from W9.

### W15 — The book · **XL (~8–10 days)** · see §4

### W16 — Governance and the parity checklist · **M (~2 days)**
Extend `controlLadder.v32.test.ts` to all five sheets. Re-derive `surfaceRamp.v31.test.ts` and `brandTokens.test.ts` for `:root`. Rewrite `assemble.py`'s `recompute_sheet36()` and `S36_GROUNDS` for the new grounds in both themes. Delete the MUST_CARRY entries that pin the retired rulings (§5, R5). Fix `rendercheck.py` (hard-coded Linux Chrome path; `BOOK.read_text()` without `encoding="utf8"` crashes on Windows on the book's em-dashes).

---

# 4. THE BOOK

Sequence's book is one 401KB HTML file, 40 `<section class="page" id="sNN">` sheets in four groups, assembled by `tools/assemble.py` splicing five fragments into five markers in `tools/framework.html`. **Sheets 01 and 39 live in the framework, not in any fragment.** Fragment ownership: `group-i` → 02–12, `group-ii` → 13–22, `group-iii` → 23–34, `group-iv-a` → 35–38, `group-iv-b` → 40.

**Arithmetic: 40 → 52.** 1 retired, 2 folded away, 37 surviving, 15 new. If 52 is too many, merge the two smallest board sheets to land at 50.

### Rewritten against a named Graphite page (21)

| Sheet | → Graphite | The correction |
|---|---|---|
| 01 Cover | 01 | Claim chips currently read "Inter Variable"; the face changes. |
| 02 Thesis | 01 §1.1–1.5 | *"Low contrast is the feature"* is **retired**. Adopt the laws + the reading key + what outranks what. |
| **03 Colour system** | **02 + 03** — splits into two sheets | Six dark rungs → two grounds + four surfaces + three edges, **in two themes**, with the measured matrix. |
| 04 Signal budget | 04 | Seven-place accent budget → three permitted families + nine prohibitions. **The E4 gradient sanction is retired** — Graphite's only `linear-gradient` is a 135° over-budget hatch. |
| **05 Kind hues / status** | **05** | **B1 (`"Kind owns the resting card edge"`) is deleted.** Adopt four verdicts + run lifecycle + provenance. |
| 06 Data colour | 06 | One-hue five-step ramp → six categorical series + chart furniture; the ramp survives as a declared sequential extension. |
| 07 Type ladder | 07 | 15 steps + Inter → 9 steps + Instrument Sans, capped at 26px. |
| 09 Space / grid | 08 §8.1 | 7 steps → 12. **The three density tiers are deleted** — compact is the only density. |
| 10 Radius / border / depth | 08 §8.2–8.4 | 3px/2px → six steps. ***"Elevation — there is none"* is retired**; `--e0..--e4` ships. |
| 12 Icons | 09 | 16-mark register + 55-glyph table → the 58-symbol sprite with a written meaning per name. |
| 13 Buttons | 10 | Two weights → six shapes, solid-is-a-budget, the send button, destructive-without-red. **`"no blurred shadow, ever"` is retired.** |
| 15 Menus / palette | 14 | Menus only → four transient surfaces + how to choose between them. |
| 16 Chips / badges / dots | 12 | ~2 shapes → the closed inventory of seven, plus §12.7 refusals. |
| 19 Meters | budget-bar contract | The track is a **SCALE, not a container**: 100% = max(required, available); segments `--viz-*`, the 2px boundary rule takes the verdict colour. |
| 21 Tables / rows | 21 + 26 | Generic row taxonomy → semantic cut: tool row 26 / run row 38 / rail 30 / thread 28. |
| **26 Declared vs traced** | **13 Provenance** | **The single biggest conceptual win.** The withheld-edge honesty pattern becomes the four provenance tags + the `.ph` placeholder grammar. |
| 27 Chat panel | 20 | 250px side column → two lanes in a 720px centre measure; user bubbles, assistant plain prose. |
| 29 Functions rail | 17 | 300px right rail → 280px with clamps; one row pitch; the sub-10px type needs a sanctioned exception (§5, R8). |
| 30 Chrome | 18 | 40px bar → 44px, three headers on one line. Breadcrumb / statusbar / level rail are deletion candidates. |
| 35 Empty / loading / error | 16 | Adds skeletons and streaming; mandatory three parts on an empty state. |
| 36 Accessibility | 02 §2.2 + 03 §3.4 | **The low-contrast licence is retired.** Recompute the whole matrix, both themes, four new grounds. Focus becomes the double ring. |
| 39 Token dump | 40 + `tokens.css` | Becomes the new token contract: `:root`, three theme states, 128 + declared Sequence extensions. |
| 40 Checklist | 39 + 40 | Ten boxes → a parity checklist against a named reference + the testable definition of done. |

### Folded away (2)
- **08 "Type in practice"** → into 07 (Graphite 07 §7.3–7.5).
- **28 "Composer states"** → into the new Composer sheet (Graphite 19 covers anatomy, control row, targets, rules — Sequence documents states only).

### Retired (1)
- **38 "Light annex · specification only · not built"** — Graphite law 5 makes light a first-class theme on bare `:root`. There is no annex; light appears on every colour sheet. Its seven hard-coded hexes (`#F4F5F4 #FFFFFF #26292B #3E4346 #71767A #E2E4E4 #3D6BB8`), whitelisted in `assemble.py` purely for this sheet, go with it.

### Kept and re-governed (14)
- **11 Motion** — re-derive from `--dur-1`/`--dur-2`/`--ease` (all three change).
- **17 Card anatomy** — Graphite has no card-anatomy page; keep the redline, re-derive from Graphite radii/space.
- **18 Stat tiles / numerals** — no Graphite page; adopt `--num` and 07 §7.5.
- **20 Heatmaps** — re-govern under the viz namespace, not `--h0..--h4`.
- **22 Node card** — Sequence-only; **this is where W1's redline lands**. Delete the coloured resting edge.
- **23 Edges** — Sequence-only; correct `declared` from `--wont` to `--unknown`; keep the seven retired protocol hues retired.
- **24 Architecture board** — Sequence-only keystone; rewrite for the new board.
- **25 Flow playback** — keep; typeset the "no evidence on this hop" case with provenance grammar.
- **31 Workflows / kanban** — keep; adopt run-row grammar.
- **32 Draw mode** — keep.
- **33 Impact / risks / cycles** — keep the subject; lift the card chassis from Graphite 22.
- **34 Work | Code sessions** — keep; adopt the segmented control from Graphite 11 §11.5.
- **37 Voice / microcopy** — keep; source from law 4, the `.ph` rule, and the fixed-verb rule.
- **14 Inputs** — survives as the inputs sheet after the composer splits out.

### New (15)
**Board family (9)** — none has a Graphite page and none has a Sequence sheet:
1. **Containment and modules** — *the sheet W2 is blocked on.* "nesting" returns zero hits across all 40 Graphite pages.
2. **Node states and carrier precedence** — eight simultaneous states; Graphite has no page where two carriers compete for the same pixel.
3. **Edge families and the label plaque** — 8 ArchGraph edge kinds → 7 families; the 9px plaque is below Graphite's floor and needs a ruling; `db_access` is an edge whose *direction* is the unknown, and Graphite has no grammar for an arrow we refuse to point.
4. **Depth levels L1/L2/L3** — a standing filter that *hides real nodes*; Graphite's only disclosure page (14) is entirely additive.
5. **Density, overflow and the honest cap** — a list's overflow is a scrollbar; a graph's is a hairball. Records `INTERIOR_LIST_MAX = 20` and `MAX_BOARD_FLOWS = 5` and the owner report they came from.
6. **Zoom, pan, fit and level-of-detail** — Graphite assumes 1:1 and fixes type at 10/11/12px absolute; at `minZoom 0.2` an 11px title is 2.2px.
7. **The breakout interior** — why the list is the default and the diagram is behind a toggle.
8. **The proposal layer** — a persistent second graph, not an approval dialog. Needs a fifth provenance state ("proposed, awaiting a human") or its own.
9. **Confidence and edge evidence** — `confidence: number` on a five-rung calibration ladder; recommendation is to map the rungs onto the four tags and **never render the float**.

**Canvas (1)**
10. **The canvas** — dot pitch and ink, camera model, selection rect, frames, snapping, the zoom cluster's shape and corner. *Write this before W3 starts, or every value in W3 is a fresh guess.*

**From Graphite pages Sequence has no counterpart for (5)**
11. Provenance in situ *(replaces 26 — listed above; counted there, not here)* → so instead: **Overlays** (tooltip / popover / dropdown / context menu).
12. **Dialogs, sheets and the approval card.**
13. **The composer** (split out of 14).
14. **Verdict cards** — one chassis, no fifth answer.
15. **The parity checklist** — Sequence has no parity checklist against any external reference. Graphite dedicates a whole page to one.

### Pipeline consequences
`assemble.py` runs four gates: structural (ids s01..s40 **in order**, balanced sections, `.page-head`/`.page-foot`, every `#sNN` anchor resolves), a report-only hex audit, **24 MUST_CARRY / 14 MUST_NOT_CARRY canon assertions (fatal)**, and `recompute_sheet36()` (fatal). Renumbering to 52 sheets breaks the structural gate; the new grounds break sheet 36; and MUST_CARRY actively blocks the rewrite (§5, R5). Also: `brandTokens.test.ts` lifts the **first** `<style>` from `framework.html`, so the framework head must stay at exactly one stylesheet and no CSS selector name may appear in prose inside it.

---

# 5. RISKS AND CONFLICTS

### R1 — Sequence colours edges and node borders by kind; Graphite law 1 says chrome is never coloured
**This is two different collisions and they resolve differently.**

**(a) The node border is chrome, and Graphite wins.** Five simultaneous coloured hairlines at 3.17–4.09:1, one per node, repeated across the canvas. Sequence's CSS comment at `product.css:7593-7599` anticipates the objection (*"a saturated outline on five kinds turns the board into a rainbow"*) and answers it by desaturating to 65% — it moves the volume, not the carrier. Law 1's rationale applies exactly: *"a coloured divider and a coloured verdict are the same signal to someone scanning, and the divider wins by volume."*
**Resolution:** border → `--edge` in every resting state. Kind → the 6px dot + a mono `--t-10` kind tag + (optionally) an icon. Node relief comes from `--surface-2` + `--e1`, which Sequence currently spends nothing on (`box-shadow: none` in all five states, card-on-ground 1.109:1) — *which is exactly why it had to pay in hue.*

**(b) A graph edge is NOT chrome, and Sequence wins — with a correction.** Law 1's targets are dividers, headings, section rules and borders. A drawn connector between two nodes is the data itself, the way a chart series is. Refusing it colour would be like refusing a chart a second line.
**Resolution:** sanction it explicitly in the new edge sheet, and hold it to the namespace split: **proof state** (traced / on-flow / declared) is a *claim* and takes claim tokens; **family/protocol** is *identity* and takes the label, never the stroke (the seven retired Ledger protocol hues stay retired). And correct the one wrong token: `.arch-rf-edge-declared` currently strokes `--deny` (red = *"Won't fit. Failed. Removed. Blocked."*). A configuration claim source could not confirm is `--unknown` — *"not known, and refusing to guess."* Red is spent.

### R2 — The five kind hues have no Graphite home, and `--viz-*` is a closed door
Graphite page 06.5 says the viz namespace *"escapes the chart frame exactly twice"* — the budget bar and syntax highlighting. A node-kind ramp is a **third** escape and cannot be taken by local invention; Graphite's own rule is *"say so in your handback rather than inventing it locally — six local inventions are six contradictions."*
**Resolution:** raise it as a handback item and take the `--viz-2..--viz-6` assignment in §1.6, skipping `--viz-1` (it is byte-identical to the accent in both themes). **Owner ruling required.** The alternative — dropping kind colour entirely and carrying kind by icon + tag alone — is legal under Graphite today and should be presented as the fallback.

### R3 — Graphite has no board, no canvas, no node, no edge, no containment — 11 Sequence surfaces are ungoverned
Verified by grep across `docs/brand/graphite/pages/`: "zoom", "minimap", "diagram" and "nesting" return **nothing**; "canvas" appears once and only as the HTML `<canvas>` font-measuring API; "node" appears only as a *decision node* in a linear evidence list. Graphite's `--edge` token is a **border**, a direct name collision with `.arch-rf-edge`.
**Resolution:** the 10 new board/canvas sheets in §4 are not optional decoration — they are the prerequisite for W1, W2 and W3 having anything to be correct against. Write the canvas sheet and the node-card sheet *before* the corresponding build lane starts.

### R4 — Graphite has no sequential colour ramp
`--h0..--h4` is a real capability with no Graphite equivalent; a heat ramp cannot be built from six categorical hues. **This is a gap on Graphite's side.** Keep it, derive it, declare it, and raise it.

### R5 — `assemble.py`'s canon lints actively block the migration
MUST_CARRY pins the exact v3.1 rulings Graphite overturns, and the build **exits 1** until they are deleted: **5 entries pinning B1** (`"Kind owns the resting edge…"`, the `.node[data-kind="service"]` cascade, `--k-service</code> ·`), **2 pinning E4 gradients** (`"Gradients — the two sanctioned surfaces"`, `"linear-gradient(180deg, var(--acc-2), var(--acc))"`), **`(None, "Inter Variable", …)` book-wide**, and `("s13", "no blurred shadow, ever")`.
**Resolution:** treat MUST_CARRY / MUST_NOT_CARRY as the migration checklist, not as an obstacle to route around. Each deletion is a decision that needs the owner's name on it.

### R6 — The test estate will go red in ways that are not bugs
49 test files read `product.css`. Two key on the literal selector string `"html[data-theme='dark'] .product-app"` and break the moment tokens move to `:root`. `product.css:17` records a contrast ratio as *"Locked by surfaceRamp.v31.test.ts"* that Graphite's ramp does not reproduce. `assemble.py`'s `recompute_sheet36()` is written against sheet 36's exact table markup and a four-ground list.
**Resolution:** re-derive the locks in the same commit as the value change, never after. A test that locks a defect in is a defect — which is Sequence's own governance sentence from sheet 40.

### R7 — Sequence is *tighter* than Graphite, and Graphite is the compact one
Topbar 40 → 44, rail row 26 → 30, thread row 32 → 28, rail 300 → 280. Adopting Graphite makes chrome *bigger* in two of four cases. That is fine for chat chrome and a genuine problem for the functions rail, which has to carry a real repo's function list.
**Resolution:** adopt Graphite heights for all chat/app chrome unconditionally. For the rail, keep 28/30px rows and solve density with the depth-level filter and the honest cap, not with smaller rows.

### R8 — The 10px type floor vs 102 real call sites
Group heads at **8.5px**, edge labels and the `:line` column at **9px**, node subtitles and ports at **9.5px**, `--edge-tag-size` at **8.75px**. Graphite's floor is `--t-10` and even that is reserved for mono uppercase eyebrows.
**Resolution:** raise all of them to 10px and solve the resulting density with **level of detail**, not smaller type. A 9px edge label at zoom 0.2 renders at 1.8px and is not readable at any size — hiding it below a zoom threshold is strictly better than shrinking it. If any site genuinely cannot be raised, it becomes a *declared, justified* board-only step in the handback — not a quiet literal.

### R9 — "Nothing moves but colour" vs "more Miro board style"
`product.css:7564` restricts node transitions to `border-color`, `background-color`, `opacity` with the comment *"Nothing moves but colour"*, and there is no drag-lift feedback by explicit written rule. Miro's whole feel is objects that lift, snap and settle. **Direct tension between an existing Sequence law and Max's stated priority. Owner decision required.**
**Recommended resolution:** keep "nothing moves but colour" for *state* changes (selection, dimming, flow) — that law is what keeps a 200-node board from vibrating — and permit motion for *direct manipulation* only (drag lift, snap settle, resize). They are different events and the law can be split cleanly along that line.

### R10 — Accent polarity flips twice
Button label ink goes `#0b1220` → `#FFFFFF` on every primary button. Hover goes from *bluer* to *lighter and neutral*, reversing a decision `product.css:32-40` argues for on AA grounds against `#151c22`. That argument does not survive the surface change and must be **re-measured, not re-quoted**.

### R11 — `--viz-1` is byte-identical to the accent
`#5B51D6` in light (= `--accent-solid`), `#8E8AF2` in dark (= `--accent`). Deliberate and documented, safe only because the rule is *directional*: write `--viz-1` when you mean a series and `--accent` when you mean the product's voice. **This cannot be checked by eye** — `--viz-4 #0B7566` is also near `--fits #0C7B53`. The separation is by namespace and intent, so only a lint can enforce it. Do not assign `--viz-1` to a node kind.

### R12 — Graphite contradicts itself in six places; do not silently pick a side
Record these in the handback rather than resolving them locally:
1. **Five laws or six.** `README.md:15` says "The five laws"; `pages/01` is filed as `01-graphite-and-the-six-laws.html`, its header and `data-page-title` say six, §1.2 says "The other five" and contains four panels, a sixth panel follows, and its own contents table says five. Law six's *content* is real (DESIGN_DIRECTIVES §1 and §7) — only the count is inconsistent.
2. **Two different files are both called "source of truth."** `DESIGN_DIRECTIVES.md:127` names `docs/brand/graphite.html` (1,361,257 bytes, the assembled 40-page book, `<html lang="en">` with no `data-theme`); `README.md:7`, `_core.html:11` and `tokens.css:3` all name `docs/brand/option-a-graphite.html` (178,821 bytes, `data-theme="dark"`). Both exist and differ. Every token traces to option-a; the current rendered reference is graphite.html. **Unverified which the owner means when the two disagree.**
3. **Four verdicts or five.** `README.md:396` lists five `.v-*` classes under the caption "The four feasibility verdicts". `_core.html:408-412` defines all five. The reconciliation is that `.v-info` is a **notice**, not a fifth verdict — but the wording is wrong and the older sample at README:497 omits it.
4. **`.09em` vs `.08em`** on the rail section head — page 17's prose says `.09em`, `_core.html:584` says `.08em`, and the page's own rendered specimen uses the CSS. `.08em` is also what `.verdict` and `.card .hd .t` use. **Implement `.08em`.**
5. **Two component line-heights match no token** — `.dev` uses `line-height: 17px` and `.pagehead .lede` uses `20px`; no `--lh-*` equals either. Anyone porting must copy the literals, not derive them.
6. **`--accent-solid-hover` uses 86%/14%** (the send-button curve) where `.btn.solid:hover` uses 88%/12%. Adopting the token for `.btn.solid` is a 2-point shift.

### R13 — Two lanes disagree about consumer vs enterprise. Unverified.
The **laws** lane quotes `DESIGN_DIRECTIVES.md:22-27 §3` verbatim as *"They are separate products sharing an engine… Consumer and enterprise are two separate portals, not a toggle in one shell."* The **seq-book** lane states that §3 *"supersedes the consumer/enterprise split ('There is one product — consumer/enterprise is dropped', Max 2026-08-19)"*. **These cannot both be right, and I have not opened the file to settle it.** It matters: it decides whether Graphite pages 36–38 are current or stale, whether three book slots are free, and whether Sequence's sheet 34 mode switcher is scaffolding or design. **Read `docs/DESIGN_DIRECTIVES.md` §3 before planning the book.**

### R14 — Short class names collide, and Sequence is one flat 8760-line sheet
Graphite reuses 13 short names *on purpose* and scopes them by nesting: `.seg` is the topbar segmented control at top level and a budget-bar segment inside `.budget`; `.k` is a table key cell, a `.kv` label, and a chart legend entry. Graphite's own rule is *"always write them nested inside their parent, never bare."* **A flat stylesheet that lifts these selectors unscoped will silently collide.** Port them nested, and add a lint that fails any bare `.k`/`.v`/`.t`/`.m`/`.w`/`.right`/`.name`/`.file`/`.seg`/`.key`/`.rule`/`.lbl`/`.num` selector.

### R15 — Two hidden landmines worth naming before the first commit
- **`--menu-row-h` is referenced at `product.css:2536` and declared nowhere** in any of the five sheets. The real height is the 32px fallback.
- **`--grid-line` resolves to nothing in product mode** — it is defined at `styles.css:5196` on `:root`, which product mode never loads, so `useProductCanvasColorMode.ts:22` always falls through to a hard-coded `rgba(255,255,255,0.016)`. Lifting the token layer to `:root` may change this silently.
- **`src/styles/board.css` is never loaded in the product shell** — `ProductApp.tsx:11-13` imports only `product.css`, `styles/madr.css`, `styles/settings.css`; `main.tsx` imports `board.css` only on the popout path. Every React Flow theming fix written in `board.css:916-995` (including the exact zoom-cluster collision fix) has never reached the product board.

---

## Sequencing

**Gate 1 (must land first, in this order):** R13 read → the canvas sheet + the node-card sheet (§4 new) → **W0** token layer, with W16's test re-derivation in the same change.
**Gate 2 (Max's four, parallelisable after W0):** **W1** board back half · **W2** modules · **W3** canvas · **W4** icons · **W5** spacing.
**Gate 3:** W6–W12 (composer, controls, chrome, semantics, overlays, empty states, light).
**Gate 4:** W13–W15 (density, programs, the book).

Owner rulings needed before Gate 1 closes: **R2** (kind hue namespace), **R9** (motion on direct manipulation), **R13** (consumer/enterprise), and sign-off on the MUST_CARRY deletions in **R5**.