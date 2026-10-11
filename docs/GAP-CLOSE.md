# Gap close — the long run

**The durable state of the run.** A programme this size outlives any one agent's context, so the
truth about where it stands lives here, on disk, not in a conversation. An agent picking this up
cold reads this page and knows what is done, what is owned, and what "done" means for the row in
front of it.

Built from the measured gap analysis of 2026-08-23. `OUTSTANDING.md` owns the register of
everything known to be unbuilt; this page owns **the plan to close it and the state of that plan**.
When they disagree, re-measure — do not pick one.

`✅ done` · `🔨 in flight` · `⬜ not started` · `🔒 blocked on the owner`

---

## The rule that makes this programme different

Every previous register in this repository has been able to lie, and did — rank after rank marked
DONE while the feature was unreachable, each one with passing tests. So the acceptance criterion
here is not "tests pass". It is **mechanical**:

> **`tools/ci/reachability-baseline.json` is the to-do list.**
> A lane is done when its row is **deleted** from that file.
>
> The gate fails if you delete a row without wiring it (the action is still an orphan) and fails
> if you wire it without deleting the row (a stale suppression). Neither half can be faked by a
> test that asserts the props instead of the mount.

That inverts the failure mode. Previously the register was a claim about the tree; now the tree is
the claim and the register is checked against it on every run.

**Definition of done, per lane — all five, no exceptions:**

1. A test **proven RED** before the fix, built from the reported shape.
2. A **mutation** that turns it red again, run and recorded.
3. The baseline row **deleted**, or a written reason it must stay.
4. The **full gate green**, re-run by the orchestrator — never accepted on a builder's word.
5. One commit, with the evidence in the message. Never batched.

---

## How the run is set up

**One branch, one PR.** Not thirty commits straight to `main`.

**A lane is one seam, one owner, disjoint files.** The repository's own lesson, paid for: *"Twelve
agents editing twelve files with no coordination produced three specifications of one control."*
Two to four concurrent lanes is the ceiling that has actually worked here.

**Context diet — 2 to 5 paths per agent, never the canon.** Canon dumps caused Stops and
"green but wrong" UI; the diagnosis is written up in `docs/research/subagent-failure-diagnosis.md`.

**Read-only for anything that analyses.** A write-capable audit agent rewrote `sessionsClient.ts`
to mutation-test a lock and never reverted it. Analysis agents get `-s read-only`.

