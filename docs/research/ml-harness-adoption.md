# THE ADOPTION LIST — ml-harness → Sequence v2

**Scope.** Five read-only lanes studied `C:/Users/<user>/OneDrive/Documents/GitHub/ml-harness` (**MLH**) against `<repo>` (**SEQ**). Nothing was edited. Every claim is anchored to a file:line one of us opened. Neither app was run except where a measurement is explicitly marked as taken.

**Each numbered section below is self-contained.** Hand section 5 to a scaffolding agent, section 6 to an engine agent, section 2 to a porting agent — none needs the others.

---

# 1. WHAT ML-HARNESS DOES BETTER

Ranked by what it buys the rebuild, not by how impressive it is.

### 1. The transcript is a fold over a durable, id-numbered server-side event log

**Mechanism.** Every event is committed to the DB before it is yielded to the stream (`MLH/app/events.py:12-30`; `MLH/app/conductor.py:9-18`). The autoincrement row id *is* the SSE event id. `POST /threads/N/turn` and `GET /api/events` are separate routes (`MLH/app/main.py:815-841`): the POST returns row ids **after** the turn is over, and the reply arrives entirely on the stream. The client stores events in a `Map` keyed by id (`MLH/frontend/src/lib/useChat.ts:75-77, 101-108`) and renders `foldEvents(events) → TranscriptItem[]` (`MLH/frontend/src/lib/transcript.ts:243`).

**What it buys.** A dropped connection, a closed laptop, a page reload, or a second machine all cost nothing — reopening replays from `since=0` and reconstructs the turn character-for-character, because the engine writes the assistant message as `"".join(text_parts)`, the exact concatenation of deltas it already committed (`transcript.ts:1-21`). Replay is idempotent **by construction, not by timing**. And there is no second source of truth to disagree with the log, which is why this app has no store at all.

**SEQ today:** `askBoardStream` (`packages/web/src/ai/aiClient.ts:950-1013`) is a one-shot POST-SSE reader; the answer arrives in the terminal `result` frame (`:973-978`); `writeSseEvent` emits `data:` only, **no `id:` line** (`packages/analyzer/src/server/repoServer.ts:525-527` — verified). A blip loses the turn and throws `'ask stream ended without a result'` (`aiClient.ts:1012`).

### 2. Real tool calling: JSON Schema on the wire, provider-native frames back

**Mechanism.** One decorator declares a tool's model face (`name`, `description`, JSON Schema) and its control face (`label`, `group`, `verb`, `order`) from one source (`MLH/app/tools/registry.py:196-205`, `:209-279`, `:297-332`). Schemas are assembled and sent (`conductor.py:324`). Tool-call frames are reassembled by an index-keyed accumulator (`app/providers/openai_compatible.py:264-279`) and results return as real `{"role":"tool", tool_call_id, name, content}` messages (`conductor.py:604-611`). The doctrine is written down: *"We never emulate tool calling by parsing JSON out of prose. That fails silently and in the direction that hurts"* (`conductor.py:53-56`).

**What it buys.** The provider can constrain generation and enumerate parameters, so an argument error is a rejected token rather than a wasted round. A malformed call is **reported, never guessed** — three distinct error deltas at `openai_compatible.py:288-311`.

**SEQ today:** grep for `tools`/`tool_choice`/`tool_calls` in `packages/analyzer/src/server/provider.ts` returns **zero hits**; the request body is `{model, messages:[{role:'user',content:prompt}]}` (`provider.ts:758-761`, verified). Tool requests are recovered with `/```sequence-tool\s*\n([\s\S]*?)\n```/g` (`askTools.ts:717`) and malformed blocks are dropped by `catch { /* malformed block — drop it */ }` (`askTools.ts:745-747`) — the model is never told its call failed. `AskPipelineInput.callProvider.toolRequests` exists but is exercised only by tests; the capability *is* understood in the repo (`llm/label.ts:212` sends a real Anthropic `tools:` array), it is simply unused by the ask loop.

### 3. A turn always ends in words — a single exit funnel with named endings

**Mechanism.** Seven named endings (`answered`, `empty_reply`, `repeat_loop`, `round_cap`, `answered_after_*`, `provider_failed`, `harness_failed`), all converging on one check (`conductor.py:331`, `:426-449`). On `round_cap`/`repeat_loop` a **forced-answer round** runs with `offered=None` — a model with no tools cannot loop — and `FINAL_ROUND_NUDGE` is appended to `conversation` only, never to stored `messages`, because *"A harness sentence stored as a user message would be read back as something the user said, in every turn after this one, forever"* (`conductor.py:144-156`, `:385-398`). If it still says nothing, one of six purpose-written sentences is streamed as `chat.delta` tagged `written_by:"harness"` (`SILENT_TURN`, `:170-205`). The docstring cites the real incident: events 4104-4111, four tool calls, zero words, `stream.end` at 5.296 s (`:58-80`).

**What it buys.** The product is never silent, and every exit is diagnosable from the log without shipping the user a code.

**SEQ today — this is a live bug, verified.** `askPipeline.ts:307-312`: fenced blocks are stripped from `text`, then `if (toolRequests.length === 0 || atCap) break;`. If round 4's output was tool blocks only, `text === ''` and the user gets an empty answer with no explanation. `MAX_ASK_TOOL_ROUNDS = 3` (`askTools.ts:79`, verified) against MLH's 8, on the same class of models. There is no empty-answer guard anywhere in `askPipeline.ts` or `sendAsk.ts`. The existing test (`test/ask-tool-loop.test.ts:369-394`) misses it because its 4th canned reply carries `text:'more'`.

### 4. The prompt is a directory of reviewable fragments with a content-hash version and a build-breaking law test

**Mechanism.** 17 core `.md` laws + 5 conditional fragments assembled by a 200-line composer (`MLH/app/instructions/__init__.py:148-187`). `version()` (`:131-146`) SHA-256s every fragment's name+bytes — core *and* conditional — to 12 hex chars, emitted into the prompt and stamped on `turn.started` (`conductor.py:309`). `NON_NEGOTIABLE` (`__init__.py:73-103`) is 23 `(name, phrase)` pairs; `contains()` (`:105`) compares with whitespace collapsed, and `tests/test_instruction_set.py:21-52` asserts all 23 survive **all 12 combinations** of `tool_calling × portal × sensitive`.

**Measured** (by running `instructions.assemble()`): 20,165 chars ≈ 5,041 tokens with tools + consumer portal; 19,016 chars without tools; current digest `4b3642660f10`. Sent as `role:"system"` (`conductor.py:315`), so it is a cache-stable prefix.

**What it buys.** Erosion is visible in review — the failure the docstring names is *"an edit that tightens the prose, drops a clause that read as repetition, and leaves a prompt that still scans well."* And a bad answer six months later is attributable to an exact prompt.

**SEQ today:** 14 string literals inside `explain/explain.ts` (105 KB), `.push()`ed in fixed order. `ASK_DESIGN_BREAKDOWN_SEQD_DIRECTIVE` (`explain.ts:1454`) is a single **2,600-character literal carrying at least fourteen distinct rules**. No version, no manifest. Four honesty-lock assertions exist (`test/explain.test.ts:624, :729, :759, :787`) but nothing tests law survival across the ≥6 conditional gates — and `ASK_FIGURE_IT_OUT_CLAUSE` explicitly says *"This overrides PREPARE BEFORE YOU PROPOSE for this turn"*, which is exactly the case MLH's combination test exists to catch.

### 5. Refusals that name the door

**Mechanism.** Unknown tool → `nearest()` returns the closest 3 by shared informative words **plus every tool in the registry**, plus "Nothing was run" (`registry.py:362-385`, `:592-608`). Missing required arg → checked against the schema's `required` **before the handler runs**, returning `{ok:false, error:"missing_arguments", missing:[…], accepts:[…]}` where `accepts` is one line per parameter with type, required flag, enum and description (`registry.py:444-479`, `_argument_help` `:567-589`). Unknown args are dropped and reported as `ignored_arguments`; reserved args (`origin`, `measured`, `actor`, `gate`) are reported *separately* as `refused_arguments` (`:534-557`, list at `:101-122`). Invented fact names get `did_you_mean` scored 3×/2×/2×, and when nothing matches it returns every fact the gates actually read (`tools/evidence.py:2595-2643`).

