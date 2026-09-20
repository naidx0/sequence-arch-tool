# ADR-009 — Design decisions emit grounded ADR artifacts (the ADR format, inside the product)

- **Status:** Accepted (2026-07-24, owner-directed: "I like how the ADRs look — we need exactly
  that within our arch system inside of Sequence")
- **Drives:** `v20-plan.md` Phase 6; depends on ADR-008 (embedded diagrams) and ADR-005
  (chat-applied changes)

## Context

When a user changes their architecture in Sequence — by hand, by ink, or by chat (ADR-005) — the
change leaves **no durable rationale**. The graph mutates, the chat scrolls away, and six weeks
later nobody knows why the cache went in front of the database or what was rejected.

This repo's own practice supplied the answer format. Building the v20 program with ADR-001..008
proved the shape works: *status · context · decision · consequences · alternatives considered*,
numbered, superseded-never-edited. The owner saw the rendered result and asked for exactly that
structure as a product capability, not just an internal docs habit.

This is also the honest home for the moat's third layer (`vision.md` §2): a design advisor is
far stronger when it can cite *this system's own prior decisions* than when it recites generic
patterns.

## Decision

**A design change on the canvas can emit a grounded ADR artifact into the user's repo.**

1. **Structure mirrors the format that works** — Status + date, Context, Decision, Consequences,
   Alternatives considered. No new invented document type.
2. **Grounded content only.** Each section is populated from real computed facts, not vibes:
   - *Context* — the risk/impact/cycle facts for the affected nodes, from the background logic
     engine (ADR-004);
   - *Decision* — the actual applied patch: nodes and edges added/removed, by real id;
   - *Consequences* — recomputed blast radius, `computeImpact` before vs after;
   - *Alternatives* — only options that were genuinely presented (a rejected proposal, a
     discarded patch). Nothing invented to fill the section.
   Model prose is allowed to *phrase* these facts and must key to them; any claim that maps to
   no fact is dropped (the `sanitizeNode` allow-set discipline).
3. **Embeds a diagram** (ADR-008) of the affected scope — before/after where the change is
   structural.
4. **Written into the repo through the existing file jail** (`PUT /api/file`) — `docs/adr/` when
   that convention already exists in the repo, else `.sequence/decisions/`. Numbered
   sequentially by scanning what's there. **Never overwrites an existing record** (the
   no-silent-data-loss invariant); a superseding decision gets a new number and flips the old
   one's Status.
5. **Never automatic.** It is a one-click action offered *after* a change lands (propose→act),
   never a file written behind the user's back.
6. **Works without a key.** With no model, the record still emits — facts, patch, diagram, and
   structural prose. The AI improves the wording; it is not required for the artifact.

## Consequences

- Sequence gains a durable **design memory** that neither a whiteboard nor an AI-IDE produces:
  decisions, grounded, versioned in the user's own repo, with the diagram attached.
- These records become **readable context for the assistant** — the advisor can cite "ADR-004 in
  this repo chose X because Y" instead of generic advice (moat layer 3).
- Locking tests: sequential numbering never collides; an existing record is never overwritten;
  an ungrounded claim is dropped; the no-key path still produces a complete structural record;
  the embedded diagram comes from a projection (ADR-008), not model text.

## Alternatives considered

- **A freeform chat summary** — rejected: ephemeral, unstructured, gone on scroll.
- **Commit message only** — rejected: no diagram, no alternatives section, invisible to anyone
  reviewing the *design* rather than the code.
- **Auto-record every change** — rejected: manufactured churn and files-by-surprise; consent is
  one click, not zero.
