# The expression-position fact slot — design, not built

**The code side of the question. Written 2026-09-05 against the 27 reads that this repository's own
source makes and the fact pass does not see.**

## The measurement that asks for it

Grep as truth over product source, all six env-read forms plus destructuring, over-capturing on
purpose so the score is biased down (`docs/research/env-read-forms.md`):

> **the fact pass sees 26 of 53 env names**, 0 parse failures — 25 of the 27 misses are `member`
> form, 2 are `os.environ`.

Every one of the 25 is `process.env.X` written where `FileFacts` has nowhere to put it. Four real
lines, from this repository:

```ts
if (process.env.NODE_TEST_CONTEXT !== undefined) {                 // store.ts:243
enabled: !process.env.SEQUENCE_DISABLE_TERMINAL && (…)             // repoServer.ts:8151
const gatewayUrl = (process.env.SEQUENCE_GATEWAY_URL ?? '').trim(); // repoServer.ts:8286
headers['HTTP-Referer'] = (process.env.OPENROUTER_HTTP_REFERER ?? '').trim() || '…';
```

`FileFacts` carries `assignments`, `calls[].args` and `calls[].kwargs`. The first two lines are
neither assigned nor passed to anything. The last two ARE assigned, but the assignment's value is a
`.trim()` call over a parenthesised `??`, so the Part recorded is that call — the env read is two
levels inside it and never surfaces.

**This is not a missing syntax case.** Adding a `parenthesized_expression` case and a `binary_expression`
case and a member-chain case would each recover a handful and leave the next shape missing, because
the shapes are unbounded. The model of "where a read may appear" is what is wrong.

## What the slot records

```ts
interface EnvReadFact {
  name: string;            // DATABASE_URL
  line: number;            // the line the read is ON, not the statement's first line
  position:                // where it sits, which is what the card must reason about
    | 'assigned'           // const x = …            (already covered, recorded for completeness)
    | 'argument'           // f(…)                   (already covered)
    | 'condition'          // if (…), while, ternary test, && / || operand in a test
    | 'interpolation'      // inside a template string
    | 'chained'            // receiver of a call or member chain: (X ?? '').trim()
    | 'returned'           // return …
    | 'other';
  guards?: string;         // for `condition`: the first ~60 chars of what it gates
  fallback?: Part[];       // the `?? 'x'` / `|| 'x'` default, when there is one
}
```

Added to `FileFacts` as `envReads: EnvReadFact[]`, filled by one walk that fires on the env node
itself and asks its ANCESTORS where it sits — the opposite of today's design, which fires on
statement kinds and asks what is inside them. That inversion is the whole proposal: a read is found
because it is a read, not because it happened to land in a shape somebody enumerated.

`position` is recorded rather than normalised away because the card's sentences differ by it, and a
consumer that does not care can ignore the field.

## What the card does with it

- **Counted as READ.** A variable read in a condition is read. `SEQUENCE_DISABLE_TERMINAL` gates a
  feature; a card that called it "declared, never read" would be wrong in the way this whole lane
  exists to prevent.
- **NEVER promoted to "read, never declared" on its own.** A condition read is weaker evidence of a
  deployment input than an assignment or an argument: `if (process.env.NODE_TEST_CONTEXT)` is a
  test-harness switch, not something an operator sets. Same asymmetry the card already applies to
  `byConvention` reads — it may CONFIRM a declared name, never INVENT one.
- **The reason is printed.** `read — in a condition at store.ts:243` rather than a bare tick, so a
  reader can see why the card believes it and disagree.
- **`fallback` feeds the line the card cannot say yet.** A variable read with a default is one the
  app runs without; when every read of a name carries one, the card can say "optional — the app
  runs without it", which is the ML-Harness observation from the research lane made mechanical.

## The smallest test

1. `if (process.env.FOO_BAR) {}` → one `envReads` entry, `position: 'condition'`, the line of the
   `if`. **Red today: nothing is recorded at all.**
2. `const x = (process.env.FOO_BAR ?? '').trim();` → `position: 'chained'`, `fallback` present.
   **Red today.**
3. `` `${process.env.FOO_BAR}/x` `` → `position: 'interpolation'`. Green today via the template
   path, and the test pins that the new walk does not DOUBLE-count it.
