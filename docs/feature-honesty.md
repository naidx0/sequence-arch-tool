# Feature honesty — making what we SAY match what it DOES

> Owner: *"How do we make sure that features are actually super consistent with
> what we say it does and what it's actually going to do for the program?"*

This is the sharpest question asked in this project so far, and it has a
concrete answer. It is also the question every round of feedback has really
been about — "function desc too general", "it says it exists but I can't find
it", "handed back to me as if the final product was finished". Those are all the
same defect: **a claim that outran its implementation.**

---

## The three places a claim can be made

A feature makes a promise in exactly three places, and they drift independently:

| where | the promise | how it lies |
|---|---|---|
| **the label** | "Trace a flow" | the button exists, does something else |
| **the description** | "Follow one request end to end" | overstates what the code can do |
| **the behaviour** | what actually happens | correct but undiscoverable |

Most quality systems test only the third. That is why a project can be green
and still be dishonest.

---

## The rule

**A claim must be derived from the thing it describes, or verified against it.
Never written alongside it.**

Written-alongside is the failure mode: a label typed into JSX and a
implementation typed into a module are two sources of truth that agree once, on
the day they were written, and never again.

### Three mechanisms, in order of strength

**1. DERIVE the claim (strongest — drift is impossible).**
The description is computed from the same data the behaviour uses.

Already in the codebase: `describeCluster()` produces
*"12 ts files in packages/analyzer/src/server, defining acpGate, activeRoot"* by
COUNTING the parse. It cannot say "12 files" when there are 9, because the 12
came from `members.length`. Compare the thing it replaced — a hand-written
*"A group of related files"* which was true of everything and therefore said
nothing.

Prefer this everywhere a claim is about data.

**2. VERIFY the claim (strong — drift fails a test).**
When the claim cannot be derived, a test asserts the claim against the
behaviour.

Already in the codebase: `settingsSurface.test.ts` scans `SettingsPage.tsx` for
each declared section testid, so a section listed in the catalogue but never
rendered fails. `programIntents.test.ts` asserts every intent's prompt contains
the program name. `variants.test.ts` asserts every catalogue entry has a real
label and hint.

The shape is always: **the catalogue is data, and a test proves the data matches
the rendering.**

**3. SHOW the evidence (the fallback — the user can check us).**
When neither is possible, put the evidence next to the claim so the user can
audit it. Every part in a breakout carries its `file:line`. Every edge traces to
a real `evidence[]` entry. The scan states its own warnings
(*"copies 2 directories with no CMD naming one — left at the repo root, so this
service may look larger than it is"*) rather than going quiet.

An honest "I could not tell" beats a confident wrong answer, and is *infinitely*
better than silence — silence is what cost three rounds on the compose bug.

---

## The checklist for any new feature

Before a button, menu item or panel ships:

1. **Can the label be wrong?** If the label is a literal string and the
   behaviour is elsewhere, add a test that ties them. If the label can be
   derived from the behaviour's own data, derive it.
2. **Does the description promise more than the code does?** Write the
   description from what the code actually reads. "Follow one request end to
   end" is only honest if the prompt says *"if a hop is not in the scan, say so
   rather than filling the gap"* — which is exactly why `COMPOSER_ACTIONS`
   prompts are written that way.
3. **Is there a catalogue?** Then it is DATA, and a test proves every entry
   renders and every rendered thing is in the catalogue. Both directions.
4. **What happens when the grounding is missing?** The answer is never a
   placeholder. It is either the honest absence (no summary element at all) or a
   stated reason. `informativeSummary()` exists solely to drop *"A service in
   this system."* — a sentence that was true and worthless.
5. **Is it in the legibility sweep?** A surface with no stop is a surface nobody
   is checking. A feature that cannot be found is not a feature.

---

## Why this is a moat and not overhead

Sequence's entire claim is *"grounded, never guessed"*. A product that maps
someone's architecture and gets it subtly wrong is worse than no product,
because it is confidently wrong about something the user cannot easily check.

Every mechanism above is the same discipline the analyzer already applies to
EDGES — every edge traces to a file and a line, and a model may rename a
component but may never invent one. This document extends that from the data to
the interface. The words on a button are a claim about the system too.

**The test of the whole thing:** could a user check any statement this product
makes, and would they find it true? If a claim cannot be checked, it should not
be made.
