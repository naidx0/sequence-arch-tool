<p align="center">
  <img src="packages/desktop/build/icon.svg" width="104" alt="Sequence logo">
</p>

<h1 align="center">Sequence</h1>

<p align="center"><b>A live map of your codebase, with a source line for every arrow.</b></p>

<p align="center">
  <a href="https://github.com/naidx0/sequence-arch-tool/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/naidx0/sequence-arch-tool?label=release&color=2f6feb"></a>
  <a href="https://github.com/naidx0/sequence-arch-tool/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/naidx0/sequence-arch-tool/total?color=2f6feb"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
  <img alt="Platform: Windows and macOS" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-lightgrey">
  <img alt="Runs locally" src="https://img.shields.io/badge/runs-100%25%20local-black">
</p>

<p align="center">
  <a href="https://www.usebastion.io/media/sequence/demo.mp4"><img src="report/media/sequence-demo.gif" width="900" alt="Sequence attaches a sample shop repository, draws its services and the calls between them, then zooms in on the traced edges"></a>
</p>

<p align="center">
  <a href="https://github.com/naidx0/sequence-arch-tool/releases/latest"><b>Download</b></a> ·
  <a href="https://www.usebastion.io/products/sequence">Product page</a> ·
  <a href="report/media/sequence-full.mp4">Full 72-second demo</a> ·
  <a href="#results-at-a-glance">Results</a> ·
  <a href="report/README.md">How it was measured</a> ·
  <a href="https://www.usebastion.io">Bastion</a>
</p>

Sequence reads a codebase and draws its architecture: the services, the files, the databases, and the
lines between them. Then you can ask it questions, and it answers from that map instead of from a
model's guess. It runs on your own machine, free, with a local model or one you connect.

