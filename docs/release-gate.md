# The release gate — what "done" means

**Status: binding.** This supersedes any earlier, looser reading of "done" in
`vision.md` §7 or `usability-standard.md`. If a round's report says "done",
"ready", "releasable" or "ready for customer use", every section below ran and
passed, on the run being reported.

> ### ⚠ PACKAGE NOTE — v2 UI is `@sequence/web2` (2026-08-20+)
>
> `packages/web` was deleted (`20d1424`). All gate commands below use **`@sequence/web2`**.
> Do not invent script names that do not exist on the package. web2 ships:
> `dev`, `build`, `preview`, `test`, `test:e2e`, `test:e2e:shell` (plus named e2e suites
> under `packages/web2/e2e/`). There is **no** `test:e2e:bindings` or `test:e2e:legibility`
> on web2 yet — until those land, legibility is judged by opening the app and looking
> (and by Seat Gates in [`FINISH-OPEN-PHASE-PLAN.md`](FINISH-OPEN-PHASE-PLAN.md)).

GitHub PR CI (`.github/workflows/ci.yml`) is a **subset**: `pnpm test:ci`
(`tools/ci/*.test.mjs` — docs catalog, merge lanes, `start.sh` help, no
`schedule:`/`cron:` in workflows), then `pnpm -r build`, green engine packages
(schema, acp, export, ink, mcp, gateway), and **`pnpm --filter @sequence/web2 test`**.
It does **not** replace e2e, real-repo scale, or human-usability. Desktop suites are not
required checks (need the Electron binary). **Analyzer is required** on PR CI again
(`pnpm --filter @sequence/analyzer test` — isolate-user-store import; terminal hang cleared).

Ops check (not a release gate, not a cron): [`nightly-ops.md`](nightly-ops.md) —
Max asks in chat for PRs, catalog, stale remotes. Max merges; the agent does not.

---

## Why this document exists

Three consecutive rounds were reported as finished and came back from the owner
with the same class of defect still on screen. The post-mortem is short and it is
not about carelessness:

> **Every gate the project had could pass while the app was visibly broken.**

- `pnpm -r build` proves the types line up.
- vitest proves the *model* is right — that a description reaches a box.
- the e2e suites proved things *exist* — "the menu opened", "a sub line is
  present", "no two names are equal".

None of them looked at pixels, and none of them ran on a repo big enough for the
failures to occur. So:

| What shipped green | What the owner saw |
|---|---|
| `+` menu e2e: "the menu opened" ✅ | five menu items crushed into 30px circles, labels stacked on top of each other |
| breakout unit tests: "the description reaches the box" ✅ | six of thirty-six parts, in cards too big to scan, with no way to scroll to the rest |
| `narrowRootContext` tests: 9/9 ✅ | one "Api service" card still swallowing the whole repo |

The first two were invisible because **no test looked at the rendered page**. The
third was invisible because **every fixture in this repo is 3–10 files**, and an
overflow, a truncation or a "+30 more" cannot happen at that size.

Both holes are now closed by the gate below. Read the failure table again before
arguing that a step can be skipped.

---

## 1. Correctness (unchanged, still required)

```
pnpm -r build
node --test                      # per node package: schema · analyzer · acp · export · ink · mcp · desktop
pnpm --filter @sequence/web2 test # vitest
node --test tools/ci/*.test.mjs   # hygiene
```

### 1b. UNSIGNED ENGINEER DESKTOP SMOKE

```
node tools/desktop-smoke.mjs              # the dev shell: electron .
node tools/desktop-smoke.mjs --packaged   # release/, after `pnpm desktop:dist`
```

Not a public download / signed release — engineer packaging smoke only. Added 2026-08-23,
because the Electron package was gated only as far as
`tsc` compiling and `server-control.ts` spawning a CLI with **no window over
it** — and the first time anyone ran the packaging step, it turned out to have
been broken on Windows since it landed, in two different ways, both of which
blamed the user's pnpm install.

