# The reskin: Jaden's mix (S6d)

Owner: Jaden, 2026-10-06, relayed by the coordinator. Branch `feat/reskin`, base
`overhaul` at 0dfc9a2e. Decision 49 in `docs/brand/GRAPHITE-DECISIONS.md` is the
ruling; this file is the build spec.

**The visual target is one file**: `Mix.dc.html` (the mix Jaden picked, beside
`Main.dc.html` (A), `BArc.dc.html` (B, uiarc.dev) and `CRamp.dc.html` (C, Ramp
Kit) in the session's design folder). Where this text and the file disagree, the
file wins, except the light palette (Ramp Kit / Bastion light, below).

## Jaden's direction, quoted

- Colour: Ramp Kit's dark palette, "the ramp kit has the best coloring".
- Components: uiarc.dev, "very soft, very glass, very straightforward", with
  "more transparency on top of their soft pill buttons".
- Pop-ups: "the pop-ups are very clean" (B). Not Ramp's pop-ups or slash popover.
- Sidebar: "I don't like the sidebar" (B's icon rail plus panel), but "I like the
  session rail... worktrees, earlier, today".
- Context: "the little context... looks pretty clean" (C's percentage).
- Thinking and tools: B's step list, "thinking processes... quite clean".
- Status: "I like the bottom left where it shows like the codex editing" (A).
- Edits: DeepSeek logic but quieter, "too much sometimes... I like the diffs, but
  only when expanded".
- Tone: "lovable graphite looks a little bit too much in certain places". Move
  away from Lovable graphite entirely, light mode included.
- Board: "cleanest on either the ramp kit or the UI arc dev"; "I love the icons
  you use in the actual architecture board"; "I like the kind of whiteboard
  style... ramp kit"; "the cleanest bar is probably UI arc dev bar at the bottom".

## Colour

Dark (Ramp Kit, C): ground `#20201f`; surfaces `#272725`, `#2e2e2c`, `#373734`;
ink `#ecebe8`, `#b8b7b2`, `#8e8d88`; accent `#5b9bff`, solid `#3b7cf6`; hairline
white at 8%, strong 15%. Mono uppercase micro-labels (C's `.lab`: JetBrains Mono
10.5px, 0.08em, uppercase, third ink) for section heads.

Light (Ramp Kit / Bastion light, `lab/specs/bastion-audit.md` table "Colour",
`app/(lab)/lab.css:7-14`): ground `#f3f4f6`, second ground `#e8eaee`, top ink
`#0b0c0e`, second ink the ink at 60% composited, line the ink at 13%, accent
`#1f4fe0` (the same blue family as dark). Not the warm graphite.

Contrast is computed over the token values (`tokens/bastionContrast.test.ts`):
text 4.5:1 on the ground and every surface, box borders and marks 3:1.

## Type

Pre-Bastion fonts: Inter (400 / 500 / 600 / 700, self-hosted, `font-display:
swap`) and JetBrains Mono. The Ramp Kit pairing is the same two faces; its
difference is the mono uppercase micro-label, which is taken. The bundled
Archivo is no longer named by any token.

## Shape

Soft and round everywhere, from radius tokens only: pills (999px) for buttons,
tabs, segments and the dock; 12px rows; 14px small cards; 18-20px panes; 22px
composer; 24px dialogs. Nothing square.

## Components (uiarc.dev, B; Mix.dc.html wins)

- Soft glass pill buttons: fill white at ~4.5%, rim ~11%, label ink 1.
- New chat: a full-width oval pill.
- Mode picker: icon + mode + chevron pill; a menu with one-line descriptions;
  Shift+Tab cycles.
- Composer: a rounded floating box (22px) with pill controls and a round send
  button; the context percentage ("38%") beside send. The + menu holds attach,
  images, board nodes and model.
- Thinking and tool progress: B's step list (one bordered list, one row per step,
  check or spinner at the left).
- Menus, popovers, the / skills list: B's menu (16px radius, 6px padding, rows
  with icon, label and a one-line description, 11px rows).
- Confirmations: B's centered dialog only for real confirmations (switching on
  Full access, deleting, discarding a worktree). Approvals and questions stay in
  the composer takeover, in B's pill style with Y / A / N keys.

## Sidebar

One sidebar (no icon rail): brand and search, the oval New chat, B's session
list grouped Today, Worktrees, Earlier (mono micro-label heads), settings at the
foot.

## Layout and tabs

A's freer multi-pane model. Real tabs with icon and label (Chat, Files,
Architecture, Whiteboard, Terminal), capsule-shaped; the selected one floats
(raised 2px with a shadow). Several open; a right dock with capsule tabs, split
for at most 2 panes, full-screen and collapse at the end of its strip.
Architecture keeps Map / Grid / Diff / Hotspots. No icon-only tab strip.