The clip above is 14 seconds of the [product demo](https://www.usebastion.io/media/sequence/demo.mp4)
(click it for the whole video). The [72-second demo](report/media/sequence-full.mp4) in this repository
attaches a repository, watches the map get built, then asks it something.

## Results at a glance

Every number below is from the [field report](report/README.md) on the 0.1.3 release, which redraws
its charts from [`report/data.json`](report/data.json). Each was measured against a baseline on a
question set frozen before the run.

| What was measured | Before | With Sequence | n | Source |
|---|---:|---:|---|---|
| Architecture answers, same local agent (F1) | 0.09 | **0.21** | 36 sealed questions, 2 runs per arm, +0.128 at 2.5 SE | [report §6](report/README.md#6-the-same-agent-with-and-without-sequence) |
| Full answers on the release question bank | 39% | **90%** | 72 turns per snapshot | [report §2](report/README.md#2-answer-quality-and-speed) |
| Average answer time | 14.0 s | **7.8 s** | the same 72 turns | [report §2](report/README.md#2-answer-quality-and-speed) |
| Prompt tokens for one question | 4.9M | **1,887** | every matching file (428) vs one map slice | [report §4](report/README.md#4-large-codebases) |
| Repeat scan, served from cache | 6.47 s | **0.55 s** | 2,558 files, 1,329 nodes, 3,499 edges | [report §3](report/README.md#3-memory) |
| Labelled service connections found | | **15 of 15** | reference repository, none invented | [report §5](report/README.md#5-finding-the-right-files-and-connections) |

The weak spot is measured too: Sequence's own file picker finds a file a real fix touched 3% to 9% of
the time, where grep finds 22% to 64% ([report §5](report/README.md#finding-the-fix-in-real-history)).

## Screenshots

<table>
  <tr>
    <td width="50%"><a href="report/media/screen-map.png"><img src="report/media/screen-map.png" alt="The Architecture board for the shopfront sample: Edge, Gateway, Invoices, Payments, Orders, Inventory, Notifications, Shipping and a Postgres database"></a><br><sub><b>The map.</b> Open a folder and the Architecture board draws its services, stores and topics from the code.</sub></td>
    <td width="50%"><a href="report/media/screen-traced-edges.png"><img src="report/media/screen-traced-edges.png" alt="Zoomed board: each service card reads SERVICE TRACED, and edges are labelled with routes such as GET /orders/* and topics such as publish order.created"></a><br><sub><b>Edges with evidence.</b> Every card says how it was traced; every edge carries the route, call or topic it came from.</sub></td>
  </tr>
  <tr>
    <td width="50%"><a href="report/media/screen-inside-a-service.png"><img src="report/media/screen-inside-a-service.png" alt="Inside the orders service: main.py, routes.py, db.py, events.py, inventory_client.py and payments_client.py with their imports"></a><br><sub><b>Inside a service.</b> Open one service to see its modules and how they call each other.</sub></td>
    <td width="50%"><a href="report/media/screen-impact.png"><img src="report/media/screen-impact.png" alt="Review panel: an unstaged diff of payments/src/index.js beside an Impact column listing what breaks, edges grounded on a changed line, and functions changed with their callers"></a><br><sub><b>Impact of a change.</b> A diff beside what it breaks: the edges grounded on a changed line and who calls the changed functions.</sub></td>
  </tr>
</table>

---

## Why I built it

Ask a coding assistant how your system fits together and you usually get a confident answer. Some
of it is right. Some of it describes a system that looks like yours but isn't. The answer reads the
same either way, so you can't tell which parts to trust without checking all of it yourself.

The usual fix is to paste more code into the model. That gets expensive fast, and on a big repository
the file that matters is often not in the window at all.

Sequence takes a different route. It reads the code first, with ordinary static analysis and no model
involved, and builds a map. Every line on that map points at the file and line that proves it. The
model is then given the part of the map that matters for your question, so it works from evidence it
can cite rather than from memory.

## How it works

```mermaid
flowchart LR
    A[Your repository<br/>on disk] --> B[Scanner<br/>imports, calls, routes,<br/>queues, databases, configs]
    B --> C[The map<br/>every edge has a file and line]
    C --> D[Architecture board<br/>you can read and draw on]
    C --> E[You ask a question]
    E --> F[Only the relevant slice<br/>of the map goes to the model]
    F --> G[Answer with file paths,<br/>and the path drawn on the map]
    C --> H[MCP server<br/>who_calls, impact, path_between<br/>for other agents]
```

1. **Scan.** The scanner parses the repository: imports, function calls, HTTP routes and the clients
   that call them, gRPC, queues, database access, Docker Compose, Kubernetes and Helm. It works
   across languages, so a TypeScript gateway calling a Python service is one line on the map.
2. **Map.** Each edge keeps its evidence: the file, the line and the snippet. An edge that only a
   config file claims is drawn dashed until the code confirms it.
3. **Ask.** When you ask something, Sequence picks the part of the map your question is about and
   hands only that to the model, with a few relevant files. The answer names the files it used.
4. **Show.** The answer's path is drawn on the map, so you can check it with your eyes instead of
   taking the text's word for it.

Other agents can use the same map. Sequence ships an MCP server with `who_calls`, `impact` and
`path_between`, so Codex, Claude Code or your own agent can ask the map the same questions.

## What that buys you

**Answers you can check.** Every claim points at a file and a line, and the coverage line under each
answer says how much of the map it actually drew on.

**A flat cost, however big the codebase is.** Pasting source into a model costs more the more you
paste. Sequence sends the same small slice every time:

![Tokens sent per question stay flat while pasting source grows with the window](report/context-window.svg)

On this repository, reading every file that mentions a question's words would cost 4.9 million
tokens. Sequence answers the same question from 1,887.

**A better small agent.** We gave the same local agent (a 4B model on an 8 GB card) 36 architecture
questions with hand-checked answers, once with plain shell tools and once with the map added. Nothing
else changed.

![The same agent, with and without Sequence](report/agent-ab.svg)

Accuracy went from 0.09 to 0.21, and both runs with the map beat both runs without it. The map's
biggest help was on "what breaks if I change this file": 0.02 without it, 0.19 with it. It does
cost more: the agent with the map kept working where the plain agent gave up after one command, so
it used about four times the tokens.

**Answers that got better as we tuned them.** Each change below was kept only if it beat the one
before on the same sealed questions:

![Full answers rose from 39% to 90% while answer time fell from 14 to 7.8 seconds](report/release-bank.svg)

**Local and private.** It binds to `127.0.0.1`. Your code does not leave the machine unless you
connect a cloud model yourself.

## How it compares

Other projects have added code graphs to agents too. The published results line up with ours:

| Approach | What happened | Source |
|---|---|---|
| Keyword search alone (BM25) | Finds a file the fix touched in its top 5 on about 62% of SWE-bench Lite issues | LocAgent, ACL 2025 |
| Keyword search plus a repository graph | About 5.6 points better at finding the right file | RepoGraph, ICLR 2025 |
| A code graph served over MCP to a large model | Fewer tokens, slightly lower answer quality than plain file reading | Codebase-Memory (preprint, 2026) |
| Sequence's map given to a small local agent | Accuracy 0.09 to 0.21, more tokens | [our report](report/README.md#6-the-same-agent-with-and-without-sequence) |

Two honest takeaways. A map helps most as an addition to search, not a replacement for it. And
Sequence's own file picker is still weak: replayed over 344 real commits, it put a file the fix
touched in its top five only 3% to 9% of the time, where plain grep managed 22% to 64%. It matches
words against file names but not file contents, and that is the next fix.

![Finding the files a real fix touched](report/find-the-fix.svg)

## How it's set up

- **Model.** Any OpenAI-compatible endpoint. By default that is a small model in Ollama on your own
  machine, which is how every number above was measured. You can point it at a cloud model instead.
- **No key needed for the map.** Scanning, the board, the whiteboard, drawing, impact and risk
  analysis, and export all run without any model.
- **Teach mode.** Ask it to teach you part of your own repository and it explains one idea at a
  time, draws the chart from the scanned code, and asks you a question about it. The walkthrough is
  in [`docs/journeys/teach-mode.md`](docs/journeys/teach-mode.md).

## Download

| Platform | File | Size |
|---|---|---|
| **Windows**, installer | [`Sequence.Setup.0.1.3.exe`](https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.3/Sequence.Setup.0.1.3.exe) | about 107 MB |
| **Windows**, portable | [`Sequence-0.1.3-win.zip`](https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.3/Sequence-0.1.3-win.zip) | about 144 MB |
| **macOS**, Apple silicon | [`Sequence-0.1.3-arm64.dmg`](https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.3/Sequence-0.1.3-arm64.dmg) | about 129 MB |
| **macOS**, Intel | [`Sequence-0.1.3.dmg`](https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.3/Sequence-0.1.3.dmg) | about 136 MB |

Checksums are in [`SHASUMS256.txt`](https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.3/SHASUMS256.txt).
Every version is on the [releases page](https://github.com/naidx0/sequence-arch-tool/releases); you can also
download from [trysequence.app](https://trysequence.app/#download). Each build was downloaded
and launched on a fresh machine before release.

The builds aren't signed yet, so your system will warn you the first time:

| | What you'll see | What to do |
|---|---|---|
| **macOS** | "Apple could not verify Sequence is free of malware" | Open it once, then go to **System Settings → Privacy & Security** and press **Open Anyway**. |
| **Windows** | "Windows protected your PC" | Click **More info**, then **Run anyway**. |

If you'd rather not click past a warning, build it from source below. It's the same program.

## Run from source

You need Node 20 or newer and git.

```bash
git clone https://github.com/naidx0/sequence-arch-tool sequence
cd sequence
./start.sh                      # on Windows: .\start.ps1
./start.sh /path/to/your/repo   # or scan a repository straight away
```

It installs, builds and opens the app in your browser at `127.0.0.1`. Pick a repository, open
**Architecture** to see the map, and ask a question in **Chat**. `Ctrl+C` stops it.

## What it isn't

- Not a cloud service. There is nothing to sign in to.
- Not an agent that ships code on its own. It reads, explains, draws and proposes. You decide.
- Not finished. The [report](report/README.md) lists what works, what didn't, and what's next.

## About this repository

This public copy is built from the private working repository, one commit per release, by
`tools/release/mirror.mjs`. That script refuses to publish if a personal path, machine name or
anything shaped like a key would end up in the tree. `CHANGELOG.md` lists what each release changed.

Licence: [`LICENSE`](LICENSE). Third-party notices: [`docs/THIRD-PARTY-NOTICES.md`](docs/THIRD-PARTY-NOTICES.md).

---

<p align="center">
  <a href="https://www.usebastion.io"><img src="report/media/bastion-mark.svg" width="40" alt="Bastion"></a><br>
  <sub>Sequence is a <a href="https://www.usebastion.io">Bastion</a> product. More on the <a href="https://www.usebastion.io/products/sequence">product page</a>.</sub>
</p>