4. The card: a service whose only read of a declared input is a condition reports **read**, not
   never-read; and a condition-only read of an UNdeclared name does not appear in `undeclared`.
5. The coverage measurement: `26 of 53` becomes N of 53 on this repository, with the same script.

## What kills it

- **Double counting.** Three sources already record env parts (assignments, args, kwargs). A fourth
  that overlaps them inflates every count the card prints. Mitigation is that `envReads` is the ONE
  source the card consumes and the other three keep serving the joiner — but if `envReads` cannot be
  made to subsume them exactly, two subtly different totals will circulate, which is worse than the
  present gap.
- **Cost on the hot path.** The parse pass runs over every file of every scan. An ancestor walk per
  env node is cheap; a second full-tree traversal is not. If it cannot be folded into the existing
  walk, it does not go in.
- **`other` swallowing the interesting cases.** If more than ~15% of reads land in `other` on this
  repository, the position taxonomy is wrong and the field is decoration.
- **The card gets noisier, not truer.** 25 more names on this repository is 25 more rows; if most
  are harness switches like `NODE_TEST_CONTEXT`, the card's signal falls even though its recall
  rises. **This is the one that would stop it**, and it is checkable before building: classify the
  25 by hand as operator-set or harness-set. If most are harness switches, the right change is a
  narrower one — teach the existing paths about `??` chains only — and the slot is not worth it.

## Cost

Half a day: the walk and its taxonomy (~80 lines in `facts.ts`), the card's consumption (~30), and
the tests. The hand-classification above is an hour and comes first, because it can kill the rest.

## BUILT — 2026-09-05

The kill check ran first, as the design required: the 25 residual names
hand-classified by use site came out **11 operator-set** (`ANTHROPIC_API_KEY`,
`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `OPENROUTER_HTTP_REFERER`,
`SEQUENCE_BIND_HOST`, `SEQUENCE_GATEWAY_URL`, `SEQUENCE_AI_KEY`,
`SEQUENCE_SANDBOX_EXEC`, `SEQUENCE_DISABLE_ACP`, `SEQUENCE_DISABLE_TERMINAL`,
`SEQUENCE_RESEARCH_ALLOW_LOOPBACK`), **7 harness**, **1 artifact**. Majority real
deployment inputs, so the card is short of recall rather than drowning in noise.
Built.

### The measurement

Product source of this repository, grep as truth, over-capturing on purpose:

| channel | names seen |
|---|---|
| assignments + call args + kwargs | **28 of 56** |
| **`envReads`, the slot alone** | **51 of 56** |

**And the remaining five are grep artifacts — every one is a name inside a code
comment I wrote**: `VITE_API_URL` in the card's own doc, and
`HOPP_ALLOW_RUNTIME_ENV`, `MY_VAR`, `API_KEY`, `PORT` in `facts.ts` comments
explaining these very bugs. So the slot sees **51 of 51 real reads**, and the 56
denominator is grep counting prose. That is the same over-capture the `VITE_API_URL`
row was flagged for, now appearing in the measurement of the fix — which is why
the miss list is printed with its file rather than as a count.

### What the build actually is

The walk is INVERTED: it fires on the env node and asks its ANCESTORS where it
sits, rather than firing on statement kinds and asking what is inside them. That
is what makes a read findable because it is a read.

Positions: `assigned`, `argument`, `condition`, `interpolation`, `chained`,
`returned`, `other`. Only a real condition counts — a read in the branch a
condition guards is labelled by what it is, not by the `if` above it.

One entry per name per line, because two nodes can match the same read and a card
counting rows would report one variable twice.

Folded into the existing parse pass rather than a second traversal, which was one
of the design's own kill conditions.

### A bug worth recording

`cameFromCondition` first compared node identity — `parent.childForFieldName('condition') === child`.
**web-tree-sitter returns a NEW JS wrapper on every call**, so `===` is always
false, and `if (process.env.X)` was labelled `other` while the condition branch
sat there looking correct. It compares start row and column now. An identity test
against a wrapper-returning API fails silently and reads as if it works.

## Status

~~**Designed, not built.**~~ The kill check — hand-classify the 25 missed names as operator-set or
harness-set — has not been run, and building before it would be building on the assumption that
recall is the thing the card is short of.