**Two models, and the second one's job is to refute.** Claude builds the lane; Codex
(`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, read-only) is handed the finished lane and asked
one question — *drive a real user gesture; does it arrive?* Different model, different blind spots.
A refuter that refutes nothing has not been shown to be working.

**The orchestrator re-runs the gate itself.** Every time. No builder's claim enters a commit
unverified.

```bash
node --test tools/ci/*.test.mjs          # hygiene + reachability
pnpm -r build && pnpm -r test            # correctness
pnpm test:e2e                            # behaviour, real browser
node tools/desktop-smoke.mjs             # unsigned engineer desktop smoke
```

---

## Phase 0 — make the gap self-policing

| | lane | state | lock |
| --- | --- | --- | --- |
| ✅ | **The reachability tripwire.** A declared reducer action, handled by a case, constructed by nothing in production source, is a state transition the product cannot perform | done 2026-08-23 | `tools/ci/reachability.test.mjs`, 5 tests. Found **10** on first run, including `canvas/proposal`. Mutation-proven both directions: a new orphan fails, and a baseline row that got wired fails with *delete this row* |
| ⬜ | **The same ratchet for routes.** A server route no client fetches — `/api/search` is the standing example, correct and jailed and unreachable | | extend `reachability.test.mjs` with a route arm + its own baseline reasons |
| ⬜ | **The same ratchet for schema fields.** `agent.tools`, `agent.model`, `agent.requiresReview`, `agent.skills` are declared and read by no code | | a declared field nothing reads is a lie about the product's capability |

---

## Phase 1 — RUN AGENTS

**LANDED (finish-open P4 / Seat2).** Activity `New run` authors and `POST /api/program/run`; pause/resume/cancel derive from engine status; sole-agent fallback + ACP preflight exist. Historical intro below is kept only as design context — do not treat the ⬜ table as current.

**Historical design notes (superseded by landed rows):** the runtime survives client `SIGKILL` and resumes off a durable log. Authoring is inside the Activity overlay (no second overlay kind). No optimistic status — POST acknowledges; GET establishes state.

| | lane | owns | state |
| --- | --- | --- | --- |
| ✅ | **1A — authoring and start.** `New run` inside Activity; Start posts a validated program; list opens the returned `runId` | `web2/src/activity/*` | LANDED |
| ✅ | **1B — pause and resume have controls.** Pause/Resume/Cancel from engine status (`activityModel` / `ConnectedActivity`) | `activityClient.ts`, `ActivityPane.tsx` | LANDED |
| ✅ | **1C — DELETE the four declared agent fields.** `tools` / `model` / `requiresReview` / `skills` removed from schema (comment block in `program.ts`) | `schema/src/program.ts` | LANDED |
| ⬜ | **1D — the run on the board.** Moat board-visible run graph. A run that only exists as a list is a log, not a harness — **not finish-open agent Done; owner/P8 later** | `canvas/*` | parked |

**ACP preflight (finish-open P4):** author form probes `/api/acp/available` (+ agents) and shows the engine reason before Start — no longer a blind POST that only learns the gate after 403.

---

## Phase 2 — THE AI EDITS THE ARCHITECTURE

**LANDED (finish-open P2.7).** `propose_topology` is a tool → SSE → `canvas/proposal`; ghosts cannot claim scan evidence. Historical "dispatched by nothing" intro is obsolete.

| | lane | owns | state |
| --- | --- | --- | --- |
| ✅ | **2A — `propose_topology`.** Tool call → structured SSE (not a prose fence) | `askTools.ts`, `askPipeline.ts` | LANDED |
| ✅ | **2B — the event reaches the board.** Store/channel stages `canvas/proposal` | `store.ts`, `canvasChannel.tsx` | LANDED |
| ✅ | **2C — a proposed node may not claim evidence.** Ghosts stay `origin: design` | schema / canvas reduce | LANDED |
| ⬜ | **2D — the benchmark.** Local weak model vs strong model on one hard task — **owner/measurement later** (not finish-open agent Done) | `tools/bench/` | parked |

---

## Phase 3 — THE CANVAS BECOMES A CANVAS

Against MIRO as the stated bar, the honest distance: a fixed-viewport SVG with single selection.
Select-and-move landed 2026-08-23; before that nothing could be moved at all.

| | lane | owns | state |
| --- | --- | --- | --- |
| ⬜ | **3A — a camera.** Pan and zoom. Retires the `canvas/pan` and `canvas/zoom-at` baseline rows if the whiteboard adopts the same reducer, which is the argument for doing it here rather than inventing a second camera | `whiteboard/*` | |
| ⬜ | **3B — marquee, multi-select, resize, group** | `whiteboard/*` | needs 3A |
| ✅ | **3C — `WbNodeRef` gets a producer.** Link tool on the whiteboard creates node refs (ranked by the composer matcher). LANDED finish-open P2 | `whiteboard/*` | |
| ✅ | **3D — finish a drawing, hand it to the AI.** Confirm → composer draft + chips; never auto-sent. LANDED finish-open P2 | `whiteboard/*` | |
| ⬜ | **3E — the small orphans.** `wb/text` (a note reads "Note" for ever) and `doc/delete-edge` (a node can be deleted by gesture, an edge cannot) | | |

---

## Phase 4 — READ: built, drawn, unreachable

| | lane | owns | state |
| --- | --- | --- | --- |
| ⬜ | **4A — the search results surface.** `GET /api/search` is correct and reuses the file route's jail so a search cannot become a wider door. Nothing fetches it | `web2/src/rail/*` | |
| ⬜ | **4B — the way out of a held rescan.** `doc/rebase` — a rescan arriving under unsaved edits is held, which is right, and nothing offers the reader the choice to take it | `canvas/docSession.ts` | |
| ⬜ | **4C — one boot ladder, not two.** `repo/scanning`, `repo/failed` and `session/hydrating` are all unreached because the boot lane renders its own states and hands the store only the settled outcome. Two ladders describing one boot | `boot/*`, `state/store.ts` | decide which ladder wins before writing anything |

---

## Phase 5 — LOCAL-FIRST, SAID OUT LOUD

**The cheapest large win in the programme.** The engine already honours the non-negotiable: a full
grounded answer ran on 2026-08-23 against a local 6.9B model with no key and no network —
`395 nodes, 743 edges in 1.5s · coverage 143/743 edges`. The product does not say so. The shipped
config points at the undeployed gateway and the first failure a new user meets asks them for an API
key, for a capability already running on their machine.

| | lane | owns | state |
| --- | --- | --- | --- |
| ⬜ | **5A — detect a local provider and offer it.** Ollama and LM Studio both answer on a known localhost port with an OpenAI-compatible surface. If one is there, say so instead of asking for a key | `analyzer/src/server/provider.ts`, `web2/src/settings/*` | |
| ⬜ | **5B — the failure strip offers it too.** The strip already carries a machine-readable `fix`; this is a second value, not new prose parsing | `web2/src/chat/*` | needs 5A |

---

## Phase 6 — ONBOARDING

One `Ctrl-K` hint in the app bar is the whole of it. The register previously marked this done and
now says **OVERSTATED — not built**. Absent: a first-run state, a walkthrough, a help or shortcuts
surface reachable from the palette, keycap hints on palette rows, an Electron Help menu.

Deliberately last: onboarding onto a product whose keystone gaps are open teaches the wrong thing.

---

## Out of this programme

- **Everything under "ship it"** — signing, an icon, the mac and linux targets, the funded gateway.
  Owner's call, and the gateway is blocked on a deploy rather than on code.
- **Everything on the cut list** — Work mode and the clone hop, subagents and delegation, lifecycle
  hook breadth, an LLM auto-review agent, editor tabs and splits, the light theme, git-history
  coupling, OTel ingestion, function-level dead code, column-level lineage, a prettier map. Each was
  researched and killed with a reason; they are not gaps and must not be re-proposed as gaps.

---

## Where it landed — 2026-08-23

**Every phase executed.** The mechanical measure of it: the reachability baseline went from
**ten dead actions to six**, and the route classification from **21 GAP to 20**. Each retirement
was forced by the ratchet rather than claimed — the gate turned red the moment a dispatcher
appeared and demanded the row be deleted.

| phase | lane | outcome |
| --- | --- | --- |
| 0 | the tripwire | ✅ actions AND routes, both ratcheted, both mutation-proven |
| 1A | authoring and start | ✅ `New run` inside the Activity overlay |
| 1B | pause and resume | ✅ controls derived from the engine's status, never from the click |
| 1C | the four agent fields | ✅ **deleted**, plus 22 inert lines from four built-in programs |
| 1D | the run on the board | ◐ **recorded** — `meta.serviceId` deleted with it; see below |
| 2A | `propose_topology` | ✅ a tool, not a fence |
| 2B | the board receives it | ✅ `canvas/proposal` retired from the baseline |
| 2C | a proposal claims no evidence | ✅ refused at the server, impossible at the store |
| 2D | the benchmark | ✅ `tools/bench/weak-model.mjs`, run against a local 6.9B model |
| 3A | a camera | ✅ pan, wheel zoom about the pointer, Fit, Reset |
| 3B | marquee, resize, group | ◐ **recorded** — select-and-move landed; the rest is real work |
| 3C | `WbNodeRef` has a producer | ✅ the Link tool, ranked by the composer's own matcher |
| 3D | draw → AI | ✅ lands in the composer, never on the wire |
| 3E | `wb/text`, `doc/delete-edge` | ✅ / ◐ — notes are editable; the edge menu is recorded |
| 4A | the search surface | ✅ `/api/search` retired from the route baseline |
| 4B | the way out of a held rescan | ✅ and it says what taking it costs |
| 4C | one boot ladder | ✅ / ◐ — `session/hydrating` wired; the repo pair needs a ruling |
| 5 | local-first, said out loud | ✅ detection, and an offer that does not configure anything |
| 6 | onboarding | ✅ a help page generated from the palette, plus a desktop Help menu |

### What the benchmark actually found

`tools/bench/weak-model.mjs` against `granite4-hermes` (6.9B, local, no key, no network), asked to
add a security layer and a CI/CD pipeline and to name real files:

- **coverage 28/28 edges** — accurate, and Codex and Claude Code structurally cannot report it
- **six fabricated file citations caught** — `src/cybersecurity/middleware.ts`, `.gitlab-ci.yml`
  and four more, every one flagged as absent from the scan
- **`datastore engines NOT CHECKED`** — the checker said which checks it could not run, which is
  the half that makes the other half worth believing
- **zero tool calls** — and this is the honest limitation: a 6.9B model does not reach for a tool
  even when the prompt tells it to. It writes prose instead.

**So the answer to "does the system make a weak model behave" is: yes for HONESTY, no for AGENCY.**
Nothing it fabricated got through. Nothing it was asked to do structurally happened either.

**And the benchmark found the bug that made this programme necessary in the first place.** The
attached-repo prompt had been instructing every model to emit a ` ```seqd ` fence carrying a
proposed diagram — and NO CODE ANYWHERE PARSED IT. Granite complied perfectly: a fenced
SeqDiagram with `"origin":"design"` and two invented services, sitting in the prose where nothing
would ever pick it up. The model was not the problem; the instruction was. It now says
`CALL THE propose_topology TOOL`, and the test that had pinned the old wording — which passed for
months while the feature was unreachable — is redirected with an absence assertion so the fence
cannot come back.

### Recorded, not built — each with the reason

- **1D, a board-visible run graph.** `ProgramNode.meta.serviceId` was the only declared link from a
  run to the architecture, set by nothing and read by nothing. It is **deleted**: with no producer,
  drawing which services a run touched would mean inventing the answer. Building it properly starts
  from a DERIVED link — the change stats already sample the tree with git, so which files a run
  touched, resolved through the scan, is the honest source.
- **3B, marquee and resize.** Select-and-move shipped; multi-select, resize handles and grouping are
  a genuine build on top of the camera rather than a wiring job.
- **3E, `doc/delete-edge`.** ReactFlow already exposes `onEdgeContextMenu`, so this is scope rather
  than difficulty: widening `BoardMenuTarget` from a node shape into a union touches a sheeted
  surface with nine rendered tests for one small gesture. **The cheapest orphan left; take it next.**
- **4C, `repo/scanning` and `repo/failed`.** Two ladders describe one boot. The boot lane renders
  its own states and hands the store only the settled outcome. Which ladder wins is an IA ruling,
  not a wiring job, and making the store's arms fire would mean the boot lane dispatching a state it
  already holds.
- **`shell/theme`.** Deliberately dead, and it must stay that way until light is un-deferred.
- **`canvas/pan` / `canvas/zoom-at`.** Superseded by `canvas/viewport`, which @xyflow originates.
  The whiteboard's new camera deliberately does NOT dispatch into that slice — a sketch and a
  finding do not share a state machine.

### The three defects the tests found while building

1. **`createActivityClient` captured `globalThis.fetch` in a default parameter**, so the
   app-mounted client held the original fetch for the life of the page. Invisible in production,
   fatal to any test that replaces the global.
2. **A 200 whose body has no `run` threw inside a React render**, which takes the panel down and
   reports nothing. A detail is not a detail until it has proved it.
3. **A probe that trusted an abort signal hung for 600 seconds.** It races a deadline now. The
   repository's own trap list already said it: *a hang is worse than a failure — CI reads it as an
   infrastructure timeout, so a red test becomes invisible.*

---

## The review round — 2026-08-23, and what is left

Six read-only Codex lanes (`gpt-5.6-sol`, xhigh) were run against the work above: the built-in
`codex exec review` over the whole session's diff, plus adversarial-refutation, user-seat,
vacuous-test and security lenses. **They found more than the programme did**, including two defects
in the acceptance gate itself and one that made a shipped feature unusable.

**Three lanes independently found the same hole**: a comment satisfies the reachability ratchet.
That corroboration is the strongest signal in the round — it is not one model being clever.

### CLOSED IN THIS ROUND

| | what a user could not do | commit |
| --- | --- | --- |
| ✅ | **Find the help page by typing `help`.** `filterCommands` matched the LABEL, and the label is "What can I do here?" — no `l`, no `p`. The one surface built to solve discovery was undiscoverable by the word everybody types | `00bbab60` |
| ✅ | **Open the whiteboard from the palette.** Every other surface is in it; this one was reachable only by finding a tab | `00bbab60` |
| ✅ | **Read Settings without being contradicted.** It said "a key is only needed to ask questions" to a person who had just had their question refused and been sent there | `00bbab60` |
| ✅ | **Know what to do about "no models loaded"** — the one state on that screen fixable in thirty seconds | `00bbab60` |
| ✅ | **SAVE A LOCAL MODEL AT ALL.** `validateAiConfig` rejected any config without a non-empty `apiKey`, so every attempt returned HTTP 400. The feature shipped, advertised itself, and could not complete. Absence is now the keyless representation — never a placeholder, which would write a lie into the user's config — and **loopback only**, narrowed from the existing `isLoopbackOrPrivateHost` because a private-LAN address is still another machine | `5bb51fe4` |
| ✅ | **Trust what `propose_topology` promised.** The directive said "add, remove, rename, or rewire"; the payload has no operation field and Accept dispatches only adds. A rename got a proposal bar, an Accept, and nothing. Narrowed to ADDITIONS ONLY, with the model told to state the limitation rather than pretend. Dangling edges now refused IN CODE, and edge labels survive Accept | `5bb51fe4` |

### IN FLIGHT — three lanes, disjoint file ownership

| | lane | owns |
| --- | --- | --- |
| 🔨 | **L1 — the gate.** A comment defeats it; the floors permit partial scanner death; `topology:proposal` is unmonitored because the regexes require a slash; `reaches` uses raw `startsWith`, so `/api/program/runs` masks `/api/program/run` and `/api/ask/stream` masks `/api/ask` | `tools/ci/reachability*` |
| 🔨 | **L2 — analyzer.** The localhost probe follows redirects off localhost; `/api/ai-config` discloses the machine's AI inventory to any authenticated caller when nothing is attached, and redacts short keys badly; search says "20 matches" when it truncated at 20 | `analyzer/src/server/*` |
| 🔨 | **L3 — web2 surfaces.** Backspace deletes the note you are editing; a drag that leaves the canvas never ends; Fit ignores text extents; search renders `<untrusted_repo_content>` scaffolding to the user; Help claims every node traces to file:line, which stops being true the moment a proposal is accepted. **Plus the three tests I wrote today that grep source instead of mounting** | `web2/whiteboard`, `search`, `help` |

### NEXT — queued behind the wave above

| | | why it waits |
| --- | --- | --- |
| ✅ | **Run authoring resolves the sole agent.** `resolveProgramAgent` falls back to the only configured agent when ref is `default` (`repoServer.ts`; locked `program-server-runs.test.ts`). | |
| ✅ | **A started run can be Cancelled.** Activity exposes Cancel → `POST /api/program/runs/:id/cancel` (locked `runStart.test.tsx`). Pause remains step-boundary; Cancel is the stop door. | |
| ⬜ | **The other CI gates.** `firewall`: an import resolving exactly to `packages/web` escapes a `startsWith` with an appended separator, and the numeric `fontSize` rule matches only quoted `px`. `launcher-deps`: an unescaped `.` lets `pnpm-lockXyaml` match. `graphite-freeze`: renaming a sheet OUT of the book removes it from the checked set. `repo-server-citations`: `includes` proves "served" for a commented-out handler | needs `tools/ci/`, which L1 holds |
| ⬜ | **Two suites that skip on a clean checkout.** `App.test.tsx` and `railGrounded.test.ts` need the gitignored `.sequence` cache, so on CI they register a skip and cannot turn red for the path they claim to exercise | |
| ⬜ | **A ghost can wear a real node's evidence.** Propose a node whose id equals a scanned one: the merge drops the duplicate but `ghostNodeIds` still marks the grounded node, so a dashed "proposal" card also says Traced | |

### 🔒 THE TWO CRITICALS — owner's call, not an agent's

Both are **pre-existing**, both are architectural, and neither should be reshaped unattended.

1. **A cloned repository can run code on your machine.** `AGENTS.md` is presented to the model as
   binding instructions; the default belt permits `run_command`; the allowlist checks the literal
   `pnpm test`. So a repo whose `package.json` `test` script is hostile executes as you, the first
   time you attach it and ask anything.

2. **DNS rebinding replaces the AI provider and exfiltrates the repository.** A page on
   `http://x.attacker:4173` rebound to `127.0.0.1` can `PUT /api/ai-config` then `POST /api/ask`.
   Local mode performs no session check and those routes never call `isOriginAllowed`; the browser
   considers the rebound requests same-origin.

   The same rebinding reads `/api/search` results.

Closing these properly means a per-launch capability token plus Host and origin validation on every
`/api` route, and gating repository-provided instructions and config behind explicit trust. That is
a design decision with regression surface across the whole server.

**Related and cheaper**: a symlinked `AGENTS.md` pointing at `/proc/self/environ` is read with plain
`readFileSync` and never goes through the realpath jail — 24,000 characters of process environment
inserted as trusted instructions. That one is worth doing on its own, whatever is decided above.

### What held under attack

Recorded because a refuter that refutes nothing has not been shown to work:

- `evidenceRef` injection — refused server-side, and structurally impossible in the store, which
  rebuilds each node from three fields
- Search origin escape — `//host/…` and `/\host/…` stay encoded; the glob cannot leave the jail
- The probe hang — the deadline race holds even against a transport that ignores the abort
- Topology labels and ids reach no filesystem, URL, shell or raw-HTML sink
- Hosted anonymous access — `/api/search`, `/api/ai-config` and all of `/api/program/*` are
  sensitive when auth is on
- A cross-origin page cannot start an ACP run; the surviving caller is an originless local process

---

## Log

| date | what | gate |
| --- | --- | --- |
| 2026-08-23 | Phase 0 lane 1 — the reachability tripwire, 10 orphans baselined with reasons, mutation-proven both directions | hygiene 77/77 |
| 2026-08-23 | Phases 1-6 executed. Baseline 10 dead actions -> 6; routes 21 GAP -> 20. | see below |

## Testing without Codex — the mutation harness, 2026-08-24

Codex credits ran out mid-programme. Six review lanes had been finding the same defect class by
reading: **a test that passes for the wrong reason.** That method is expensive, needs a vendor, and
does not stay found. This replaces it with something mechanical.

`tools/ci/mutate.mjs` + `tools/ci/mutants.json` break the product on purpose, once per entry, and
run the suite that claims to cover the broken thing. A suite that stays green while the product is
broken is a hole, reported as a fact rather than an opinion.

Three honesty rules are built in, each from a mistake this repository actually made:

- **Every suite runs clean first.** A red suite kills every mutant for free and would report
  perfect coverage while proving nothing. Its mutants are INCONCLUSIVE, never kills.
- **A mutation that does not apply is an ERROR, not a skip.** `tools/ci/mutants.test.mjs` proves in
  ~90ms that every `find` string still names exactly one site, so a catalogue cannot rot into
  decoration. That check is the CI gate; the sweep itself is a command.
- **A survivor is a question, not a verdict.** Reproduce it by hand before filing it.

### What the first sweep found

| Survivor | Verdict |
|---|---|
| `/archgraph.json` dropped from the origin gate | **REAL.** The oldest door in the server, the only engine route outside `/api`, serving the whole private topology — and no test held it. Locked by `dns-rebinding.test.ts`, "cannot read the architecture graph from /archgraph.json". |
| the reachability lexer stops stripping comments | **REAL.** The lexer that closed the `// type: 'canvas/zoom-at'` attack had no test of its own. The gate guarding reachability was itself unguarded. Locked by seven tests covering all three lexer states. |
| keyless provider config accepts any host (×2) | **NOT REAL — my error.** Both mutated an initializer the next lines overwrite, so the product behaved identically. Equivalent mutants. Retargeted at the assignment; both now die. |
| the lexer stops blanking comment text | **NOT REAL — and it taught something.** Blanking is redundant: the `code` array, not the blanked text, excludes the match. Two belts, one load-bearing. The mutants now name the load-bearing one. |

Two real holes, both closed and locked, and two false positives caught by re-deriving them by hand
rather than trusting the harness — the same rule that applies to any agent's claim.

### Standing use

```
node tools/ci/mutants.test.mjs   # the gate: does the catalogue still apply?  ~90ms
node tools/ci/mutate.mjs         # the sweep: does anything notice?           minutes
node tools/ci/mutate.mjs --suite <name> | --only <id> | --dry | --list
```

**When a defect is fixed, add the mutant that re-creates it.** That is how a fix stops being a
one-time event. The catalogue is the register's mechanical half, the way the reachability baseline
is the gap list's.

## Testing without Codex — lane 2: driving the app, 2026-08-24

Screenshots were unavailable (the browser pane composites nothing when it is not
displayed — the repo's own trap list names this), so the whole lane ran on the accessibility
tree, `elementFromPoint`, computed styles and the network log. That turned out to be the stronger
instrument: every finding below is a measurement, not a look.

**1. `findWebDist` only ever worked from the monorepo root.** Its package-relative branch called
`require.resolve('@sequence/analyzer/package.json')`, which throws `MODULE_NOT_FOUND` — a package
cannot self-reference without an `exports` field, and this one has none. So the branch was dead and
the `process.cwd()` fallback did all the work. `sequence` is a CLI: its documented use is
`cd ~/my-project && sequence --repo .`, where cwd belongs to the user. Every such run served
`{"error":"web viewer not built (pass --web <dist-dir>)"}` instead of the app. Both copies now
anchor on `import.meta.url` and walk to the sibling `web2/dist`, a shape that holds in the monorepo
(`packages/analyzer` → `packages/web2`) and in an install
(`node_modules/@sequence/analyzer` → `node_modules/@sequence/web2`).

**2. Neither test covering that resolver could fail.** One greps the source for `'..', 'web2',
'dist'`; the other reads `if (resolved === undefined) return;` — passing silently in exactly the
case where the resolver is broken. The new lock runs the resolver in a CHILD PROCESS with a foreign
cwd, and an absent build is now a loud failure naming `pnpm -r build` rather than a quiet pass. I
wrote that same early-return into my own replacement first and had to take it back out; the pattern
is genuinely easy to reach for.

**3. The board's kind legend covered the chat composer and ate the click on Send.**
`.boardfurniture` is `inset: 0`, `z-index: 7`, `pointer-events: none` with `> * { pointer-events:
auto }`; an overlay chat pane is `z-index: 2` and, by design, floats over the canvas without
shrinking it. So below `MEDIUM_MIN` (820) the legend is drawn straight across the composer. Measured
at 800px in a real browser: `elementFromPoint` on the composer field answered `SPAN.k`, a legend
chip. The primary surface of the product could not be typed into. The overlay pane is now
`z-index: 45` — above the canvas's tallest layer (`.boardmenu`, 40) and still under the shell's
command surface, which the new suite proves by opening the palette over the raised pane.

`e2e/composer-reachable.mjs` asks precisely the right question and answers it with the board
switched off: its route table refuses `/archgraph.json`, under the note "the repository this runs
against is irrelevant — only the composer is". Removing the graph removes the only thing that can do
the covering. `e2e/composer-over-board.mjs` runs the same probe with a REAL scan behind it, because
the legend's width is a function of how many kinds the graph has and a two-kind fixture draws one
too narrow to reach the composer.

**4. The analyzer suite read the developer's own `~/.sequence`.** Using the app to point Sequence at
a local Ollama wrote `~/.sequence/ai.json` — the product working correctly — and three tests
asserting "no provider configured" then found one and turned red, each after a 25-second wait for a
provider they never expected to exist. The suite's result was a function of whether the developer
had ever used the product. `userStoreDir()` now honours an absolute `SEQUENCE_USER_DIR`;
`src/test/isolate-user-store.ts` is `--import`ed ahead of every test file and points it at a fresh
temp directory. `user-store-isolation.test.ts` proves both directions on any machine — an empty
store reads as unconfigured, a populated one is still found — so a "fix" that deleted the
user-level fallback could not pass as a cleanup.

### What was NOT a defect, checked and dropped

At 1440px the shell reported `data-breakpoint="narrow"` with `innerWidth: 1440`, which looked like a
shell that never recomputes on resize. It recomputes from a `requestAnimationFrame`, and a hidden
pane produces no frames. An artifact of the instrument, not the product — and the reason the real
defect had to be reproduced at a width where the overlay is legitimate before being believed.

## Lane 2 continued — the drawing-to-AI feature had no real-browser test

Moat point 4 is "draw ↔ chat sync". `src/whiteboard/whiteboardAsk.ts` is the whiteboard half of it,
and it had unit tests and **nothing that proved a person can draw and hand the drawing over**. jsdom
cannot answer that question: it has no layout, so a pointer drag across a canvas is not something it
can perform, and a green pure function says only that the function is green.

`e2e/whiteboard-to-ask.mjs` drives it with a real mouse, one check per claim the feature makes:

- an empty board offers nothing to send — Ask, Undo and Clear all disabled;
- **a drawn shape is still not a brief** — Undo and Clear turn on, Ask STAYS off. This is the check
  a naive test skips, because on the surface nothing happened;
- words are what make it askable;
- the request lands in the composer carrying the reader's sentence verbatim AND FIRST, the
  "not from the scan — nothing on it is evidence" line, and a count of the marks it cannot read;
- **nothing went on the wire** — read from the request log, not from the absence of a visible
  answer. This origin serves no engine, so "no answer on screen" would be evidence of nothing.

That last one is the owner's constraint on the board's Generate gate ("Drawing a box must NOT fire a
code proposal") enforced on the second surface that could violate it.

**Proven able to fail**, which is the only thing that separates this from the tests it replaces:
mutating `askableFrom` to accept any mark turned exactly one check red and left the other four
green; restoring turned it back. Three cheap mutants now hold the same contract against the unit
suite — send an unlabelled board, drop the not-evidence line, hide what it cannot read.

### The chat loop, end to end, on a weak model

With the composer unblocked, one real turn against local `granite4-hermes` (4B) on this monorepo:
the answer named `packages/analyzer` correctly, the footer said "answered from 300 of 1,743 edges —
every component contributed", and the trail showed six `Read a file` steps each marked MEASURED
against real paths. The grounding is doing the work the model cannot — which is the whole claim.
