# Run Sequence on your computer

Sequence is a **local-first** app — it runs entirely on your machine (`127.0.0.1`),
reads your local repos, and uploads nothing. That also means it can't be "already
open" from a cloud session: you launch it locally with one command.

## Fastest path (already have this repo cloned)

```bash
git pull                 # get the latest from main
./start.sh               # reinstalls/rebuilds when manifests or source changed, then opens your browser
```

Or, on Windows:

```powershell
.\start.ps1
```

Or, to scan a specific repo on startup:

```bash
./start.sh /path/to/your/project
```

That's it — your browser opens to the app. Pick a repo from the home screen (or use
the `/path/...` argument), and you land in the workspace on **Chat alone**. Open
**Architecture** or **Whiteboard** from the workspace tabs when you want the board
beside the assistant (Files via `+` expands the index rail inside Architecture).

No AI key is needed to start. Scanning, the architecture board, the whiteboard,
drawing, impact and risk analysis, and export all run locally for free. A key only
adds plain-English naming on the cards, chat, and designing from a description.

## From a fresh machine

Prereqs: **Node 20+** (the version the repo's `package.json` requires; it ships with
`corepack`, which provides `pnpm`) and **git**.

```bash
git clone <your-repo-url> sequence
cd sequence
./start.sh
```

`main` is the branch you want — it is what ships. Do not check out one of the older
`claude/*` or `loop/*` branches; several diverged in July and are missing months of
work.

## If `./start.sh` won't run (permissions)

```bash
chmod +x start.sh && ./start.sh
```

## The plain commands (what start.sh runs)

```bash
corepack enable          # once, to get pnpm
pnpm install             # again when package.json / pnpm-lock.yaml change (start.sh does this)
pnpm build               # again when source is newer than dist (start.sh does this)
pnpm start               # launch + open browser
#   pnpm start -- --repo /path/to/project   to attach a repo on startup
#   pnpm start -- --port 4173               to pick the port
#   pnpm start -- --no-open                 to not auto-open the browser
```

## Notes

- **Everything is local.** The server binds to `127.0.0.1` only; your code never
  leaves your machine.
- **AI chat** works today with your own Anthropic/OpenAI API key (Settings → Connect
  AI). The "free default model" is honest about being deploy-gated — it activates
  once the hosted gateway is stood up; until then, add your own key.
- **In-app Terminal / Browser / AI canvas** are listed in the workspace `+` menu
  but are **not shipped in web2 yet** (parked until P8). Use your OS terminal for
  shells. An analyzer loopback socket may still exist; there is no web2 Terminal pane.
- **Stop the app** with `Ctrl+C` in the terminal where it's running.

## Restart the running app after a push — and check that you did

**A day-old `sequence app` served port 4173 on 2026-09-05 while the derived visual, the reasoning
narrowing and the one-assembly teach turn all sat in `dist` unrun.** A person opened the product,
waited two minutes and thirteen seconds for a lesson that wrote no `lesson.json` and drew no chart,
and every one of those defects had already been fixed and pushed. Nobody noticed for a day, because
the seat checks were run against separately-started instances and the stale one was never asked what
it was running.

**A running server that cannot say what it is running will eventually pass for the product.**

After `pnpm -r build`, restart the app and verify:

```bash
node tools/ci/check-running-build.mjs 4173
```

`GET /api/build` reports `startedAt`, `builtAt` and `stale`. `builtAt` is the mtime of the entry file
the process is executing — not a git commit, deliberately: the commit says what the WORKING TREE is
on, which is not what a running process loaded, so a server started before a rebuild reports the same
commit as one started after it. That is exactly the confusion this ends.

The check exits 1 only when a server is running code older than the code on disk. **A port with
nothing listening is not a failure** — failing on it would train people to ignore this.

Before any claim about "what the product does", run the check. A seat read against a stale server is
a measurement of last week.

### Restarting it: one command, not a hook

Checking every time still left the restart to be *remembered*, and it was forgotten after most
pushes on 2026-09-05. So the restart is a command too:

```bash
pnpm restart:app
```

It checks the port, and when the server is behind the code it kills that process and relaunches it
with **the arguments it already had** — the same repository, the same port — then verifies by asking
`/api/build` again and prints the build line. When nothing is stale it does nothing and says so.

Two refusals are deliberate, because a tool that restarts servers can do more harm than the staleness
it fixes:

- **It only kills a server that says it serves THIS repository.** The identity test is
  `/api/status`'s `root`, not the port and not the command line — a port is not proof of identity,
  and a different checkout of the same product answering on 4173 is left alone and reported.
- **It is not a git hook.** A hook restarting servers would be a standing rule on a machine that
  runs more than one agent: another session drives 4173 to read the product, and a hook firing on
  someone else's push would kill a server mid-read with no explanation visible to the reader. A
  restart is cheap; a silent kill during someone else's measurement is not. So the push path is
  `pnpm -r build && <gate> && git push && pnpm restart:app` — one more command, run
  deliberately.

### The counting gate: did every test file actually run?

```bash
pnpm gate:count
```

`pnpm -r test` prints a lot of green; what it does not say is whether that green covers the files
that exist. This runs `node --test` across every package that declares one, from **one discovery
list that is both counted and run** — not a second glob that ought to agree with the first.

Read the exit code, never the output: **0** every discovered file ran and passed, **1** a test
failed, **2** a file was discovered and contributed no test. A caller that greps this for "ok" is
asking a question the exit code already answered, and greppable output is how a red run gets pushed.

Its first run found two things `pnpm -r test` was not surfacing, both in packages outside the
standing three-gate: an `@sequence/mcp` cap that a scan change had pushed one caller past, and every
`@sequence/desktop` spawn test failing because the child inherited `NODE_TEST_CONTEXT`.

`pnpm check:running` is the report-only half (exit 1 if stale, touches nothing), for a CI job or a
session that wants to know without acting.
