# Draft V3 — macOS liquid glass harness (Apple first, Graphite skin)

**Opened 2026-09-14** on owner correction: previous passes re-skinned with hues;
the ask is **from scratch** — design a native **macOS / Apple liquid glass** harness
UI, **then** skin it with the Graphite brand book. Show the **full** product mock.

## Open this

[`ui-drafts/draft-v3-macos-harness.html`](ui-drafts/draft-v3-macos-harness.html)

Sticky toggle at the top: **Apple** (default) ↔ **Graphite**.

Serve locally if needed:

```bash
npx --yes serve docs/research/ui-drafts -p 4175 --no-clipboard
# → http://127.0.0.1:4175/draft-v3-macos-harness.html
```

## What V3 is (vs A / B / C)

| Draft | Starts from | Role |
|-------|-------------|------|
| A Native | Graphite + OS restraint | Shipped Decision 18 direction |
| B Workstation | Dense IDE | Reference only |
| C Liquid | Floating panes + motion | Reference only |
| **V3** | **Apple liquid glass first** | Full harness mock; Graphite is a **skin**, not a redesign |

## Skins

1. **Apple** — system blue `#0A84FF`, SF stack, heavy vibrancy blur, traffic lights,
   near-black room. Hierarchy by material + ink.
2. **Graphite** — same layout and glass **recipe**; Decision 20 charcoal ladder,
   indigo accent only on tab / session / mode / Send; Instrument Sans when online.

## What is mocked (full harness)

Window chrome · workspace pills · sessions rail (New Chat, General, repos) ·
transcript · tool cards · todo strip · frosted composer · Ask/Agent · Send ·
thin meta strip. Clicks highlight sessions / tabs / modes. No real network.

## LANDED Decision 21–22 (2026-09-14)

- **Decision 21:** V3 Graphite harness layout is product chrome SoT.
- **Decision 22:** Accent is **gold/yellow + white** (not indigo). Old web2
  chrome archived outside git at `…/Projects/sequence-ui-v2-archive`. In-repo
  UI is `packages/web2/src/v3/` (mock-faithful window, sessions rail, chat,
  Chat|Architecture|Files). Soft-open / soft-load logic kept.

Apple skin remains research-only; product ships the Graphite room + gold accent.