The smoke runs the real `main.ts` and waits for a **settled** boot, not a
mounted one. Where the Electron binary is absent it prints `SKIP` on its own
line with the reason; a SKIP that reads like a PASS is the failure this gate is
most exposed to, so the word is never buried.

`--packaged` is not the same test: it exercises `serverPaths()`'s other arm,
where `app.isPackaged` resolves `<resources>/server/...` rather than the
monorepo tree. Running only the dev shell proves nothing about the installer.

Known pre-existing analyzer failures, which are **not** findings and must not be
"fixed" by weakening them: `not ok 37/38` (ai-server generate ×2), `43`
(provider-cap), `313/314` (metering ×2). Any *other* failure blocks.

## 2. Behaviour e2e (web2)

After `pnpm --filter @sequence/web2 build`, run what the package actually ships:

```
pnpm --filter @sequence/web2 test:e2e         # packaged e2e entry
pnpm --filter @sequence/web2 test:e2e:shell   # Decision 5 shell / boot geometry
```

Named suites live under `packages/web2/e2e/` — run the ones that touch the surface
you changed. Do **not** cite deleted v1 script names (`test:e2e:bindings`,
`:process`, `:pairing`, `:legibility`) as if they still gate the product.

Finish-open Seat Gates ([`FINISH-OPEN-PHASE-PLAN.md`](FINISH-OPEN-PHASE-PLAN.md))
batch multiple features into one human walk so we do not stop at every junction.

## 3. Legibility — required; harness not rebuilt yet

The v1 `test:e2e:legibility` harness went with `packages/web`. Until a web2
equivalent exists, the gate is still **look at the rendered app** on a real repo:

1. **Nothing overflows its box.**
2. **No two pieces of text overlap.**
3. **Nothing is clipped silently** — cut off with no ellipsis and no `title`.
4. **No sibling rows are indistinguishable.**
5. **Nothing interactive sits outside the viewport.**
6. **Every scrollable region can actually scroll.**

Capture screenshots (or a Seat Gate video) for any surface the round changed.
Do not invent a `test:e2e:legibility` script name in agent briefs.

## 4. Look at the screenshots / recordings

Not optional. A green vitest suite with a broken seat is still a failed gate.
Finish-open: one demo video per Seat Gate, not per ticket.

## 5. Real scale, not fixture scale

Any claim about layout, truncation, counts or density must be verified against a
repo with **hundreds of files** — the Sequence monorepo is right there and the
legibility sweep already uses it. A fixture proves the *logic*; only a real repo
proves the *result*. `+10 more`, `Shopf…`, "A group of 18 related files" ×12 and
"one database for the whole system" are all invisible at fixture scale.

## 6. Reproduce the owner's report before claiming it fixed

If the round exists because of a report, the round must contain a test that
**fails before the fix and passes after**, built from the reported shape — not a
shape that is convenient to build. Three rounds were spent on `narrowRootContext`
because each fix was tested against a compose file that was *nearly* the reported
one:

| round | tested | the repo actually had |
|---|---|---|
| r81 | `dockerfile: backend/Dockerfile` | no `dockerfile:` key |
| r87 | one root Dockerfile, one `COPY` | several `COPY` lines |
| r89 | several `COPY` + `CMD` | ✔ |

When the exact shape is not known, the scanner must **say so out loud** rather
than guessing or going quiet. Silence is what made this take three rounds:
`copied.size > 1` returned `undefined` and the user got a mega-service card with
no explanation attached to it.

## 7. Report honestly

- Lead with what the owner asked for and whether each item is done.
- State what was **not** done and why — explicitly, not by omission.
- Never write "ready for customer use" when §3–§6 did not run.
- A `KNOWN` entry is a thing you are handing back. Say so in the report.

---

## The one-line version

> It compiles, the model is right, and the elements exist — **and a person can
> open every surface on a real repo and read it.** Both halves, or it is not done.
