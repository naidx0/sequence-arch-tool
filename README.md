# Sequence

**Sequence keeps your architecture honest as the code changes.** Point it at a repository and it
reads the code into a live architecture graph — the real files, the real imports, the real
service-to-service calls — then lets you read it, draw on it, and ask questions about it, with an
assistant whose answers are checked against that graph rather than recalled from a model's
impression of your codebase. It runs entirely on your own machine, works with no account and no API
key, and when it cannot support a claim from what it actually scanned, it says so instead of
guessing.

Everything below carries the commit it was measured at. If a number here has no commit beside it,
treat it as a claim rather than a measurement.

---

## The thing that makes it different: it refuses

Most coding assistants will describe your architecture fluently whether or not they know it. The
description sounds the same either way, which is the problem.

Sequence scans first. Every edge it draws traces to a parse of your code, and every answer carries
what it was drawn from:

> *"answered from 211 of 2,597 edges — 2 components contributed nothing: packages/desktop,
> packages/gateway"*

That line is not decoration. It names the denominator and it names the cut — the parts of your
system this particular answer did **not** see — so you know when to distrust it. Scanning this
repository at `949c84bf` yields **1,068 nodes and 2,858 edges**.

Two recent examples of that discipline, both of which changed the product rather than the wording:

- **A re-export is a dependency.** `export { x } from './y'` was not producing an edge, so the graph
  was missing roughly one dependency in eleven: **2,600 edges → 2,851** on this repository
  (`ecceb7a4`).
- **The prompt stopped inventing service calls.** The text handed to the model was rolling
  file-level imports up into service-to-service edges, asserting **162 service edges that no other
  surface in the product would draw**. Now zero (`53e752e2`). What the model reads as structure is
  what the product is willing to draw.

---

## Teach mode

Ask Sequence to teach you something about the repository and it does not write an essay. It teaches
one concept per turn, draws the picture itself, and ends by asking you something.

**The visual is derived, not requested.** Earlier versions asked the model to produce a diagram;
across 188 measured turns, **182 attempted no visual in any form** (`4fc7ff9d`). So the product stopped asking. It
now builds the chart in code from the scanned graph (`155da648`) — the concept's node, its neighbours, direction
preserved — and a concept that names no node in your repository draws **nothing** rather than
something plausible.

**The check-in is the product's, not the model's.** The closing question is derived from the picture
that was just drawn ("which of X or Y do you think would break first?"), so it is about your actual
code. A turn shorter than 35 words gets no check-in at all — that line is `TEACH_STUB_WORDS` (`de6e28b5`), shared
by the product and its benchmark, and it exists because the question was landing on read-first
preambles that had taught nothing.

**The honest state of it**, from [`docs/journeys/teach-mode.md`](docs/journeys/teach-mode.md), which
walks the whole feature as a person meets it, with screenshots:

*True and checked* — the chart's arrows are the scanned graph's edges with direction preserved,
verified edge by edge for that lesson; the picture persists in `canvas.json` and is still there when
you reopen the session; the lesson is written to `lesson.json` and the concept queue is real.

*Not verified, and therefore not claimed* — that "Continue" advances to a new concept rather than
repeating one has not been observed on the seat, because the queue only advances on a turn that both
drew and got an accepted answer, and no session has yet produced two of those in a row.

*Not claimed at all* — **that the pictures are good.** They are true, they arrive, and they persist.
Whether a learner is better off for them is a question nobody has answered yet.

---

## The laws it is built under

**Grounded, not guessed.** Every edge and every claim traces to real evidence from a real parse. An
answer the graph cannot support is refused, not softened. This is the product's core promise and
every other rule here exists to keep it true.

**A running server must be able to say what it is running.** `GET /api/build` reports when the
process started and when the code it is executing was built. This exists because a day-old server
served this app for a full day while three fixes sat unrun in `dist`, and a person waited two
minutes for a lesson that had already been fixed. A server that cannot say what it is running will
eventually pass for the product. `pnpm check:running` reports it; `pnpm restart:app` fixes it.

**Denominators travel with the number.** A share over an empty denominator is `null`, never `0%`.
Benchmarks in this repository refuse to print a percentage they cannot support and say which field
is missing instead — and the same rule governs the coverage line above. Two companion rules go with
it: *a gate you cannot make fail is not a gate*, and *absence of a signal is not evidence of
absence*.