**What it buys.** With a 3-round budget, a refusal that names nothing costs a whole third of the turn. `askTools.ts:206` returns `refused: unknown tool "${name}"` — full stop.

### 6. Capability probe + a designed degraded mode

**Mechanism.** `probe()` (`conductor.py:256-268`) makes one real call offering a trivial `report_ok` tool; Ollama reads `/api/show` capabilities without spending a turn (`app/providers/ollama.py:96-125`). Result is stored tri-state: `tool_calling: True|False|None`, where `None` means *not probed* — a different fact from "probed, and no" (`app/providers/__init__.py:53-79`), with `provenance: measured|inferred|defaulted` displayed in the UI (`frontend/src/components/Settings.tsx:246-252`). `assemble(None)` is byte-identical to `assemble(True)`, locked by a test, because telling a user their model can't call tools *because nobody asked* is inventing a measurement (`instructions/__init__.py:148-163`; `tests/test_instruction_set.py:117-126`). When the answer is `no`, the harness runs a fixed script itself and hands results over as data (`UNASSISTED_SCRIPT`, `conductor.py:210`; `_unassisted_preamble` `:677-722`) and says so in a strip above the composer (`Composer.tsx:552-565`).

**What it buys.** The UI can say "this model can't call tools" **before the first turn** instead of failing silently on turn three.

### 7. Within-turn memoisation + repeat-loop exit

**Mechanism.** `_memo_key = (name, json.dumps(args, sort_keys=True))` (`conductor.py:504-509`). A repeat is **not re-run**; the first result returns with `REPEAT_NOTICE` prepended and the event log records `repeat_of` + `rerun:false` (`:159-164`, `:528-565`). A round where *every* call is a memo hit ends the tool phase — it produced no new fact by definition (`:371-381`). The comment on why this is code and not prose: *"this project has twice learned that a rule living only in the prompt is a rule a model is free to ignore"* (`conductor.py:93-94`).

### 8. Registration-time walls, and actor as a property of the door

**Mechanism.** A tool declaring `writes=("gate",…)`, or accepting an argument named `origin`/`measured`/`actor`/`verdict`, **fails to import** (`registry.py:625-718`). `Registry.call(actor=…)` is set by the call site, never by the payload — `model` from the conductor (`conductor.py:576`), hard-coded `user` on the HTTP control route (`main.py:1112`), `harness` for the unassisted script (`conductor.py:704`). Handler args are re-wrapped as `CallerInt`/`CallerFloat`/`CallerStr` whose every operation returns a marked result, so a model-supplied number cannot be laundered into a "measured" fact through arithmetic or a JSON round-trip (`registry.py:494-517`).

