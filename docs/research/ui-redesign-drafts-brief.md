# The harness UI redesign — research, and the brief for three drafts

**Opened 2026-09-14 on the owner's instruction:** *"a kind of quite thorough redesign of our whole
harness UI … deep, heavy research into macOS native UI. So a lot of frosted glass, a lot of liquid
glass, a lot of cool hover, interaction animations … create me like three UI drafts to look at."*

**Scope, in his words:** *"When I say UI, I'm not saying change much of the tools. I'm saying change
the way everything looks."* Colours, fonts, section cards, the organisation of things. **The core
functionality does not change.**

---

## 1. What the research actually returned, and what it did not

### It did not return Apple's own words

`developer.apple.com/design/human-interface-guidelines/materials` fetched as a title and no body.
**Nothing in these drafts is attributed to Apple guidance**, because I could not read it. What the
drafts use instead is what this repo has already MEASURED about its own material (Decisions 14–17),
which is a stronger source for our purposes anyway because every number in it was taken off a
running build:

- a frosted pane must be **lighter than its ground**, or it reads as a dark box you can see through;
- `backdrop-filter` over a flat fill is **arithmetic with no effect** — the blur needs something
  behind it that varies, and elevation is enough; it does not need colour;
- `saturate()` is what makes a pane read as glass rather than as fog;
- a top highlight says where the light is, a bottom inset says the pane has thickness — one without
  the other is a sticker;
- at 10px the *shape* behind a control still reads; 20px is where it becomes frosted.

### It did return a component vocabulary that maps almost 1:1 onto Sequence

`21st.dev/s/agent`, and the `serafimcloud` family in particular, is the Cursor-shaped set the owner
asked for:

| their component | our surface |
|---|---|
| **Todo Tool** — pending / in_progress / completed icons, shimmer "Updating to-dos…" | `TodoList` (`update_todos`) |
| **Subagent Tool** — a task row with **elapsed time and the last nested tool while running**, states completed / pending / interrupted | we have no subagent surface; this is the shape to build toward |
| Bash / Search / Edit / MCP / Generic Tool | `ToolCallCard`'s three states |
| **Plan Tool** — planning workflow with approval states | plan mode + `EditApprovalCard` |
| **Approval Card** — one question, options, confirm state | the permission `ask` verdict (no channel yet) |
| Thinking / Text Shimmer | the `<think>` fold (Decision 12) |

**The single most useful idea in the set** is the Subagent Tool's row: *elapsed time plus the last
nested tool*. That is the answer to "what is it doing right now" for any long-running work, and it
is what our `WorkProofStack` is closest to and furthest from at once.

### On ASCII

The owner asked for ASCII elements. The catalogue's terminal-flavoured entry is a glitch-text
loader; the rest are geometric SVG. ASCII in these drafts is therefore **ours**, not borrowed —
braille-dot spinners (which this repo already uses on the reasoning row), box-drawing rules, and
monospace progress meters.

---

## 2. What every draft must show, so the three are comparable

Same content, same data, three looks. Anything that differs between drafts must be a DESIGN choice,
never a content choice.

1. **The session rail** — WORKSPACE header, Sessions / Search / New chat, a GENERAL group and a
   SEQUENCE group, one loaded thread, one multi-selected thread, hover actions.
2. **The workspace tab bar** — Chat · Files · Architecture · Whiteboard · AI Canvas · Terminal ·
   Browser, one chosen, with a close ×.
3. **A transcript** carrying, in order: a prose answer with a heading and a list; a **thinking**
   fold; a **tool call** in each of its three states (running, done, refused); a **todo list** with
   one done, one active, one pending, one blocked; a **subagent row** with elapsed time and its last
   nested tool; and an **edit approval card** with a real diff and accept/reject.
4. **The composer** — the input, the model picker, the mode control (Plan / Build / Teach), the
   Drive (session lock) chip, and the repo · branch · model breadcrumb.
5. **A side-by-side pane** — the Cursor reference: chat on the left, a second surface beside it,
   sharing one frame.

### The fixture, verbatim in all three

- repo `sequence`, branch `main`, model `minicpm5-hermes`
- threads: "An llm, break it down for me" (loaded), "cs-05", "Which files depend on scan.ts", "harness-04"
- tool calls: `read_file src/scan.ts` (done), `search_files "propose_chart"` (running),
  `run_command pnpm test` (refused — *"refused: run_command is not a Work-mode default"*)
- todos: ✓ Read the analyzer · ▸ Wire the board writers · ☐ Mount the code card ·
  ! Files tab (blocked: needs the pane cap raised)
- subagent: `review:bugs` — running 1m 12s, last nested tool `read_file packages/web2/src/app/App.tsx`
- diff: `packages/web2/src/chat/Composer.tsx` +12 −3

---

## 3. The three directions

They differ on ONE axis each so the choice is legible.

### Draft A — **Native**
macOS-app restraint. Vibrancy doing the work, chrome nearly invisible, content forward. Tight
control heights, system-ish type, small radii, one accent used sparingly. The sidebar is a
translucent pane over the window's own ground. Motion is short and functional: 120–160ms, ease-out,
no bounce. *The question it answers: what if Sequence looked like it shipped with the OS?*

### Draft B — **Workstation**
Cursor's density. Side-by-side cards, structural panels with real boundaries, monospace carrying
identifiers and numbers everywhere, box-drawing rules, ASCII meters. More information per inch, more
visible structure, less air. *The question: what if Sequence looked like a tool you live in?*

### Draft C — **Liquid**
The iOS reference. Floating glass panes over a soft ground, large radii, generous padding,
expressive motion — subagent capsules that breathe while running, braille spinners, shimmer on
streaming text, hover lifts with a specular sweep. *The question: what if Sequence felt alive?*

### Draft V3 — **Apple-first harness** (added 2026-09-14)
Separate from A/B/C: **design macOS liquid glass first**, then re-skin with Graphite.
Full mock: Chat + Architecture + Files panels, sessions rail, tool cards, composer.
Open [`ui-drafts/draft-v3-macos-harness.html`](ui-drafts/draft-v3-macos-harness.html) —
brief: [`draft-v3-macos-harness.md`](draft-v3-macos-harness.md). Sticky **Apple ↔ Graphite** toggle.

Serve: `npx --yes serve docs/research/ui-drafts -p 4175 --no-clipboard`
→ http://127.0.0.1:4175/draft-v3-macos-harness.html

---

## 4. Rules that bind all three

- **No hex outside a draft's own token block.** Each draft declares its palette at the top; nothing
  below reaches for a literal.
- **Contrast is measured, not eyeballed.** Body text ≥ 4.5:1 against the surface it sits on, large
  text and non-text marks ≥ 3:1. State the measured numbers in a comment.
- **Nothing overflows its box.** Long paths ellipsise, diffs and excerpts scroll inside their own
  container, and the page never scrolls horizontally.
- **Every animation is off under `prefers-reduced-motion`.**
- **Self-contained.** One HTML file per draft, no build step, no external JS. Fonts may come from a
  CDN link; everything else is inline.