Those last two are not slogans. A release check here recently refused to publish on a fixture named
`sk-ant-LIVE-KEY-should-never-leak` — a test asserting that keys do not leak — and the fix was to
make the check discriminate real key material rather than to widen it until it stopped complaining.

---

## Download

Two ways in, and the honest trade between them.

**An installer**, from the [releases page](../../releases) — a `.exe` for Windows, a `.dmg` for
macOS. Double-click, and the app brings its own Node runtime and its own server; nothing else to
install.

**Or the source**, three steps below. Slower to start, and you can read every line of what you are
about to run — which, for a tool whose entire pitch is that it does not ask you to take its word for
things, is not a small thing to be able to say.

### The installers are unsigned, and they will warn you

There is no Apple Developer certificate and no Windows code-signing identity behind this project.
Both cost money and one costs an annual account, and neither would make the program any safer than
the source you can already read. So the operating system has nothing to check the download against,
and it says so in the strongest words it owns:

| | What you'll see | The way through |
|---|---|---|
| **macOS** | *"Sequence can't be opened because it is from an unidentified developer."* | **Right-click** (or Control-click) the app → **Open**, then **Open** again. Once, ever. |
| **Windows** | *"Windows protected your PC"* (SmartScreen) | **More info** → **Run anyway**. |

Do not double-click the macOS app expecting the dialog to offer you a way past — it does not. The
right-click path is the one that offers a confirmation; that is a deliberate piece of macOS design
and not a bug in the download.

Those warnings mean *unverified*, not *unsafe* — but "unverified" is a real thing to be told, and
the instinct to distrust an unsigned binary from a stranger on the internet is a good one worth
keeping. If it is pulling at you, clone the repository instead. It is the same program, built from
the tree you just read.

---

## Running it, in ten steps

Prerequisites: **Node 20+** (ships with `corepack`, which provides `pnpm`) and **git**. Nothing else,
and no account.

1. `git clone <this-repo-url> sequence`
2. `cd sequence`
3. `./start.sh` — on Windows, `.\start.ps1`. It installs, builds, and opens your browser.
4. Your browser opens the app at `127.0.0.1`. Nothing has left your machine.
5. Pick a repository on the home screen — or skip steps 3–4 and run `./start.sh /path/to/your/project`
   to scan one on startup.
6. You land in the workspace on **Chat**. Ask it something about the code you just pointed it at.
7. Read the line under the answer: *"answered from N of M edges"*. That is what the answer was
   actually built from.
8. Open **Architecture** from the workspace tabs to see the graph beside the assistant. `+` → Files
   expands the index rail.
9. Open the `+` menu in the composer and pick **Teach** to be taught a concept from your own
   repository, with a chart drawn from your own code.
10. To stop, `Ctrl+C` in the terminal you launched from.

No AI key is needed for any of that except chat itself. Scanning, the architecture board, the
whiteboard, drawing, impact and risk analysis, and export all run locally for free; a key adds the
assistant and plain-English naming on the cards.

---

## What it is not

- **It is not a cloud service.** There is no hosted version to sign into. It binds to `127.0.0.1`
  and your code does not leave the machine.
- **It is not an autonomous agent that ships code while you sleep.** It reads, explains, draws, and
  proposes; you decide.
- **It is not finished, and it does not pretend to be.** The `docs/` in this mirror includes the
  journey page and the architecture decision records precisely because they state what is unverified
  as clearly as what works.
- **It is not a benchmark score.** Nothing here claims to beat another tool at anything. Where this
  project has measured itself it has published the refutations too, including the ones that cost it
  a favourite hypothesis.
- **It is not a diagram generator.** A picture it cannot ground, it does not draw.

---

## This mirror

This repository is built from a private working tree by `tools/release/mirror.mjs` as **one squashed
commit per release** — so it carries no development history by design. The build refuses to run if
any personal path, machine identifier or key-shaped token survives into the tree, and the check runs
over the finished output rather than the input. See `CHANGELOG.md` for what each release contains.

## Licence

See [`LICENSE`](LICENSE) and [`docs/THIRD-PARTY-NOTICES.md`](docs/THIRD-PARTY-NOTICES.md).
