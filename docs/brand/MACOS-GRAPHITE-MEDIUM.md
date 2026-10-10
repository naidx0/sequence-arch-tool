# macOS × Graphite medium

**CONTEXT DIET for UI work.** Read this + Decision 20/22/**23** + the one CSS file you own.
Do not dump `CLAUDE.md` / HANDOFF / the whole brand book into every builder.

Owner correction, 2026-09-14: Cursor is **dark black + gray**, Codex is **gray +
white structure** — not purple-blue steel, not cyan/violet room washes, not
rainbow tab hues. The product medium is **macOS liquid-glass material language
skinned on Graphite laws**.

---

## Medium (one paragraph)

Sequence chrome should feel like a **macOS app**: vibrancy over a lit near-black
room, frosted controls that are quiet at rest, one system accent spent only on
what is pressed or selected. Tokens, type, density, and hue budget come from
**Graphite** (`docs/brand/graphite/`, `GRAPHITE-DECISIONS.md`).

**Product chrome SoT (Decision 21–23):** Draft V3 harness HTML —
`docs/research/ui-drafts/draft-v3-macos-harness.html` for **materials** (glass,
rail, composer, gold accent). **Shipped frame = fill-screen** (Decision 23): no
floating 1360px card, no desktop vignette. Traffic lights (`.v3-traffic`) only
when `data-platform="mac"` — hidden on Windows. **Accent = gold/yellow + white**
(Decision 22), not indigo. Old web2 chrome is archived outside the repo
(`sequence-ui-v2-archive`); do not read or restore it.

**Layout lock (Decision 23):** always-on sessions rail + always-on chat column +
tabbed live surface (Architecture / Files / Whiteboard / AI Canvas / Terminal /
Browser). Chat tab expands chat to fill the center. Soft-open / Open project
attach rules stand.

Room laws from Decision **20** stand. Decision **19** blue-steel is superseded.

---

## Color principles (hard)

| Rule | Binding |
|------|---------|
| Law 1 | Every hue is a claim. Never more hues than claims. Dividers, borders, and chrome are never coloured. |
| Room | Near-black ground + stepped **gray** surfaces (Decision 18 Draft A ladder). No blue-black steel, no slate-blue edges as the brand. |
| Accent | One **gold/yellow** (`--accent` / `--accent-solid`, Decision 22–23) **only** on selected, pressed, Send, or a tool’s own state. No purple. White for structure/ink. |
| Verdicts | `--fits` / `--spills` / `--wont` / `--unknown` / `--info` only for claims about the world. |
| Kinds | `--arch-*` stays grey (Decision 2). |
| Tabs | Identity = **label + glyph**, not `--surface-hue-*`. Do not paint every workspace pill a different hue. |
| Wash | `--ground-wash` is a **neutral** lift so glass has something to refract — not violet/cyan corner lights. |

**Forbidden (never reintroduce):** indigo/purple accent; rainbow tabs; purple slabs; Decision 19 blue-steel; old `shell.css` / `chat-scope` chrome; reading `sequence-ui-v2-archive`.

---

## Material principles (macOS glass)

- **Glass** = translucent **neutral** fill + `backdrop-filter` blur/saturate + balanced hi/lo inset (`--glass-inset` / `--glass-sel-inset`).
- **Quiet at rest** — chrome workspace pills are the reference: transparent until hover; accent wash only when chosen.
- **No permanent frosted plates on scrolling rails** — blur over a scrolling column flickers on Windows; solid elevated chips or hover-only glass.
- **Send** stays solid `--accent-solid`.
- Press feedback: `scale(0.97)` (emil-design-eng); interruptible transitions; name exact properties.
- **Thinking HUD** — gold wash pulse (`.v3-thinking-pulse`) while `session.inFlight`; show elapsed, rounds, tool count, token usage. Developer transparency, not person-to-person chat chrome.

---

## Type

- **Instrument Sans** — UI, chrome, prose.
- **JetBrains Mono** — paths, ids, meters, mono chips (one step down beside sans).
- **Sora** — display headings only where Decision 13 already spends it.
- One `--t-*` / `--lh-*` ladder. Do not mix “HD” and soft sizes on sibling chrome.

---

## Icons

- Sheet 09 vocabulary; `currentColor`; one stroke weight matched to text (better-ui).
- Optical centering for pin / pen / asymmetric glyphs.
- Hit floor `--target-min`; drawn size `--icon-btn` unless the door rung requires larger.

---

## Skills (call these; do not re-derive)

| Skill | Use for |
|-------|---------|
| `.agents/skills/better-ui` | Concentric radii, surfaces, hit areas, icon transitions |
| `.agents/skills/emil-design-eng` | Animation frequency gate, press scale, easing |
| `.agents/skills/shadcn` | Composition (dialogs, menus, chat structure) — **map to Graphite tokens**, never import foreign palettes |
| `.claude/skills/sequence-design` | Repo gate; Step 0 includes this medium |

21st.dev / Magic UI / Tailwind UI are **composition references only**. Graphite wins every colour disagreement.

---

## References

- Book: `docs/brand/graphite/` — sheets `01`, `09`, `10`, `12` when touching chrome/icons/density/agent surfaces. **Gold SoT (Decision 23).**
- Rulings: `docs/brand/GRAPHITE-DECISIONS.md` (especially 1, 2, 14–18, **20**, **22**, **23**).
- Draft A: `docs/research/ui-drafts/draft-a-native.html` (Graphite-first Native).
- **Draft V3 (materials):** `docs/research/ui-drafts/draft-v3-macos-harness.html` — brief: `docs/research/draft-v3-macos-harness.md`.
- Rail/composer **behavior** (not colours): `docs/research/ml-harness-adoption.md`.
- Tokens: `packages/web2/src/tokens/graphite.css`.

---

## Anti-patterns

| Anti-pattern | Do instead |
|--------------|------------|
| Floating mock window on Windows | Fill-screen `.v3-win`; hide `.v3-traffic` |
| Exclusive tabs that hide chat | Split-canon: chat always on; Chat tab expands |
| Re-skin with new hues when greys feel flat | Neutral wash + glass + contrast ladder (Decision 20) |
| Permanent glass fill on New chat / scroll chips | Chrome-tab recipe: quiet rest, glass on hover |
| Full page reload to switch chats | Soft-load transcript (`session/browse`) |
| `--surface-hue-*` on every tab | Label + glyph; accent only when selected |
| shadcn default zinc/violet theme | Graphite token names only |
| Cite `packages/web` | Forbidden — deleted |

---

## UX that stays (do not undo)

- Soft-open catalog chats without attaching/isolating the whole repo.
- Soft-switch sessions without `location.reload`.
- Ctrl/Cmd + Shift multi-select on the sessions rail.
- Open project (folder act) remains the attach path.
- Pin / rename / delete chats; collapse project groups.
