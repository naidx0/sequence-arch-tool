# Which env-read forms the extractor sees

**One table, because the answer was spread across five commits and three wrong claims.**
Every row was measured against the built `dist`, not read off the source.

Two lanes have now independently concluded "the extractor cannot see assignments" and
"destructuring is the one form it misses". Both were wrong, and both were wrong for the same
reason — a harness that could not see what it was asking about. This file exists so the next
person checks a table instead of writing a fourth probe.

## Read today

| form | example | since |
|---|---|---|
| member access | `process.env.X` | always |
| subscript | `process.env['X']` | always |
| non-null asserted | `process.env.X!` | always |
| with a fallback | `process.env.X \|\| 'y'` | always |
| module-level assignment | `const A = process.env.X` | always — see the probe note below |
| positional argument | `fetch(process.env.X)` | always |
| template substitution | `` fetch(`${process.env.X}/y`) `` | always |
| top-level object argument | `f({ k: process.env.X })` | always (lifted into `kwargs`) |
| **nested** object literal | `f({ headers: { a: process.env.X } })` | `bd2bb8a2` |
| **constructed client** | `new Pool({ connectionString: process.env.X })` | `bd2bb8a2` |
| **ternary condition** | `x ? process.env.X : y` | `9a9a755a` era |
| destructured, bare | `const { X } = process.env` | always |
| **destructured with a default** | `const { PORT = '3000' } = process.env` | 2026-09-05 |
| **destructured and renamed** | `const { DATABASE_URL: dsn } = process.env` | 2026-09-05 |
| Python subscript / getenv | `os.environ["X"]`, `os.getenv("X", "d")` | always; names were CORRUPTED until 2026-09-04 |
| Go | `os.Getenv("X")`, `&Options{Addr: os.Getenv("X")}` | always |
| Java | `System.getenv("X")`, `@Value("${X}")` | always |
| config accessor | `configService.get('X')` | `3a5561dd`, in the card's collector only |

## Deliberately NOT read

| form | why |
|---|---|
| `const { port, id } = process.env` | SCREAMING_SNAKE, 3+ characters, is the only thing separating an env name from an ordinary identifier in a pattern. Without the floor every destructure is an env read. |
| a real `.env` file | gitignored, machine-specific, routinely holds secrets. Reading it would make the answer depend on who ran it. |
| `config.API_URL` as a *source of truth* | it IS read, and marked `byConvention` — the inference turned `Number.POSITIVE_INFINITY` and an exit-code map's `EXIT.CANCELLED` into environment variables. It may CONFIRM a declared name and may never INVENT one. |

## The probe note, which is the point of this file

**`assignments` is a `Map`.** `JSON.stringify` renders it `{}`, `Object.keys` returns `[]`, and
`Object.values` yields nothing. Two independent instruments — mine on 2026-09-04, the research
lane's on 2026-09-05 — walked a `FileFacts` with `Object.keys` recursion, saw nothing under
`assignments`, and each concluded the extractor could not read a module-level assignment. Both
published it. Neither was true.

The rule that follows: **an instrument reporting an absence must first report what it failed to
look at.** Every probe in this repository now prints its parse failures beside its counts, for
exactly this reason.

## Where the remaining gap is — measured 2026-09-05

Grep as truth over this repository, every form above plus destructuring, deliberately
over-capturing (a name in a comment or a string counts) so the score is biased DOWN.

| | all files | product source only |
|---|---|---|
| files containing an env read | 191 | 142 |
| **names the fact pass sees** | **30 of 64** | **26 of 53** |
| parse failures | 0 | 0 |

The all-files column is the misleading one and is kept to show why: its misses are led by
`A_ONE`, `B_TWO`, `FOO`, `MY_VAR` — env-read source embedded as STRING LITERALS inside test
files, several of them tests written the same day. Grep counts them; the extractor correctly
sees a string. That is the over-capture, and it is why the product-source column is the number
that means anything.

**Destructuring misses went 3 to 0.** The residual is 25 `member` + 2 `os.environ`, and it is
NOT a missing syntax form:

```
if (process.env.SEQUENCE_DISABLE_ACP) {                          // a condition
const k = (process.env.DEEPSEEK_API_KEY ?? '').trim();           // wrapped, then a chained call
const bindHost = (process.env.SEQUENCE_BIND_HOST ?? '127.0.0.1').trim() || '127.0.0.1';
```

The first has **no slot to be recorded in**. `FileFacts` carries `assignments`, `calls[].args` and
`calls[].kwargs`; a read that is neither assigned nor passed to anything belongs to none of them.
The second is assigned, but the value is a `.trim()` call over a parenthesised `??`, so the
assignment's Part is that call, not the env read inside it.

So the way to the rest of this number is a `FileFacts.envReads` channel that records a read
WHEREVER it occurs, not another case in `evalJs`. That is a shape change to the fact model and is
not attempted here — but it is the reason the score will not move much further without one.
