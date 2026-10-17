# ADR-012 — Try chip surface deduplication (ask vs map role split)

- **Status:** Accepted (2026-08-04) — **Option C**
- **Drives:** `tier-completion-orchestration-plan.md` T2-d · `docs/decisions/tier-p2-ux.md`
- **Shipped in:** `packages/web/src/panels/tryChipsModel.ts` (`tryChipsForRole`, r180+)

## Context

With the Assistant expanded by default, the same Try chips used to render in **both** the
assistant idle block and the Architecture canvas Try strip. A first-timer saw one offer twice
and could not tell the surfaces apart (owner: "Try chips render twice"). Both strips are
legibility gate stops (`assistant-idle-try`, `arch-try-strip`).

## Options

| Option | Behavior |
|--------|----------|
| **A** | Canvas strip only when assistant collapsed |
| **B** | Assistant only; remove canvas strip |
| **C** | Same pool, **different roles** — assistant = ask (send/answer), canvas = map (sketch) — with distinct labels and no cross-role borrow |

## Decision

**Accept Option C** — ask vs map role split via `tryChipsForRole`.

1. **One pool, two roles.** `buildTryChips` builds a grounded pool (≥3 ask + up to 3 map
   sketches). Surfaces filter by role; they do **not** re-render the same chip keys.
2. **`ask` role** → Assistant idle strip (`data-testid="assistant-idle-try"`): chat-only
   questions (`tryChipKind === 'chat'`). Click focuses the Assistant and injects the prompt.
3. **`map` role** → Architecture Try strip (`data-testid="arch-try-strip"`): sketch chips only
   (`localKey === 'sketch'`). Click draws ghost cards on the map for Accept/Dismiss.
4. **No fallback / no borrow (U11).** An empty map role shows `MAP_TRY_EMPTY_NOTE` — never
   borrows ask chips into the canvas strip (that would recreate the duplicate-content bug on
   small repos). An empty ask role shows none of the map sketches.
5. **Distinct prose.** Canvas strip lead is `MAP_TRY_LEAD` (sketch intent); the Assistant keeps
   the scan instruction sentence. Collapsed peek may show a compact mix for discoverability but
   still routes clicks through `applyTryChip`.

## Consequences

- Locking tests: `tryChipsModel.test.ts` (`tryChipsForRole` / `askTryChips` / `mapTryChips` —
  no key overlap; empty map stays empty on generic-only pools); legibility stops for both strips.
- Owner "render twice" complaint is closed by **role split**, not by hiding a strip.
- Options A/B rejected: removing either strip loses a discoverable affordance the owner liked
  once chips were honest about intent (Map vs Ask chrome from r150+).

## Alternatives considered

- **A — canvas only when collapsed** — rejected: hides map sketches while the Assistant is open
  (the common posture); still leaves intent ambiguous when both show.
- **B — assistant only** — rejected: map sketches are a canvas verb; burying them in chat loses
  the Accept/Dismiss ghost-card loop that cleared the try UX bar.
- **Borrow across empty roles (r180 early)** — rejected in U11: put ask questions on the canvas
  strip and recreated the duplicate-content complaint on flask/express.
