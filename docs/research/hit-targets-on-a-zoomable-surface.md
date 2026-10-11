# A control on a zoomable surface has a minimum SCREEN size

**Owner ask, 2026-09-02 (relayed):** *"the teaching feature… should be easy to use. The buttons may
be a little bit bigger and easier to click and choose from, because right now they're very discreet,
and sometimes they're hard or easy to mess up."*

That reads like a head-on collision with **Graphite law 3** — *"Compact is the only density… icon
buttons 26px. Airy is a defect."* It is not, and the reason is the finding.

## The measurement, taken from both ends

Measured on the running board (`sequence-app`, this monorepo attached), counting every visible
interactive control against **WCAG 2.2 AA SC 2.5.8 "Target Size (Minimum)" = 24×24 CSS px**:

| board zoom | interactive controls | below 24×24 | of those, on the board |
| --- | --- | --- | --- |
| **1.000** | 71 | 3 | **0** |
| **0.504** | 71 | 13 | **10** |

The ten are the per-node `Open inside <node>` buttons. At either zoom they are **26×26 board
units** — Graphite's rule, obeyed exactly. On screen at 0.504 they are **13.1×13.1 CSS px**.

```
26 board units × 1.000 zoom = 26 px   passes Graphite, passes WCAG
26 board units × 0.504 zoom = 13 px   passes Graphite, FAILS WCAG
```

**Nothing about the control changed.** Graphite specifies sizes in board units; the user clicks in
screen pixels; the board zooms. The sheet is satisfied and the target still fails, and it degrades
further the further out you zoom — at Fit on a large repository these go sub-10px.

## Why this is additive to Graphite, not a reversal

Law 3 governs **visual density**: how much ink sits in how much room, so a board reads as a board
rather than as a form. A hit target is not ink. Counter-scaling the *target* while the painted glyph
keeps its 26-unit look changes no pixel of the design at 100% and adds none of the airiness law 3
forbids — it only stops the clickable region shrinking below what a hand can hit.

So the rule this adds is: **a control drawn inside a zoom transform has a minimum size in SCREEN
pixels, independent of its size in board units.** Anyone reading a bigger number in the code and
concluding the sheet was broken should be pointed here.

## The off-board failures, which zoom does not explain

Three controls fail at every zoom and are ordinary defects rather than instances of the above:

| control | measured |
| --- | --- |
| `Resize chat and architecture` | **8 × 639** |
| `Propose` | 89.1 × **20** |
| `Model context window …` | 56 × **16** |

(The anatomy panel's `Close the anatomy of <node>` measured **65 × 12** when open, making 14 in
that state.)

The resize handle is the sharpest: 8px wide is under a third of the minimum, and it is a control
people drag rather than tap once.

## What the owner actually asked for, separated from what was measured

He singled out **Teach**. Two of his three points are not about size at all, and the size one is the
zoom bug above:

1. **The teach controls should be the easiest thing on screen to hit and choose from** — the mode
   menu row and the step controls, measured against the same 24×24 floor.
2. **The teaching PROMPT is a first-class product surface.** His words: *"the prompt that I send to
   tell a model to teach me is very important. Make sure we stress that when it comes to our actual
   teaching feature."* `docs/teach-mode.md` already carries the graded turn contract and the bench
   number — a visual-present rate of **13.8%** — so the prompt is measurable and currently
   under-performing. It should be treated as a surface with a bench, not as a hidden constant.

## How to measure this yourself

```js
const vp = document.querySelector('.react-flow__viewport');
const k  = new DOMMatrixReadOnly(getComputedStyle(vp).transform).a;   // board zoom
[...document.querySelectorAll('button, [role="button"], a[href], input, [tabindex]:not([tabindex="-1"])')]
  .map((el) => { const r = el.getBoundingClientRect(); return { el, w: r.width, h: r.height }; })
  .filter((t) => t.w > 0 && t.h > 0 && (t.w < 24 || t.h < 24));       // CSS px, not board units
```

**Measure at more than one zoom.** A pass at 100% says nothing about Fit, and Fit is where a reader
spends most of their time on a large repository. This is the same lesson as the rest of
`docs/how-to-verify.md`: the instrument has to read what the user experiences, not what the
stylesheet intended.
