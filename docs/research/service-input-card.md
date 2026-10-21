# The service-input card — unblocked, after three real extractor bugs and six probe bugs

**Status: the blocking reason is gone.** The fixture now measures 14 declared inputs, 14 observed,
zero never-read, zero never-declared, zero parse failures. The card is not drawn yet; nothing is
stopping it.

**Two earlier revisions of this file published verdicts that were false** — one killed the card on a
probe bug, the next blamed the wrong cause for the wrong misses. Both corrections are kept in place
rather than rewritten away, because the way they were wrong is the more useful half: every one of
them was an instrument reporting an absence it had manufactured itself.

## THE CORRECTION FIRST

An earlier revision reported that `extractFacts` sees an env read *only* as a call argument, that
`const A = process.env.X` yields nothing, and that `assignments` comes back `{}` — concluding the
card would accuse every service of dead wiring and could not be built.

**That was a probe bug, not a product fact.** `assignments` is a **`Map`**. `JSON.stringify` renders
a Map as `{}`, and the recursive walk I used to double-check it called `Object.values`, which yields
nothing for a Map either. Two independent checks agreed because they shared the same blind spot.

Read correctly, every form works:

```
const A = process.env.X          -> [["A",[{t:"env",name:"X"}]]]
const A = process.env.X!         -> [["A",[{t:"env",name:"X"}]]]
const A = process.env["X"]       -> [["A",[{t:"env",name:"X"}]]]
const A = process.env.X || 'y'   -> [["A",[{t:"env",name:"X",fallback:[…]}]]]
```

That was the fourth bug in this probe, and the only one that reached a published conclusion. The
three before it — `initParser()` never awaited under a swallowing `try/catch`, then reading a
`ff.facts` field that does not exist — each produced a confident zero too.

## THE REAL BUG THE PROBE FOUND, and it is worth the whole exercise

Python env names were being **corrupted**. `os.environ["X"]` unquoted the literal and *then* stripped
Python string-prefix letters from the result — but the prefix sits outside the quotes, so the strip
only ever hit real characters of the name:

| source | extracted, before the fix |
|---|---|
| `os.environ["REDIS_URL"]` | `EDIS_URL` |
| `os.environ["MY_VAR"]` | `Y_VAR` |
| `os.environ["API_KEY"]` | `PI_KEY` |
| `os.environ[b"REDIS_URL"]` | `"REDIS_URL` — the case the strip existed for |

Any name starting with b, f, r, a or m (either case) lost its leading letters, and the prefixed form
it was written to handle was broken too.

**The damage was not cosmetic.** A Python service reading `REDIS_URL`, declared `REDIS_URL` in
compose, produced *both* a declared input with no reader *and* an undeclared read — two false
findings from one bug, in exactly the pair of lines this card would headline. Fixed by stripping the
prefix before unquoting, with a lookahead so letters are only removed when a quote follows them.
Three tests.

## Where the card actually stands — UNBLOCKED, and two more probe bugs first

Measured on the `shopfront` fixture, after the Python fix and the two extractor fixes below:

| | before | after |
|---|---|---|
| declared inputs (excl. the `postgres` image) | 14 | 14 |
| observed reads | 12 | **14** |
| declared, never read | 2 | **0** |
| read, never declared | 0 | **0** |
| parse failures | — | **0** |

**Both kill criteria now pass on this fixture**, so the card is buildable and the reason it was not
has been removed rather than argued away.

### The two extractor bugs, which hid each other

1. **`new X(...)` produced no call fact at all.** `extractCallJs` read the `function` field; a
   tree-sitter `new_expression` names its callee in `constructor`, and the walker never dispatched
   `new_expression` in the first place. So `new Pool({ connectionString: process.env.DATABASE_URL })`
   yielded nothing — not a hole, nothing — and the object's kwargs went with it.
2. **A NESTED object literal evaluated to a bare hole.** `extractCallJs` already lifts a *top-level*
   object argument into kwargs, so `f({ k: process.env.X })` was fine. One level down was not:
   `headers: { authorization: `Bearer ${process.env.STRIPE_KEY}` }` needs `evalJs` to descend, and
   `evalJs` had no `object` case.

Fixing either one alone still left 13 of 14. They had to be found together, and each one masked the
other while I was measuring.