**What it buys.** A malformed tool cannot ship; a model cannot forge provenance. Sequence has no notion of either. (**UNVERIFIED**: I read the taint mechanism from `registry.py:481-533` and the module docstring, not from `evidence.py`'s 2,707 lines.)

### 9. Every tool is also a button, generated from the same declaration

**Mechanism.** `GET /api/tools` (`main.py:1043-1054`) serves the same schemas the model gets; `POST /api/tools/{name}` runs one with `actor="user"` (`:1057-1160`) and returns **HTTP 428** when approval is required (`:1117-1118`); `Controls.tsx:1-26` generates the form fields from that schema. A new Python tool is a new button with no frontend change. And it is honest about the seam: a control run writes nothing to the event log, so its result is shown *next to its button, saying so*, rather than dropped into the chat column *"where it would look like something the thread remembers"* (`Controls.tsx:15-21`).

### 10. A frontend with 2 runtime deps, no store, and 47 files

| | MLH `frontend/` | SEQ `packages/web/` |
|---|---|---|
| runtime deps | **2** (`react`, `react-dom`) — `package.json:12-15` | **16** — `package.json:45-61` |
| non-test TS/TSX | **47 files / 18,467 lines** | **377 files / 75,388 lines** |
| CSS | 8 files / **208,860 B**; largest `shell.css` 65,533 B | 15 files / **926,015 B**; `styles.css` 318,594 B, `product.css` 257,852 B |
| built bundle | **402 KB JS + 99 KB CSS** | **3.4 MB dist**, incl. a 1,438,603 B `elk.bundled` chunk |
| global store | **none** — grep for `createContext\|useContext\|zustand` in `frontend/src` returns **0 hits** | `state/store.ts` 2,387 lines + `product/state/productStore.ts` 53,953 B |

**Mechanism, and it is the single most transferable idea in the repo:** `lib/engine/client.ts:3-7` — the frontend *"never contains a business rule."* Because no component may compute, every component is a renderer; a renderer's inputs are props; props need no store. Three layers, one direction: `engine/` (zero React imports) → `use*` hooks → `components/` (zero `fetch` calls). Derived values are `useMemo` folds, not state (`App.tsx:87`, `:92`).

**What SEQ's two stores cost, concretely:** `ProductApp.tsx:41-43` must write the hydrated graph into the *legacy* store as well, commented *"The MADR breakout still reads its ArchGraph off the legacy store."* That is two answers to "what is the graph" — the disagreement a fold-from-one-log design makes structurally impossible.

### 11. Vertical rhythm as a ladder, and a bottom-anchored column

**Mechanism.** `shell.css:711-732` — six gap rules, not one: `--sp-8` default, `--sp-4` for stacked narration, `--sp-12` before prose, `--sp-24` for a new user turn and around cards. The measurement is recorded (`:692-710`): every gap used to be 16px, so *"a user message starting a brand-new turn stood exactly as far from the previous reply as a tool row stood from the message that caused it. Nothing grouped."* Note the direction — within-turn gaps went **down** from 16 to 8. A flex `gap` cannot express this; SEQ uses one `gap: var(--s3)` (`product.css:1352-1362`).

Bottom-anchoring is `margin: auto auto 0` on `.column` (`shell.css:687`) and deliberately **not** `justify-content: flex-end`, *"because an auto margin resolves to zero when there is no free space, whereas flex-end on an overflowing scroll container pushes the first rows past the scrollable origin where they cannot be reached."* `width:100%` at `:681` is load-bearing — auto cross-axis margins cancel `align-items: stretch`. The empty state is the deliberate exception, centred not anchored (`:1178-1189`): *"it is a screen, not a message."*

### 12. Small composer/transcript details that are each one bug prevented

- **`isComposing` guard on Enter** (`Composer.tsx:182-192`). Without it, a CJK user pressing Enter to accept an IME candidate sends a half-composed message. `SEQ/ProductComposer.tsx:252-255` has no such check — **confirmed bug**.
- **Focus ring on the composer container, not the inset textarea** (`shell.css:1092-1103`), because a ring on a box inset 10px inside another rounded rectangle *"read as a rendering defect rather than as focus."* SEQ removes the textarea outline (`product.css:2915-2917`) and rings only the buttons — keyboard focus on the input is **invisible**.
- **Disabled send is a substituted surface**, `--surface-3` + `--ink-4`, never a dimmed accent (`shell.css:835-837`): *"'unavailable' reads as absence, not as a state with an opinion."* SEQ uses `opacity: 0.45` (`product.css:2851-2856`).
- **Scroll-follow with a 48px tail threshold that yields to the reader** (`App.tsx:223-232`, `:374-382`). SEQ has **no autoscroll at all** — grep across `packages/web/src/product/` for `scrollTop`/`scrollIntoView` returns zero. Highest user-visible-improvement-per-line in this whole document.
- **Pending tool calls keyed `${callId}\0${name}`, not by id** (`transcript.ts:252-254`, `:361-378`), because Ollama numbers calls `call_0`, `call_1` **per turn**, so a plain id map attaches turn 4's result to turn 1's call.
- **Unrecognised events render as a named row, never vanish** (`transcript.ts:196-203`); silencing requires an argued entry in a 5-item `SILENT` set (`:217-241`). The comment records the defect found by looking: `thread.created` fires for every thread, so the first row of every conversation in the product used to read *"The engine sent a thread.created event, which this surface has no row for yet."*
- **Counts come from the engine, never derived from frame arrivals** (`transcript.ts:163-167`): *"A progress bar that counts its own events would read 100% the moment the stream hiccuped."* `evals.py` emits one `eval.progress` per `PROGRESS_STRIDE = 25` rows, so a 200-row sample is nine frames, not two hundred.
- **The `declined` third tool-row state** — grey `eye` glyph, keyed off the refusal *reader* so it is exactly as narrow as the refusals this surface has a card for (`Transcript.tsx:237-256`, `:525-531`). It exists because `compare()` refusing to subtract two scores measured on disjoint rows rendered as a red "failed" above a grey COMPARISON DECLINED card — *"the product working, drawn as the product breaking."*
- **`strictPort: true` on a pinned dev port 5199** (`vite.config.ts:114-115`). Vite's default silently moves to the next free port, so a stale process on 5173 served a *different* app and its screenshot was reported as evidence. **This is a verification-integrity fix, not a preference.**

---

## WHERE THE OWNER'S CLAIM DID NOT HOLD UP

He said *"Everything there is already better."* Four of his five specifics hold; the fifth is mixed; and there are eleven named places where SEQ is ahead. He needs these more than agreement.

**"Better prompting" — holds on architecture, fails on budgeting.** MLH has **no token budgeting anywhere.** `app/events.py:246-258` `messages_for()` returns every message in the thread and `conductor.py:316-318` appends all of them; nothing counts tokens or trims. A long thread will 400 on context length. Its caps (`DEFAULT_READ_CHARACTERS = 40_000`, `DEFAULT_ROW_CAP = 200_000`) are per-source only — nothing bounds the assembled whole. SEQ's `llm/tokenBudget.ts` is a real shared primitive (`CHARS_PER_TOKEN = 4`, `cutToBudget` at line granularity, tail-first, **reserving room for the marker so the result including the marker fits**), and every cut appends `"…N more X omitted to fit the model budget"`. `fitDigestToBudget` (`explain.ts:1306`) cuts to 48,000 tokens in three ranked passes and returns the input untouched when it fits. **Do not import MLH's prompting without SEQ's budgeting.**

**"It's text better locally" — true as "it has a local-model product", not as "it generates better."** MLH ships four keyless loopback presets (`providers/__init__.py:147-190`), a native Ollama adapter with a stated mechanism (`ollama.py:1-21`), measured hardware (`hwdetect.py:105-184`, real `nvidia-smi` + `kernel32`), and real KV-cache arithmetic against real model geometry (`feasibility.py:401-412`, `Q4_K_M = 4.91 bits` not 4.0 — the old constant understated by ~21% *"in the direction that tells a user something fits when it will OOM"*). But: **`ctx_len` is measured and then never used.** It appears only in `providers/__init__.py`, `ollama.py`, `store.py`, `Settings.tsx`; nothing budgets against it, and `ollama.py:70-77` never sets `options.num_ctx`. Its own ~5,000-token system prompt against a 4096-token default Ollama window is over budget before the conversation starts. That is MLH's single largest unclosed local risk and Sequence must not inherit it.

**"That chat box works better" — holds on the architecture, fails on ten features SEQ already has.** MLH has **no `@` and no `/` bound at all** (its placeholder is static *because* of this, and it says so at `Composer.tsx:45-49`: *"a placeholder that names an affordance the product does not have is the same defect as an invented number"*). It renders **no context chips**. It **does not restore the last thread** — `threadId` starts `null` (`useChat.ts:66`) and reload lands you on an empty new thread. It has **no cancel route anywhere** — the send button swaps to a `stop` glyph while busy (`Composer.tsx:276`) but is `disabled` at that moment (`:272`), so the stop icon is decoration. It shows **no elapsed on running tool rows** (`useSecondTick.ts` exists and is used only by `Approval.tsx:111`), which its own book requires at page 21.3. It has **zero automated frontend tests** against SEQ's 362. And it has **no production path at all** — `app/main.py` never mounts `frontend/dist`, and `config.ts:65-74` returns `available:false` outside dev.

**Where SEQ is genuinely better, and each should survive the rebuild:**

1. **Sentinel neutralization, not just reporting.** `llm/untrusted.ts:88-91` inserts U+200B after the first character of `<|im_start|>`, `[/INST]`, `<tool_use>`, `ignore previous instructions`, **and Sequence's own section delimiters** — so a repo file cannot forge `--- QUESTION ---` and smuggle text back into the trusted region. Nothing is deleted or summarised. MLH only *reports* matches (`tools/context.py:126-149`) and relies on the model honouring `data_envelope` — **so a repo file containing `</data>` can close MLH's envelope early.** `neutralizeDeep` (`:108-119`) runs per JSON *value* before stringify, specifically so line-anchored rules still work. SEQ's defence is strictly stronger.
2. **A filesystem jail as one choke point.** `ctx.resolveReadable` is applied in `read_file` (`askTools.ts:243`), inside the `search_files` walk per file (`:305`), and in `propose_files` (`:418`), including for not-yet-existing paths. MLH's `read_context_file` calls `_resolved(path)` with **no containment check at all** — it will read any file on the machine. For a product that clones untrusted repos, SEQ's model is correct and MLH's is not.
3. **No ambient shell.** `run_command` requires `isSafeVerifyCommand` *and* `isVerifyCommandAllowlisted` against four exact constants (`verifyGate.ts:29-34`), then spawns `shell:false` with fixed argv (`askTools.ts:466-469`). The Windows `cmd.exe /d /s /c` fallback is argv-form and reached only on a *lookup* failure, never a non-zero exit, because *"retrying a non-zero exit would turn a red gate green"* (`verifyGate.ts:101-113`).
4. **A typed structured side-channel for UI.** `propose_files` returns a typed `proposal` emitted as an `edit:proposal` SSE event (`askPipeline.ts:337-343`), explicitly *"not by hoping to parse it out of the model text."* MLH's UI parses six different result shapes back out of JSON (`Controls.tsx:31-47`).
5. **The evidence ledger with a visible drop notice.** `selectCarriedEvidence` (`askTools.ts:806-842`): current round carried whole and never charged; earlier rounds newest-first within a cap **derived from an existing cap** (`2 × ASK_TOOL_SEARCH_TOTAL_CAP_BYTES = 48,000`, `askTools.ts:121` — verified, with the derivation written out); anything dropped is announced with a count. MLH's conversation grows unbounded and has this bug today.
6. **The loopback/private host check.** `isLoopbackOrPrivateHost` (`modelRoutes.ts:236-247`) covers `127/8`, `10/8`, `192.168/16`, `172.16-31/12`, `169.254/16`, `::1`. MLH's `LOCAL_HOSTS` (`providers/__init__.py:50`) is four exact strings plus `.local` — a model server on `192.168.1.50` is classified **remote** by MLH.
7. **A 20 MB response cap** (`provider.ts:328-334`, `:762`) so a hostile `baseUrl` cannot OOM the process. MLH reads its stream line-by-line with no total ceiling.
8. **Link safety in assistant markdown.** `chatMarkdown.tsx:22-34` `safeHref` strips control chars and whitespace first (so `java\tscript:` cannot slip past), rejects scheme-less and protocol-relative refs, allow-lists `http`/`https`/`mailto`: *"We drop the link, never the sentence."* MLH avoids the problem by having no links.
9. **Honest absence in the occupancy readout** (`ProductComposer.tsx:546-570`): when the context window is unknown the orb fill is **absent rather than zero**, *"a confident 'empty' is the same lie in a quieter voice."* That is MLH's own provenance philosophy, implemented in SEQ and not in MLH's own composer.
10. **The empty-shell refusal** (`ChatThinkingTrace.tsx:58-64`) — refuse to render an expander that opens onto nothing, recorded from an owner screenshot.
11. **ACP.** `packages/acp/src/client.ts:1-31` spawns Claude Code / Codex / Gemini over ACP on stdio with a real `session/cancel`, SIGTERM→SIGKILL on dispose, a read-only-by-default permission policy, and a refusal to fabricate completion — only a real `end_turn` counts. Server side contains the agent `cwd` to the repo root (`repoServer.ts:2413-2500`). MLH has no equivalent.
12. **The git-SHA build stamp** (`packages/web/vite.config.ts:11-29`, verified), added because the owner reported 22 landed changes as invisible and nobody could settle it from the screen. Keep this in the rebuild.

**And two things in MLH's own docs are stale — read the code, not the README.** `frontend/README.md:265-297` describes 4 style sheets and three densities; the shipped code has 8 sheets and **two** densities (`App.tsx:322-327`), verbose having been removed after the owner said "a little too much" (`Transcript.tsx:112-118`). Its gaps list claims the bubble and round-send changes are unmade; `chat.css:1-21` and `Composer.tsx:11-18` show both landed.

---

# 2. ADOPT WHOLESALE

Port or transcribe these. Effort is one focused agent-day units, assuming the engine changes in §6 land first where noted.

| # | What | Source to copy | Effort | Depends on |
|---|---|---|---|---|
| 1 | **The fetch-based SSE reader**, whole file | `MLH/frontend/src/lib/engine/events.ts` (~270 lines) | **1 day** | §6 gaps 1-3 |
| 2 | **`foldEvents` — the pure transcript fold** | `MLH/frontend/src/lib/transcript.ts:243-509` | **1.5 days** | §6 gap 2 |
| 3 | **`useChat`'s four-call loop** and the ref-held `onThreadCreated` | `MLH/frontend/src/lib/useChat.ts:1-155` | **0.5 day** | 1, 2 |
| 4 | **The typed fetch wrapper + three error classes** | `MLH/frontend/src/lib/engine/client.ts:33-93, 96-176` | **0.5 day** | — |
| 5 | **`tokens.css` three-state theming, verbatim structure** | `MLH/frontend/src/styles/tokens.css` (236 lines) | **1 day** | — |
| 6 | **The rhythm ladder + bottom-anchoring + focus ring** | `MLH/frontend/src/styles/shell.css:638-732, 1092-1103` | **0.5 day** | 5 |
| 7 | **Scroll-follow, 48px threshold** | `MLH/frontend/src/App.tsx:223-232, 374-382` | **1 hour** | — |
| 8 | **Enter/Shift+Enter with `isComposing`** | `MLH/frontend/src/components/Composer.tsx:182-192` | **15 min** | — |
| 9 | **Disabled send = substituted surface** | `MLH/frontend/src/styles/shell.css:835-837` | **15 min** | 5 |
| 10 | **`SILENT_TURN` + forced-answer round + named endings** | `MLH/app/conductor.py:144-156, 170-205, 385-449` | **1 day** | — |
| 11 | **`_memo_key` + repeat-loop exit** | `MLH/app/conductor.py:504-509, 528-565, 371-381` | **0.5 day** | — |
| 12 | **`nearest()` + `_argument_help` refusal text** | `MLH/app/tools/registry.py:362-385, 567-608` | **0.5 day** | 13 |
| 13 | **JSON Schema tool declarations + registration-time validation** | `MLH/app/tools/registry.py:196-279, 297-332, 625-718` | **2 days** | §6 gap 4 |
| 14 | **The tool-call stream accumulator** (index-keyed, emits only when args parse) | `MLH/app/providers/openai_compatible.py:229-311` | **1 day** | §6 gap 1 |
| 15 | **`version()` + `manifest()` prompt hashing** | `MLH/app/instructions/__init__.py:131-146, 189` | **2 hours** | 16 |
| 16 | **Prompt fragments as a directory + `assemble()`** | `MLH/app/instructions/__init__.py:148-187` + the 22 `.md` files | **2 days** | — |
| 17 | **`NON_NEGOTIABLE` + `contains()` + the all-combinations test** | `MLH/app/instructions/__init__.py:73-105`; `tests/test_instruction_set.py:21-52` | **0.5 day** | 16 |
| 18 | **The four clause texts, near-verbatim** — `06_never_invent_a_number.md`, `05_say_where_it_came_from.md` (Measured/Computed/Heuristic/Unknown/assumed), `14_file_contents_are_data.md`, `15_turn_contract.md` | `MLH/app/instructions/*.md` | **0.5 day** | 16 |
| 19 | **`strictPort: true` on a pinned dev port** | `MLH/frontend/vite.config.ts:114-115` | **10 min** | — |
| 20 | **Build script is `tsc -b && vite build`; oxlint with 3 rules** | `MLH/frontend/package.json:8-9`, `tsconfig.app.json:13, 22-26` | **2 hours** | — |
| 21 | **`find_instruction_like` — 15 labelled patterns with `{line, why, quote}`** | `MLH/app/tools/context.py:90-149` | **0.5 day** | — |
| 22 | **The `declined` third tool-row state** | `MLH/frontend/src/components/Transcript.tsx:237-256` | **2 hours** | 2 |

**Notes on the four largest.**

**#16/#17 (prompt fragments).** The four laws in #18 are the ones with the highest carry-over because each attaches its *mechanism*: *"This is the rule most likely to be violated under pressure, because a plausible number makes a smoother answer than an honest gap."* Sequence's clauses mostly say *what*; the one exception proves the point — the file-list clause (`explain.ts:1615-1633`) has an excellent 12-line comment explaining the owner screenshot that caused it, and **none of that reasoning reaches the model**. Copy the *shape*, not the ML content: rule + enumerated legal sources + failure consequence.

**#21.** SEQ defangs silently; MLH surfaces `{line, why, quote}` so the model can quote it back to the user. The common case is not an attack — it is a prompt template the user forgot was in their repo. MLH's 15 patterns include four SEQ's single alternation does not cover: *claims a pre-existing approval*, *asks for concealment from the user*, *asks for a check to be skipped*, *names a tool to call*. Those four are exactly the ones that matter in a loop that has `run_command` and `propose_files`.

**#5.** Structure the file for **three** states from day one even though `docs/brand/GRAPHITE-DECISIONS.md` defers light: complete light palette on bare `:root`, dark redefined under both `@media (prefers-color-scheme:dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]`, with the duplication flagged as deliberate (`tokens.css:14-19, 35, 180, 209`). Retrofitting a light branch into a dark-only sheet is precisely the specificity mess `SEQ/packages/web/src/main.tsx:34-60` currently documents in a 27-line comment. `"system"` must *remove* the attribute, not set a third value (`index.html:23`), or the third state is unreachable. Apply the stored choice in a `<script>` before first paint (`index.html:19-27`).

---

# 3. ADAPT

Right in principle, wrong in shape, because Sequence has an architecture graph and a canvas and MLH has neither.

### 3.1 "No diagram model — the nodes ARE the domain objects"

`MLH/frontend/src/components/BuildDiagram.tsx:6-19` draws the plan from `build.steps`/`build.edges`/`build.waves()` keyed by `Step.id` — *the same key the executor reports state under*: *"If a diagram is generated from the build, it can never lie about what is going to happen."* Layout is by wave, *"because the shape is the schedule"* (`:26-31`), and two edge styles distinguish two kinds of dependency by **form, not colour** (`:33-42`).

**Adapt:** take the grounding rule, not the implementation. MLH draws ≤20 nodes in fixed waves with hand-rolled SVG and zero libraries. Sequence draws real repo graphs with hundreds of nodes and needs pan/zoom, hit-testing, and a real layout engine. **Keep `@xyflow/react` + `elkjs`, confine them to `components/board/`, and enforce the rule that a board node's identity is the ArchGraph node id — no parallel diagram model, no second id space.** The 1,438,603 B `elk.bundled` chunk stays but must be dynamically imported so it is not in the entry chunk.

### 3.2 Every tool is also a button

MLH's schema-generated control panel (`registry.py:209-279` → `main.py:1043-1054` → `Controls.tsx`) is a modal grid because MLH has no `@` and no `/`. **Sequence has `@` bound and working** (`ProductComposer.tsx:180-199, 230-251, 505-539` — a real `role="listbox"` with `aria-selected`, `onMouseDown preventDefault` so the textarea does not blur before the click lands, caret restoration via `requestAnimationFrame`, and a "No grounded matches" empty state). **Adapt:** keep SEQ's `@` picker and chips; feed the *same* schema registry into `/` as a command palette rather than a modal grid; keep MLH's rule that **a control run is not a transcript row** (`Controls.tsx:15-21`).

### 3.3 The instruction set's conditional axes

MLH conditions on three axes: tool-calling, portal, sensitivity. Sequence's real axes are different and richer: `isWhiteboardFlavoredAsk`, `isFigureItOutAsk`, `researchMode`, `designMode`, `jobMode`, skill-match — and per-service language conditioning, `languageGuidanceLines` (`explain.ts:1512`), which composes reading instructions from each service's own `LanguageShare` so *"the model is never told how to read facts we never collected."* That is **more sophisticated conditioning than MLH's**. Keep it; put it behind `assemble()` and the `NON_NEGOTIABLE` test rather than behind `.push()`.

### 3.4 Heavy work collapses to one counted row

MLH collapses all `train.*` for a job to one row that **counts log lines rather than printing them** (`transcript.ts:104-112`, `:380-401`), all `storm.*` to one (`:114-144`), all `eval.*` to one (`:146-194`). Law quoted at `:97-101`: streaming raw logs into the chat column is *"the single fastest way to destroy the calm."* And the sharper reason at `:118-127`: the proposal card is already drawing those events, so *"printing the events beside the picture would be the transcript arguing with the diagram about what happened."*

**Adapt directly:** Sequence's equivalents are scan progress, ACP agent-message chunks, and verify-gate command output. Each collapses to one counted row that opens a pane. **The board is Sequence's "picture that already shows it"** — a graph rebuild event stream must not also be narrated in the transcript.

### 3.5 The prose/tool-row/turn-row lanes

MLH: user = grey bubble capped at **82%**, right-aligned, 14/21; assistant = plain prose, **no bubble, no border, no avatar, no role label**, full column, 15/23 (`chat.css:26-53`). The argument (Graphite page 20.2) is that bubbling costs measure, breaks diffs and tables, and adds a second alignment axis — but **all three costs land only on the assistant side**, so bubbling the short side avoids all three and keeps instant alternation. Second argument: a 2px accent role marker on every assistant message would *"put an accent object next to every paragraph, and the accent would immediately stop meaning anything except 'a message exists'."*

SEQ today does the opposite three ways at once: a numbered gutter (`01`, `02` — `ProductChat.tsx:1113-1120`, `formatNoteNumber:189-191`), an uppercase role label (`You`/`Sequence`, `:193-195`), and both lanes left-aligned full width. **Adapt:** adopt MLH's two lanes; keep SEQ's `ChatUsageFooter` (`ProductChat.tsx:197-214`) *alongside* MLH's turn row (`Transcript.tsx:401-429`, `Asked {model} · {locality} · can call tools · 3.4s`, seconds **measured** from `stream.end` and `null` until it arrives). SEQ records cost, MLH records instrument; both are right. *"A notebook that does not record which instrument took the reading is a diary."*

### 3.6 Errors as strips above the composer, never messages in the thread

Graphite page 20.4 makes it a law; `Composer.tsx:56-59, 160-166, 518-583` implements four strips, and **the composer stays fully usable underneath in all four**. SEQ violates it twice: `ProductChat.tsx:646-651` turns a failed ask into an **assistant message**, and `:528-536` builds an assistant message carrying a no-key notice. An error permanently in the artifact you hand to someone else.

**Adapt with one addition neither repo has:** page 19.3 state 7 draws a **Retry** button in the strip and MLH ships none; `dismissError` exists at `useChat.ts:179` and **is wired to nothing** (grep: the only consumer of `chat.error` is `App.tsx:419`). Build the strip with Retry and Dismiss from the start.

### 3.7 Verbatim-echo suppression

`Transcript.tsx:33-65, 761-866` builds a map of every sentence a card **renders** → the row that first stated it, and drops an assistant paragraph only if **every** sentence in it was already stated by a card **above** it. Four guards make it safe: matching is exact after whitespace/case normalisation and never paraphrase similarity; **nothing is dropped while the reply is still streaming**, because *"a paragraph that vanished and came back would be the worst reading experience in the product"*; the strings come from the same fields the cards render; and full suppression renders one 10-word line rather than silence.

**Adapt if and only if Sequence's cards restate model text.** Sequence's structured side-channel (`edit:proposal`, `command:log`) makes the collision less likely than MLH's data-envelope design. Build the cards first; measure whether the echo happens; port this only if it does. Do not port it speculatively — the four guards are what make it safe, and a half-ported version is worse than none.

### 3.8 The narrow-layout trigger

`App.tsx:174-184`: overlay triggers on **available chat width**, `viewport - railWidth - (inspector.open ? paneWidth : 0) < 420`, **not** on a viewport media query, because both side columns are resizable and *"a viewport media query fires at the wrong moment."* Sequence's board + rail + inspector shell has exactly the same property, so this transfers directly — but Sequence's board also has a minimum useful width of its own, which MLH's chat column does not, so the threshold is a different number and must be measured.

---

# 4. DO NOT TAKE

Strict list. The owner has explicitly deprioritised this domain; none of it may leak in.

**Domain — refuse outright:**
- Every ML tool: `start_training`, `training_status`, `list_recipes`, `run_eval`, `read_eval_results`, `measure_baseline`, `measure_eval_set`, `find_models`, `read_model_config`, `list_local_models`, `profile_dataset`, `check_split_leakage`, `preview_dataset_rows`, `try_prompt`, `read_prompt_bench`, `propose_build`, `run_diagnosis`, `inspect_hardware` (`MLH/app/tools/{training,evals,measure,models,data,prompts,propose,__init__}.py`).
- VRAM/KV-cache arithmetic (`app/feasibility.py` in full), quantization constants, GGUF header parsing (`tools/models.py:813-855`), `nvidia-smi` probing (`hwdetect.py:55-102`).
- The five-gate diagnosis engine, the fact ledger, LoRA/QLoRA/full-finetune method enums, `hold_out`, `prompt_champions`, McNemar/`RESOLUTION_ALPHA`, `CLEAN_SWEEP_ROWS`.
- Recipes, `runs/`, `storm.py`'s plan-replay domain (the **contract fingerprint** idea at `storm.py:307-330` is adoptable; the storm domain is not).
- The consumer/enterprise portal axis — MLH itself killed it (`docs/DESIGN_DIRECTIVES.md` §3: *"A toggle that changes almost nothing is worse than no toggle"*). Do not re-import it as a conditional prompt axis.
- The **ml-harness** Graphite pages `23-the-do-not-train-card.html`, `25-dataset-profile.html`, `26-run-rows.html`, `27-metric-charts.html`, `34-a-training-run-in-progress.html`, `36-38` (enterprise/residency/from-scratch) — these live in the MLH repo, **not** in Sequence's twelve-sheet book. The *layout grammar* on those pages is fine; the card content is ML and must not be transcribed.

**Anti-patterns — do not inherit even though they are in MLH:**
1. **No prompt/conversation token budgeting.** `events.py:246-258` + `conductor.py:316-318`. Keep `llm/tokenBudget.ts`.
2. **`ctx_len` measured and not enforced.** `ollama.py:70-77` never sets `options.num_ctx`. Sequence must budget against the measured window (§6 gap 9).
3. **No filesystem containment on file reads.** `read_context_file` (`tools/context.py:781`) has no jail. Keep `ctx.resolveReadable` (`askTools.ts:243, 305, 418`).
4. **Detect-and-report-only untrusted handling.** MLH's `data_envelope` can be closed early by a file containing `</data>`. Keep `untrusted.ts`'s U+200B neutralization including of Sequence's own delimiters.
5. **`LOCAL_HOSTS` as four exact strings** (`providers/__init__.py:50`). Keep `isLoopbackOrPrivateHost`.
6. **No total-bytes ceiling on provider responses.** Keep `MAX_PROVIDER_RESPONSE_BYTES` (`provider.ts:334`).
7. **Zero frontend tests.** MLH verifies with 26 agent-driven screenshots in `.fleet-verify-shell/` marked *"evidence, not source"* (`.gitignore:18-22`). The fold (`transcript.ts:243`) and the SSE parser (`events.ts:234`) are pure functions with rich edge cases and have no tests at all. **Keep SEQ's 362 test files and add the screenshot loop on top — do not trade one for the other.**
8. **No production serving path.** `app/main.py` never mounts `frontend/dist` (grep for `StaticFiles`/`mount`: no hits). SEQ already serves the built dist same-origin from the analyzer server (`repoServer.ts:36, 3456-3462`) — genuinely simpler than MLH's portfile/proxy/token dance, which exists only because the engine is a separately-launched Python process with strict origin checks (verified curl recorded at `frontend/README.md:38-46`: `403 {"detail":"cross-site request refused"}`).
9. **No retry on transient stream failure.** `_stream_once` (`conductor.py:454-501`) catches and reports, never retries. SEQ at least has `llm/failover.ts` written.
10. **A blinking caret.** `chat.css:55-65` ships a 2px accent bar on `1s step-end infinite` while Graphite page 20.2 drops it under *"nothing moves that is not data."* An unresolved internal contradiction — Sequence must pick one. Recommendation: tool rows plus a measured elapsed figure satisfy the book; **also drop SEQ's own shimmer** (`AskLoadingRow.tsx:80-82`), which page 19.3 forbids outright.

---

# 5. THE NEW `packages/web` SKELETON

Scaffoldable tomorrow. Nothing below inherits a layout, component, class name, or colour from the old tree, per `docs/PIVOT-V2.md`.

```
packages/web/
  index.html                data-theme="dark" on <html>; pre-paint theme <script>;
                            NO webfont CDN link (fontsource stays bundled)
  vite.config.ts            react() + strictPort:true on a pinned port
                            + server.proxy '/api' -> analyzer  + commitStamp()
  package.json              target: react, react-dom, @xyflow/react, elkjs,
                            2 fontsource packages. Nothing else without an argument.
  src/
    main.tsx                <15 lines. Root branch only:
                              parsePopoutSurface(location.search) ? <PopoutShell/> : <App/>
                              + createRoot + StrictMode. No CSS imports.
    App.tsx                 THE SHELL ONLY. Target <700 lines.
                            - one ordered, commented block of styles/ imports
                            - grid + resize + dialog + inspector + theme
                            - <=8 useState. No business logic.

    engine/                 TRANSPORT. Zero React imports (enforced in review).
      config.ts               base URL + availability, memoised once per page load
      client.ts               ONE fetch wrapper + one typed fn per /api route
      errors.ts               EngineError(status,path,detail,body)
                              | EngineUnavailableError | NotImplementedError(path,specifiedIn)
      events.ts               the fetch SSE reader: id:/event:/data:, Last-Event-ID
                              + &since=, [500,1000,2000,4000,8000] backoff,
                              zero-wait on clean end, interrupt()
      types.ts                transcribed from the analyzer that SHIPPED

    model/                  PURE. Zero React, zero fetch. THE SALVAGE LANE.
      transcript.ts           events[] -> TranscriptItem[]   (the fold)
      graph/                  the pure graph maths PIVOT-V2 §4 keeps
      format.ts  markdown.ts  budget.ts (re-export analyzer's tokenBudget shape)

    hooks/                  ADAPTERS. One hook per engine concern. No store.
      useChat.ts  useRepo.ts  useGraph.ts  useTools.ts  useScan.ts  useEvidence.ts

    components/             flat until ~30 files, then split by surface
      primitives.tsx          StatusDot VerdictBadge ProvenanceTag Button
                              IconButton ContextChip Strip  (~10 atoms)
      Icon.tsx                one inline SVG set, one stroke weight, currentColor,
                              + groupIcon(group) keyed off engine-supplied group
      Chrome.tsx              useTheme + ThemeToggle + Segmented. The ONLY place
                              data-theme is touched.
      Composer.tsx  Transcript.tsx  Rail.tsx  Inspector.tsx  Strips.tsx  …
      board/                  the ONE surface that earns a subdirectory.
                              xyflow + a DYNAMIC import of elkjs live here and
                              nowhere else.

    styles/                 tokens.css · base.css · shell.css · chat.css · board.css
                            imported in ONE ordered block in App.tsx with the
                            order ARGUED in a comment (later sheets raise radius/
                            padding off earlier defaults; at equal specificity the
                            later rule wins).
```

**Entry point.** `main.tsx` keeps exactly one thing from the old tree: the root branch on `parsePopoutSurface(window.location.search)`, because tearing a board into its own window is a real capability MLH does not have and it is a branch at the root, not a router. Everything else in today's `main.tsx` — the 15-import CSS block and its 27-line specificity comment (`packages/web/src/main.tsx:14-60`) — dies with the legacy tree. **No router.** Navigation is state: `dialog: 'connect'|'settings'|'tools'|null` and `inspector: {open, subject}`, each **conditionally mounted, not hidden** — the a11y reason is recorded at `MLH/App.tsx:424-434`: leaving panes in the DOM behind `display:none` duplicated every pane's rows and its landmark, *"so a screen reader met the Machine pane twice."*

**State approach — no zustand, no context.** Both `state/store.ts` (2,387 lines) and `product/state/productStore.ts` (53,953 B) are demolition targets, not migration targets.
- Server truth stays on the server; hooks are `useState` + `useEffect` + `refresh()`.
- Anything a fold can produce is a `useMemo` fold, never state — the transcript, the current verdict, the latest scan summary.
- `useState` in `App.tsx` for genuinely local UI only: dialog, inspector, draft, two panel widths.
- The board is the honest exception: selection, viewport and hover are local component state inside `components/board/`. **If it feels like it needs to be global, that is the signal a fold is missing.**
- Persistence: a handful of `seq.`-namespaced localStorage keys, each with a one-line comment naming the engine gap it stands in for (MLH does this at `App.tsx:59-62` rather than papering over a missing `density` column with an app-wide setting). Density keyed **per thread id**, not per app.

**Layout mechanism.** `.app` is `display:grid; grid-template-columns: var(--rail-w) minmax(0,1fr) var(--pane-w); grid-template-rows: 100vh`. `App.tsx` writes `--rail-w`/`--pane-w` as **inline custom properties** from React state and sets `data-stack={overlay|open|closed}`; the three columns respond entirely in CSS. **React owns two numbers; CSS owns the layout.** No resize observers, no `style.width` on children.

**The engine seam — three rules, each with a mechanism:**
1. **`engine/` never imports React; `components/` never calls `fetch`.** Components receive callbacks threaded from `App.tsx` (MLH threads one `runTool` into both the transcript and the composer, `App.tsx:113-135`). This makes every component testable with props alone and the transport swappable when Sequence goes packaged.
2. **The UI never computes what the analyzer decides.** Transcribe `MLH/lib/engine/client.ts:3-7`. Sequence's grounding claim *is* this rule — the moment `packages/web` ranks, scores, or infers a graph fact, "we read a graph instead of guessing" stops being true of the client.
3. **A route that does not exist throws `NotImplementedError` naming where it was specified** (`client.ts:80-93`) and the surface prints **no** number rather than a plausible one. MLH's live example is `getFeasibility()` — the Python module exists, no HTTP route serves it, the function throws, and the empty state prints facts with no capability sentence. *"This client types it; it does not fake it."*

Contrast today: `packages/web/src/ai/aiClient.ts` is 48,210 B with **30+ `fetch('/api/…')` call sites**, each re-implementing `const body = await r.json(); if (!r.ok) throw new Error(body.error ?? \`HTTP ${r.status}\`)` — no shared wrapper, no typed error, no distinction between "refused", "not running", and "not built yet".

**Where Graphite tokens live.** The **citable source is `docs/brand/graphite/_core.html`** (the frozen book — substrate plus twelve sheets), bound by `docs/brand/GRAPHITE-DECISIONS.md`. The transcription described here was verified against `MLH/frontend/src/styles/tokens.css` (236 lines) and the MLH Graphite pages (40, verified present); the file it landed in was `packages/web/src/styles/tokens.css`, which **is deleted at Wave 7** — the v2 token layer lives in `packages/web2` (`docs/PIVOT-V2.md`).

Vocabulary to transcribe, quantified: 4 ink + 4 surface + 2 bg + 3 edge greys; **exactly 5 verdict hues** (`--fits --spills --wont --unknown --info`); a **disjoint** 6-colour `--viz-1..6` namespace *"so a chart with six series does not spend the verdict budget"*; a **third disjoint** diff channel *"so a removed line can never be misread as 'won't fit'"*; 6 radius steps (4/8/10/14/18/999) plus the one named exception `--r-bar:2px`; 9 type sizes 10-26px each paired with an explicit line-height, **compact is the only mode and there is no size above 26px**; 12 spacing steps on a 4px base named for pixels; 2 durations + 1 easing. Layout constants are tokens too: `--rail-w:280 --pane-w:392 --col-max:720 --topbar-h:44 --row-h:30 --icon-btn:26` plus the resize clamps.

Derive every wash and edge **once** in a second `:root` block via `color-mix(in srgb, var(--fits) var(--mix-wash), transparent)`, with `--mix-wash`/`--mix-edge` differing per theme (10%/38% light, 14%/46% dark) — *"so a change to `--fits` cannot leave a wash behind on last year's hue."*

The governing law, transcribed from `shell.css:26-29`: **every hue on screen is a claim about the world, and there are never more hues than there are claims. Dividers, headings and chrome are never coloured. A red WON'T FIT is alarming because it is the only red on screen.** Adopt the enforcement mechanism too: **each sheet counts its own hue budget in its header comment**, as `plan.css:12-27` and `evals.css:20-34` do. It is the one design rule in this repo an automated reviewer can actually check.

**Dev/serve seam.** Keep same-origin in production (`repoServer.ts:3456-3462`). **Add `server.proxy` for `/api` to `packages/web/vite.config.ts`** — verified absent today, which is why `start.ps1:75-98` runs a full `pnpm build` before serving. Iteration on the UI currently requires a production build; in the rebuild it should be the fastest loop, not the slowest.

---

# 6. THE ENGINE GAPS THIS EXPOSES

Each is a place `packages/analyzer` cannot support what MLH's frontend does. Ordered by what blocks the most of §2 and §5. Every gap carries the line that proves it.

### Gap 1 — No token streaming. The provider request never sets `stream: true`. **BLOCKS §2 items 1, 14.**
`packages/analyzer/src/server/provider.ts:758-761` (verified) builds `{ model: modelForWire, messages: [{ role:'user', content: prompt }] }` for the openai-compatible wire and `{model, max_tokens, messages}` for anthropic. Neither carries `stream`. `provider.ts:762` then does `await readCappedText(res, MAX_PROVIDER_RESPONSE_BYTES)` — the whole body, parsed as one JSON object. `AskStreamEvent` (`askPipeline.ts:85-118`) has no `token` or `delta` variant. The parking is explicit: `packages/web/src/product/seqdStreamPark.test.ts:1-3` — *"provider returns full text; SSE carries trace + result only (no token/delta). Do not fake live partial drawing"* — and `sendAsk.ts:687` marks it *"UNFINISHED Track E: incremental seqd token-stream — parked until provider delta SSE."*
**Consequence:** an 8B Q4 model at ~15-30 tok/s means a 600-token answer is 20-40 s of spinner then a blob. MLH emits its first `chat.delta` in under a second (`conductor.py:454-501`). Reference parser to port: `openai_compatible.py:229-311`.

### Gap 2 — SSE frames carry no id, so nothing is resumable. **BLOCKS §2 items 1, 2, 3; §5's entire state story.**
`repoServer.ts:525-527` (verified in full):
```ts
function writeSseEvent(res: http.ServerResponse, event: AskStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
```
No `id:`, no `event:`. `startSse` (`:518-523`) sets headers only. Client side, `aiClient.ts:996` parses `data: ` lines only, and `JSON.parse` at `:999` is unguarded — one malformed frame throws out of the read loop. **Fix:** an autoincrement, committed-before-yield id per event, honouring `Last-Event-ID` with `?since=` as the header-stripping-proxy fallback (`MLH/app/events.py:12-30`, `main.py:844-897`). MLH's verifying curl is recorded at `frontend/README.md:110-119`: `Last-Event-ID: 180` against `since=0` returned `181,182,183,184,185`.

### Gap 3 — The ask stream is a POST, so there is no route to reconnect to. **BLOCKS resume even after Gap 2.**
`repoServer.ts:2045` (verified): `if (pathname === '/api/ask/stream' && method === 'POST')`. A resumable stream must be re-openable by URL; a POST body cannot be replayed by a reconnecting reader. MLH's split is `POST /threads/N/turn` (runs the turn, returns row ids, `main.py:815-841`) and a separate long-lived `GET /api/events?scope=…&since=N` (`main.py:844-897`), and states why: *"the writer never depended on the reader being attached."* **Fix:** split the ask into `POST /api/ask/run` returning a `runId`, plus `GET /api/events?scope=run:<id>&since=N`. This is the single change that unlocks §2 items 1-3 and the whole no-store architecture in §5.

### Gap 4 — Tool calls are parsed out of prose; no `tools` array is ever sent. **BLOCKS §2 items 12, 13, 14.**
Grep for `tools`/`tool_choice`/`tool_calls` in `provider.ts`: **zero hits**. The recovery path is `FENCED_TOOL_RE = /```sequence-tool\s*\n([\s\S]*?)\n```/g` (`askTools.ts:717`) with `catch { /* malformed block — drop it */ }` at `:745-747`. Sequence's own `AskPipelineInput.callProvider` signature (`askPipeline.ts:146-156`) has a `toolRequests?` field that both production bindings (`repoServer.ts:2022-2025`, `:2214-2217`) never populate. Note the capability is not unknown to the repo — `llm/label.ts:212` sends a real Anthropic `tools:` array.

### Gap 5 — No cancellation reaches the engine. **BLOCKS §2's stop button; §3.6's Retry.**
Grep for `signal|abort|AbortSignal` in `packages/analyzer/src/server/askPipeline.ts`: **zero hits** (verified). The web client holds a real `AbortController` (`ProductChat.tsx:538-540`) and handles `kind:'aborted'` (`:632-636`), but nothing server-side observes a client disconnect on the ask route — the `res.on('close', onClientGone)` handlers at `repoServer.ts:2498` and `:2549` are on the **ACP** route. MLH has no cancel route either (`app/main.py` has no `/cancel`), so this is a gap both sides share and Sequence must close on its own. Sequence is closer: the ACP client already implements a real `session/cancel` (`packages/acp/src/client.ts`).

### Gap 6 — No timeout on the provider call.
`provider.ts:765` (verified): `res = await fetch(url, { method:'POST', headers, body })`. No `AbortSignal`, no `AbortSignal.timeout(...)`; grep for `timeout` in the file returns nothing. A local server paging a model into VRAM, or a wedged llama.cpp, hangs the ask on undici transport defaults with no honest error. MLH bounds all four call classes: 600 s local stream (`ollama.py:33`), 300 s remote stream (`openai_compatible.py:41`), 60 s probe (both), 5 s local daemon enumeration (`tools/models.py:102`) — *"It is on this machine or it is not."*

### Gap 7 — No capability probe, no provider capability storage. **BLOCKS §1.6 and the honest degraded mode.**
Nothing anywhere records `tool_calling: yes|no|unknown` per configured model. Sequence advertises 7 tools (`askTools.ts:56-64`) to every model including ones that will never emit a fence. MLH stores it tri-state with provenance (`providers/__init__.py:53-79`, `store.py:29-43`) and displays it before the user types (`Settings.tsx:246-252`). **Fix:** one probe call offering a trivial tool (`conductor.py:256-268`), plus Ollama's zero-turn `/api/show` path (`ollama.py:96-125`), stored on the provider row.

### Gap 8 — A keyless local endpoint cannot be configured. The local route has no production caller.
`provider.ts:404-406` (verified): `if (typeof o.apiKey !== 'string' || o.apiKey.trim() === '') return { error: 'apiKey must be a non-empty string' };` Every config load path runs `validateAiConfig` — `loadAiConfig` (`repoServer.ts:3497-3511`) for repo, user and env; the PUT handler at `:2309`. So the deliberate keyless-loopback branch at `provider.ts:707-716` (`localNoKey = !cfg.apiKey && isLoopbackOrPrivateHost(host)`, verified) is **unreachable**, and the code says so at `:672-674`: *"the api-key guards below can only fire for a config `validateAiConfig` would have rejected."* The UI closes the trap: `panels/AiControls.tsx:318` disables Save on `!apiKey`, so the "Run a local model" card at `:355-368` prefills `http://127.0.0.1:11434/v1` and then blocks Save until the user invents a fake key.
Separately, `LocalOpenAiCompatibleRoute` (`modelRoutes.ts:53-59`) is consumed only by `requestModelRequest` (`provider.ts:1041`), whose **only** invocations across the monorepo are in `test/failover-policy.test.ts`, `model-session-compaction.test.ts`, and `usage-spend-phase-d.test.ts`. Every real chat path goes `generateText` → `requestModelTextWithUsage` (`:748-800`), which takes an `AiConfig` and knows nothing about routes.

### Gap 9 — Prompt budgets are unrelated to the connected model's real context window.
`DIGEST_BUDGET_TOKENS = 48_000` (`explain/explain.ts:1286`), `INTENT_SECTION_BUDGET_TOKENS = 8_000` (`askIntents.ts:599`), `LABEL_COMPONENTS_BUDGET_TOKENS = 16_000` (`llm/label.ts:71`) are fixed constants. The context window is a hardcoded substring table of five cloud families (`packages/web/src/product/askTraceModel.ts:360-366`: `gpt-4.1`, `gpt-4o`, `gpt-5`, `claude`, `deepseek`). `qwen2.5:7b-instruct` — the tag Sequence's own recommender hands you — matches nothing, so the orb renders empty (correctly, per `:388-390`, but blind).
**Consequence:** point Sequence at a local model with Ollama's default 4096-token window and hand it a 48,000-token digest; Ollama silently drops the front of the prompt, and `omissionMarker` never fires because the prompt was inside *Sequence's* budget and outside the *model's*. The answer degrades with no signal anywhere. This closes MLH's own §4 gap at the same time.

### Gap 10 — No durable trajectory. The ask trace is written once, at the end, best-effort. **BLOCKS post-hoc diagnosis of any crashed turn.**
`repoServer.ts:2164-2192` (verified): `askTrace` is an in-memory array pushed to inside `emit`, and `finalizeTrajectory` calls `writeTrajectory` once with `catch { /* trajectory persistence is best-effort; the stream already succeeded */ }`. A crashed turn leaves no record of which tools ran. The buffered `/api/ask` route (`repoServer.ts:1877`) persists nothing per round at all. MLH's rule is one line: `events.append()` (committed) **before** `yield` (`conductor.py:9-18`).

### Gap 11 — `search_files` asserts "no matches" from a partial walk, with no truncation notice.
`askTools.ts:300-303` stops the walk at `ASK_TOOL_SEARCH_MAX_FILES = 200` (verified at `:86`); `:341-343` then returns `{ok:true, evidence:'search "x" — no matches'}`. On any repo larger than 200 files — Sequence itself is 377 files in `packages/web` alone — "no matches" is asserted after an arbitrary DFS-ordered subset (`walkFiles`, `:659-681`). A model that receives "no matches" concludes the symbol does not exist. This is exactly *"a missing fact becomes a diagnosis computed from defaults"* (`conductor.py:55-56`). **Fix is small:** return `truncated: true` and a files-scanned count.

### Gap 12 — `call_mcp` is advertised without a vocabulary.
`askTools.ts:879` tells the model it may call MCP servers; the prompt **never lists which servers or tools exist**. `listMcpTools` exists as `GET /api/mcp/tools` (`repoServer.ts:3401-3409`) and is never called from the ask path. The model must guess a server name and a tool name, and a wrong guess returns `refused: unknown mcp server` with no list — the same wall-with-no-door as Gap 4's unknown-tool refusal, but for the one tool where the vocabulary is genuinely unknowable. **Fix: one function call from the ask path.**

### Gap 13 — `run_command` spawns without user confirmation, and there is no approval channel.
`askPipeline.ts:323` executes every tool request including `run_command` in Code mode. Work mode drops it (`askTools.ts:73-76, 208-210`) and `propose_files` is staged not written (`:367-438`) — but there is no per-tool `approval` declaration and no 428-equivalent. MLH refuses in-loop with `ApprovalRequired` (`registry.py:425-432`) and the control route answers **HTTP 428** (`main.py:1117-1118`), with the refusal sentence explaining that *an approval arrives on a different channel than the call does*. Sequence's mitigations are real and good (`verifyGate.ts:29-34` allow-list, `shell:false`, fixed argv) but they are a *content* gate, not a *consent* gate. Add `storm.py:307-330`'s contract fingerprint at the same time: a tool that grew an argument or started requiring approval since the person said yes stops the run.

### Gap 14 — Keys are written to disk in plaintext.
`repoServer.ts:3703` writes the BYO key into `.sequence/ai.json`. MLH's `app/providers/secrets.py:1-12` has no `api_key` column, never imports `db`, and writes no file — Windows Credential Manager / macOS `security` / `secret-tool`, with an `MLH_KEY_<id>` env override checked first, all stdlib, no new dependency, proven by a test that reads the SQLite file as bytes.

---

## UNVERIFIED / not established

- Neither app was run. All claims are from reading source at the paths given, except the two prompt-size measurements (`instructions.assemble()` was executed) and the file/line/byte counts.
- I did not read `MLH/app/tools/evidence.py` in full (2,707 lines); the `CallerValue` taint mechanism is described from `registry.py:481-533` and the module docstring.
- MLH's stated tests exist under `tests/` but were not run; SEQ's 362 test files were not run.
- Whether a hanging MLH tool with no internal timeout can pin a turn indefinitely — nothing in `registry.py` or `conductor.py` bounds handler wall-clock.
- `navigator.deviceMemory`'s spec clamp at 8 GiB (which, if it holds, makes `localModelRecommend.ts:131-146`'s 14B branch dead code on every machine) is spec behaviour external to both repos.
- undici's default socket timeout, relevant to Gap 6's severity, is external to this repo.
- No measurement exists in either repo of whether any specific prompt clause changes model behaviour. MLH has the machinery (`app/tools/prompts.py` + `app/tools/evals.py`) but I found no stored bench run scoring its *own* instruction set.
- Whether `role: "system"` is honoured identically across Sequence's provider matrix (OpenRouter aliases, the default gateway) — both `provider.ts:760-761` and `label.ts:164/220` currently send everything as one `role:"user"` message, worth ~1,089 tokens of stable, uncached, authority-ambiguous preamble per turn.