# Walk 4 — white glass becomes the look, then the site, then 0.1.1

Owner, 2026-09-18, after seeing gold and white side by side on the same screens:
"I like the white a lot more, it looks a lot more professional… easier on the eyes… let's set
white as our main thing." With it, a frame: "Google Cursor's agent window UI — not their IDE,
their agent window — that's my kind of goal here." And the shape of the white he wants: "a
little bit darker, with the transparent liquid glass on the chosen stuff — nice and transparent
with a bit of the frosted, not opaque — same with the chat elements, the Send button, around
those white elements."

This is the plan of record for the walk. Each numbered item names its owner, its check, and
what "done" looks like, so nobody has to reconstruct the ask from the transcript.

## 1. The look — app (builder lane)

**Decision 29 becomes the default, then is tuned.** `data-accent="white"` is the root's default;
gold stays reachable from Settings as the alternative, so nothing is deleted and the comparison
can be repeated.

Tuning, in the owner's words and the numbers they turn into:

- *"A little bit darker."* Chosen fills are not white washes on the surface; they are the
  surface one step darker with a white rim: `--accent-chosen` ≈ `rgba(255,255,255,.08)` over a
  ground two or three L\* darker than `--surface-1`, `--accent-chosen-edge` ≈ `rgba(255,255,255,.28)`.
  The accent ink for text stays `--ink-1`; the glow washes drop to `.06–.10` alpha.
- *"Frosted, not opaque."* Every chosen control and every composer control keeps
  `backdrop-filter: blur(var(--glass-ctl-blur))` with a fill thin enough that the ground moves
  behind it (`.10–.14` alpha), plus the top highlight (`--glass-ctl-hi`) — the highlight is what
  reads as glass. Send is the one solid: `--accent-solid` white with `--accent-on-solid` ink.
- *"People can tell what's chosen and what's not."* The chosen tab differs from its neighbours
  by fill (`+.08`), rim (`.28` vs `.12`) and ink weight; the check in `graphite.test.ts` locks the
  three deltas, not the colours.
- *Cursor's agent window as the frame.* Neutral charcoal ground, one white primary, hairline
  rims at low alpha, chips that are translucent not painted, mono only for paths and counts,
  8–10px radii, no colour that is not a status. The Graphite laws already say this; the frame
  is a way to check each surface against something that ships.

**Check:** `graphite.test.ts` (deltas), `V3ContextAndContrast.test.tsx`, a computed contrast
table for Send, chosen tab, chosen mode chip, goal bar, on `--surface-1` and on `--bg-base`
(every pair ≥ 4.5:1), and a screenshot of each mode (Ask, Plan, Build, Teach) with a chosen tab
and an open menu, captured from the built app.

## 2. Goal bar — app (builder lane)

From the owner's narrow-window screenshot:

- The plan list under the bar is **collapsed by default**; the goal title is the disclosure.
  Expanding is a click on the bar, remembered per session (`sequence.goal.open.<id>`), and the
  first open plan step is still readable in the bar's own second line.
- The `Last run: stopped by hand after 1 turn` row is **gone**. The outcome moves into the bar's
  second line when the run is not working (`Finished · 0 of 1 done · stopped by hand`), which
  is where the eye already is.
- The running line reads `Working · step 2 of 4 · <step> · turn 3` (landed this walk); the
  24-turn ceiling is a tooltip only.
- No gold in the bar under white: the target glyph, the tint, the Work-on-goal and Stop pills
  take the accent tokens and nothing literal.

**Check:** `V3GoalRun.test.tsx` locks collapsed-by-default, the disclosure, the absent row, and
the finished line; a screenshot at 700px wide and one at 1280px.

## 3. Captures — the new look on the site (orchestrator lane)

Every image on the site is retaken from the built white app, on this repository, and:

- the workspace path at the foot of the chat is blurred before the file is placed
  (`tools/measure` has the blur script's twin under scratch; the rule is in the site's
  Walkthrough header comment: no absolute path of the owner's machine ships);
- the goal capture is taken **mid-run**, so the bar shows `step x of n`;
- each walkthrough step keeps its spotlight callout, sized to the new frame;
- the studio's canvas crop and the README's hero image are the same files.

## 4. The site — the same look (orchestrator lane)

- The neutral accent becomes the site's default (`:root`), gold stays as `?accent=gold`.
- The download section's primary is a **white pill with ink text** on the dark ground; the
  outlined grey ghost is the secondary. The owner: "these kind of gray button over download is
  a little hard to see."
- The hero and studio dark frames take white highlights; the compare tables take ink checks.
- Walkthrough callouts and connector stay; captions stay specific.

**Check:** full-page capture, gold and white, reviewed strip by strip; no `C:\Users` string in
any `site/public/demo/*.png` region a reader can zoom; the site build green.

## 5. Ship — only on the owner's word

Order, once he approves the look on the captures: version `0.1.1` in the four package.json
files; README; commit and push to `main` as him (never force); tag `v0.1.1` (release.yml builds
the installers); `tools/release-public.mjs --version v0.1.1` printed and run only on his go
(the public history is one force-pushed commit per release by design, and he pushes it);
`site/src/data/release.ts` updated with the real asset names and sizes; site push. Then the
launch material — a thread with the four captures and the measured chart — is a separate ask.

## What is deliberately not in this walk

Light theme (Decision 1, deferred). A redesign of the whiteboard toolbar. New surfaces. The
hosted tier. Each of those has its own page or is waiting on one.

## Correction, 2026-09-18 (late evening): Lovable is the source of truth

§1's white default lasted one afternoon. Walking his own Ramp Kit
(usebastion.io/design), the owner set Lovable as the source of truth for the
whole product - its greys, its blue, Inter - and asked for the site to match.
That is GRAPHITE-DECISIONS.md Decision 32: a third accent, `blue`, is the
default; white and gold stay as switches; the material is still Decision 31's
glass, only the room under it changed. §3 and §4 of this plan were re-run on the
blue build. §5 changed too: he asked for the push to `main` (Vercel deploys from
it) and the local rebuild on his own word in the same conversation, and held
the `0.1.1` bump for himself - "I will come gate that personally".