**The `new_expression` gap is much bigger than this card.** `new Pool`, `new Redis`,
`new MongoClient`, `new WebSocket` are the ordinary way a dependency is created in JS, and none of
them could be traced to evidence. On the fixture it cost exactly one edge — and the *right* one:

```
- payments->>postgres: read orders, read payments, write payments
+ payments->>postgres: db, read orders, read payments, write payments
```

`orders` (create_engine), `shipping` (sql.Open) and `invoices` (application.properties) each already
had their `db_access` edge. `payments` is the only service in the fixture whose connection is
*constructed*, and it was the only one missing — the exported diagram showed it reading and writing a
database it never connected to. The `LOCK: scanRepo shopfront` test caught the count move at 39 → 40
and did exactly what a lock is for: it forced the edge to be named before the number was allowed to
change. Cost: +24 prompt tokens (+0.8%) on the ADR-013 cold-turn baseline, recorded there.

Four locking tests in `packages/analyzer/src/test/new-expression-calls.test.ts`. The object case
returns **only** env parts and still a hole when there are none — the Part stream is reassembled into
strings by the URL and host detectors, and an object must not start contributing literals to a
reconstructed URL that never existed.

### PROBE BUGS FIVE AND SIX, in the same investigation as one through four

The earlier revision of this file named three misses and blamed "composite literals". **Two of those
three were my probe, not the product.**

5. **`kwargs` was never read.** `extractCallJs` lifts an object argument's pairs into `kwargs` and
   pushes a hole into `args`. My probe walked `args` and `assignments` only, so
   `redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})` — which the extractor had read
   correctly all along — came back as a miss. So did `STRIPE_KEY` at one point, for the other reason.
6. **`extractFacts(src, f, 'python')` throws.** The language string is `'py'`; `'python'` returns a
   null tree. My probe caught it in `catch (e) { continue; }` and silently skipped **every Python
   file in the fixture** — five declared inputs across `orders` and `notifications`, reported as
   never-read. That is the same swallowing `try/catch` that caused probe bug one.

Six probe bugs, four of which produced a confident zero. The pattern is stable enough to state as a
rule: **when an instrument reports an absence, make it report its failures out loud before believing
the absence.** The rewritten probe prints `parse failures: 0` next to every count for exactly that
reason — the SECOND LAW in `docs/how-to-verify.md`, applied to my own tooling rather than the product's.

## BUILT — 2026-09-04

`packages/analyzer/src/moat/serviceInputCard.ts` (pure), `collectEnvReads.ts` (observed half),
`serviceInputCardScan.ts` (one scan, no second walk). 14 tests.

The card reuses the scanner's own per-service file attribution through a new `onServiceFacts` hook
rather than re-walking. That is deliberate: `excludedPrefixesFor` gives a nested app's files to the
deeper service, and a second copy of that rule would drift silently, then disagree about which
service failed to read a variable.

### On the fixture, where grep is the truth

```
service inputs: 14 of 17 declared are read (10 services, 7 scanned)
declared, never read: 0 of 17
not scanned — cannot say: 0 of 17
excluded as noise: 3 of 17
read, never declared: 0
coverage: complete
  excluded (base-image, 3): image-only services: the variable configures the base image
```

All 14 citations were checked against the cited line's actual text, and grep contradicts zero of the
"never read" claims — of which there are none. The three excluded are `postgres`'s own
`POSTGRES_DB/USER/PASSWORD`.

### On the scanner's own repository, which is where it got interesting

```
read, never declared: 4 (24 inferred by convention, 9 test-only — not accused)
coverage: partial — not walked: tools, examples, docs
```

**The unscanned region is stated by name.** This repo declares no service env at all (no compose —
code-first discovery), so no ROW can carry the `not-scanned` verdict here; the verdict is proved
instead by a test built from this exact case, a service at `tools/` against the real unscanned
region, asserting `not-scanned` and `neverRead === 0`.

### Two product defects the real repo found, which the fixture could not

