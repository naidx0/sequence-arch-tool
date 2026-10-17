# Product Principles — how to think about Sequence (read before you build or judge)

**Visual authority:** product chrome follows the **frozen Graphite book**
[`docs/brand/graphite/`](brand/graphite/) and the owner rulings in
[`docs/brand/GRAPHITE-DECISIONS.md`](brand/GRAPHITE-DECISIONS.md); extend the book before inventing a
component (Graphite law 4: *never invent a number*). Cite `graphite/` — one copy.
(Retired predecessors, newest first — none of them canon, all **deleted from the tree** 2026-08-20:
Console v3.1 · Ledger v2 · the v2 sample brief and its samples · the v1 Structural book. There is
no path to any of them; git history is the only copy.)

This is the **reasoning stance** every agent working on Sequence must adopt — builder, critic,
judge, orchestrator. It is not a feature list (see `vision.md`) or a checklist (see
`usability-standard.md`); it is *how to think* so you don't mistake "it compiles" for "it's good."
Think like the founder and the confused first-time user — **not** like an engineer admiring a green
test run.

## The ten principles

1. **"It runs" ≠ "a human can use it."** Passing tests, a clean build, a RELEASABLE review — that's
   table stakes, not a finish line. The job is done when a real person *succeeds*, not when the
   program executes. Never report "done" on green alone.

2. **Judge as a confused first-timer, not as the author.** Before you call anything usable, ask:
   would someone who has never seen this know what this screen is for, find the tool, read the
   output, and finish the task — with no manual and no one to ask? If not, it's not done.

3. **Minimal noise. Every word and pixel earns its place.** No decorative preamble, no button-soup,
   no fluff a prompt could have generated. Outputs are terse, structured job-notes (what happened ·
   what it does · next steps), not essays. If it doesn't help the user do the next thing, cut it.
   **Icons over text — CRM-style.** Prefer a consistent **monochrome line-icon / clip-art** set
   (like the chat glyph and the `+`) to carry meaning instead of words: label inline (a file glyph,
   a DB/schema glyph, `$` for revenue), organize features/pages, and **hide secondary complexity
   behind a symbol** (the `+` → "more models / add your key" is the pattern — one small icon opens
   what a paragraph of options used to). **Never colorful emojis** — flat, single-tone icons that
   match the UI. An icon that saves a sentence is doing its job.

4. **Adapt to the user — don't have one voice.** The AI must match the request's register, length,
   and format (simple vs terse-technical vs step-by-step). One canned style for everything is a bug.

5. **Propose → act, don't make them re-prompt.** When the next step is something the tool can do,
   it's a one-click action, not an instruction the user has to retype. Stop making the user tell it
   what to do twice.

6. **Legible over impressive.** A dense pyramid of unlabeled lines is a *bug*, not a flex. Labels,
   a visible legend, meaningful consistent color, clear hierarchy, calm layout. Clarity beats
   complexity every time.

7. **Discoverable + fluid, or it doesn't count.** A feature that exists but can't be found, or a
   drawing surface that feels clunky, is a feature that isn't there for the user. Fluidity and
   findability are features, not polish.

8. **Cost-aware and honest about it.** Do the real token/$ math before you set a limit or a default.
   Surface the true number even when it contradicts a nice-sounding estimate. Never silently blow a
   stated budget.

9. **Grounded and honest — never fabricate to look good.** Every claim, edge, risk, and answer traces
   to something real. No invented data, no confident guessing, no gaming the gate/judge. If you don't
   know or it isn't done, say so plainly.

10. **Don't manufacture churn, and don't over-build.** If a round found nothing worth shipping, say so
    and stop. Simplicity is a feature; complexity that doesn't earn its keep is a regression.

## How this shows up in a round

- **Builders:** implement to principle 1–7, not just to the ticket. If the feature works but a
  first-timer couldn't find or read it, the round isn't done — say so in your report.
- **Critics/judges:** score against `usability-standard.md` as the *user*, and against these
  principles as the *founder*. Puncture "yay it runs." Name where a real person gets confused, lost,
  or feels dumb — verbatim.
- **Orchestrator:** the gate is two gates (correctness + usability). "Done" needs both. Report the
  honest state, including cost and what the owner still has to do.

The through-line: **the person has to succeed.** Build and judge from their seat, not the machine's.