## Status

A's thin bottom status bar: agent state with a dot, branch, graph freshness,
repo at the right. The agent status leaves the board header.

## Edits (DeepSeek logic, quieter)

- A streaming edit row.
- The turn-end changed-files card is one compact line ("2 files changed +38 −3")
  until clicked; the rows and Review / Revert turn appear when it is expanded.
- Diffs folded by default, opening on expand (and a hover popover).
- A review tab in the dock: side by side or unified, Revert file and Revert hunk
  on the S3 snapshots.

## Board

B's node cards with an icon chip per node kind, on C's dotted whiteboard ground.
The bottom bar is B's glass pill dock with compact icon buttons and tooltips.
Cards reserve 2 title lines. The legibility counter stays green.

## Everywhere

Round corners, centered icons, no "·" separators in UI text (test-locked, the
scan derived from the source files), no blur on large or scrolling surfaces
(only small floating controls), no shimmer.

## Refinements (coordinator, 2026-10-06)

1. The changed-files card is one compact line until clicked.
2. The centered dialog is only for real confirmations; approvals and questions
   stay in the composer takeover with Y / A / N keys.
3. Fonts: pre-Bastion unless the Ramp Kit pairing reads clearly better. Picked:
   Inter + JetBrains Mono, with Ramp's mono micro-labels (the same faces).
4. No shimmer. Board cards reserve 2 title lines.

Shots per batch: dark and light, 1440 and 1024. Nothing merges into overhaul
until Jaden has seen them. The question card's files are owned by another
builder until the coordinator says they merged.

## More from Jaden (2026-10-06 15:54Z), quoted

1. **Backbone.** Ramp Kit's layout and colour are the backbone: "the layout
   style... of the ramp kit was also very clean, which is why I kind of chose it
   as the backbone". uiarc.dev supplies the small things: buttons, pop-up
   animation, softness, the premium feel.
2. **Shadows, lighter.** "we shouldn't go too hard on all of the shadows... the
   chat box is a little too shadowed on the UI arc example". A hairline border
   plus at most a very soft shadow; only floating menus and dialogs get a real
   shadow. A hairline plus a glass tint is preferred over drop shadows.
3. **Board.** Icons; a small definition under each title (one short muted line
   of what the node is, in the reserved second line where it fits); centred
   content; buttons transparent enough but easy to click and see. Board buttons
   and the toolbar: 32px minimum hit area with a visible hover and focus. The
   legibility counter stays green.
4. **Status bar.** Toggleable in Settings ("Status bar", on/off, default on,
   persisted). Order: agent state (working / idle / waiting on you), agent,
   model, context %, workspace or worktree, branch. When it is off, the composer
   still shows the context % and the mode. Settings is restyled to the new
   design.
5. **Composer condensing.** The + holds everything addable: files, images,
   board nodes, @-mention a file, and the / skills (no separate slash icon;
   typing "/" still opens the menu). The permission control is the mode pill
   (Ask / Auto-edit / Full access / Plan). A Model button opens a menu to pick
   the model, and inside it the effort or speed options where the agent supports
   them. Nothing else is stacked in the box; the text area holds only
   attachments. Context % sits in or under the box. Model and effort keep their
   current storage and data flow (web2 and acp); only the controls move.
6. **Motion.** Switching between views feels light and instant, with no heavy
   transitions.

## Values as built (batch 1)

- Dark accent solid is `#2f6ce8`, not `#3b7cf6`: white on `#3b7cf6` reads
  3.89:1, under the 4.5:1 text floor; `#2f6ce8` reads 4.74:1 in the same hue.
- Dark muted ink is `#a3a29d` (4.67:1 on `#373734`); Ramp's `#8e8d88` read
  3.59:1 there and is the faint step (`--ink-4`).
- Light inks are `#0b0c0e` composited over `#f3f4f6`: `--ink-2` `#4c4d4f`
  (.72), `--ink-3` `#68696b` (.60, 4.56:1 on `#e8eaee`), `--ink-4` `#969799`.
- Radii: the blue variant no longer cuts the ladder (it was 6 / 8 / 10 / 12);
  the root ladder 4 / 8 / 10 / 14 / 18 and `--r-full` apply everywhere, pills
  on `--r-full`.
- Glass pill rim: soft (11% dark, 14% light). The rim is no longer held to 3:1;
  the pill's label (4.5:1) and glyph (3:1) are, on the hover fill over the
  ground and both surfaces.