1. **The SCREAMING_SNAKE member convention manufactures env vars.** `facts.ts` treats any
   `object.SOME_NAME` as an env read — intended for `config.API_URL`, and its stated safety net is
   that "the joiner only creates edges for names actually wired in compose". True for edges; the
   card asks the opposite question. Unfiltered it produced **37** "read but never declared", led by
   `Number.POSITIVE_INFINITY` and an exit-code map's `EXIT.CANCELLED` / `EXIT.USAGE`.

   Fixed WITHOUT changing the joiner's behaviour: the derivation now travels on the Part
   (`byConvention`), and each consumer decides. The card's rule is an asymmetry — such a read may
   **confirm** a name the manifest already declares, and may never **invent** one.

2. **Test files configure the test, not the service.** Nine more accusations came from
   `*.test.ts` setting env for a test process. Excluded from the accusation, still counted as reads.

37 → 4, and the four survivors are genuine `process.env` reads. What was set aside is printed on the
same line as the count, so `undeclared` can never look smaller than it is by omission.

A third, smaller one: the evidence line was wrong twice. A call's line is where the call STARTS, so
a multi-line `fetch(...)` cited a line that did not contain `STRIPE_KEY` at all; and the first line
mentioning `SEQUENCE_USER_DIR` in this repo is a doc comment six lines above the read. Citations now
prefer a line carrying an env accessor, and every one is checked in the test.

## The offline re-run disagrees, and the disagreement is probe bug five again

The research lane ran the card's inputs offline (vault `10-Signals/specs/input-card-on-real-code.md`,
`9a7f722`) and reported **3 of 7 code services with a non-empty "never read" set, 0 of 5 lines true**,
concluding that `extractFacts` records env "only as an argument inside a call" and that an
assignment-level env fact "has to be added before the card can say anything".

**The fact already exists. The harness cannot see it.** Its walker
(vault `08-Automation/input_card.mjs:13`) recurses with `Object.keys(node)`, and `assignments` is a
**`Map`** — `Object.keys(new Map([['k','v']]))` is `[]`, so the recursion steps into `assignments`
and stops. That is the same blind spot recorded above as probe bug five, reproduced independently by
a second instrument.

Both walkers over the same `dist`, every form the file lists:

| form | lane's walker | the same walk, Map-aware |
|---|---|---|
| `fetch(process.env.D)` | D | D |
| `` fetch(`${process.env.E}/x`) `` | E | E |
| `fetch(process.env.F!)` | F | F |
| `const A = process.env.A!` | **NOTHING** | **A** |
| `const B = process.env.B` | **NOTHING** | **B** |
| `const C = process.env.C \|\| "x"` | **NOTHING** | **C** |
| `const G = process.env.G!; fetch(G)` | **NOTHING** | **G** |
| `X = os.environ["X"]` | **NOTHING** | **X** |
| `os.getenv("Y", "d")` | **NOTHING** | **Y** |

Including `const C = process.env.C || "x"`, named as the one remaining unblock.

And the five hand-labelled lines, as the card actually reports them — the card produces **none** of
those accusations:

| line | card verdict | citation |
|---|---|---|
| `const ORDERS_URL = process.env.ORDERS_URL!` | read | `gateway/src/routes/orders.ts:4` |
| `const SHIPPING_URL = process.env.SHIPPING_URL!` | read | `gateway/src/routes/shipments.ts:4` |
| `const INVOICES_URL = process.env.INVOICES_URL!` | read | `gateway/src/routes/invoices.ts:4` |
| `PAYMENTS_URL = os.environ["PAYMENTS_URL"]` | read | `orders/app/payments_client.py:5` |
| `@Value("${PAYMENTS_URL}")` | read | `PaymentClient.java:12` |

### What the lane got right, and it is the real gap

Two things in that file stand, and one of them is the actual blocker:

- **Repos without a container manifest have no left-hand column.** My own run over this repository
  reports `0 of 0 declared` for ten services. Compose is not the only place inputs are declared, and
  until the card reads `.env.example` / `.env.sample` / a config module, it has nothing to compare
  against on a single-process app. That is the thing to build next — not an assignment-level fact.
- **An "image-owned" exclusion is needed.** Already built, as `base-image`.

The third observation — ML Harness's eleven reads all carrying a fallback, i.e. "runs without
configuration" — is a genuinely good card line, and the `fallback` shape is already on the Part.

## Next

The card computes; nothing renders it yet. The remaining work is a surface, and the numbers it must
show are already shaped for the THIRD LAW — `renderServiceInputCard` will not emit a count without
its denominator, and a test asserts that.
