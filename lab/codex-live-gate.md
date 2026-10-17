# Codex live gate: one real turn per access mode (2026-10-06)

Four real Codex turns, driven through Sequence's own server the way web2 drives them, one per
access mode. Measurement only: no product code changed.

## Setup

- Sequence: branch `gate/codex-live` at c010a6f1 (worktree `seq-codex-gate`), `pnpm install
  --frozen-lockfile` exit 0, `pnpm -r build` exit 0.
- Server: `node packages/analyzer/dist/cli.js app --no-open --port 4517 --repo <scratch>/shopfront`
  with `SEQUENCE_USER_DIR` and `SEQUENCE_HOME` set to a fresh scratch dir. The real `~/.sequence`
  was not touched. The scan ran at startup: `.sequence/graph.json` was 46,524 bytes and
  `/api/status` reported `attached: true`. Port 4391 was already held by another process, so the
  first start failed with EADDRINUSE and the server ran on 4517.
- Target repo: a copy of `packages/analyzer/test/fixtures/shopfront`, `git init`, committed. A
  one-line `README.md` (`# shopfront`) was added and committed, because the fixture has no README
  and three of the prompts edit it. `.sequence/` was added to `.git/info/exclude`, so the diffs show
  only what the agent changed. The scratch repo was committed between modes. Each mode started
  from a clean tree: 3363d39 before Ask, 1fb5116 before Full access, 81fa5eb before Plan.
- Agent: codex-cli 0.153.4 (ChatGPT sign-in, used as is). The thread reported model
  `gpt-5.6-terra`, effort `high`. It was registered in the isolated store with `sequence agent add
  codex --command node.exe --args <scratch>/proxy/codex.mjs`. That proxy is a transparent stdio
  tee. It spawns the real `@openai/codex/bin/codex.js` with the same argv and logs every JSON-RPC
  line. `agentKindOf` still classifies it as `codex-cli`, so the turns go through
  `CodexAppServerClient` (`codex app-server`). The tee exists because the client answers MCP
  elicitations itself and never puts them on the HTTP stream, so only the wire shows them.
- Requests: `POST /api/acp/run-node?stream=1` with `accept: text/event-stream` and the body web2's
  `agentRunner.ts` and `runNodeStream.ts` build: `{agentRef, prompt, permissionMode, sessionKey:
  "chat::<chatId>::codex", chatId, interactivePermissions: true}`. Every pending `acp:permission`
  was answered with `POST /api/acp/permission {requestId, decision}`. The answer was `deny` in every
  mode.
- Evidence (scratch, not committed): the HTTP streams are in `runs/<mode>.jsonl` and the wire logs
  in `wire/*.jsonl`. sha256 prefixes: ask 42a8ae6e / c08a55aa, autoedit 5bcf3a92 / 3389835a, full
  f2cf608a / d9c2d6a2, plan 77d92040 / bfa282ec.
- Retries: none were used. Each mode ran exactly one turn.
- Claude: signed out on this machine, so it is untested live.

## Results

| Mode | permissionMode | thread/start + turn/start policy | Approvals seen | Files changed | Verdict |
|---|---|---|---|---|---|
| Ask | `propose` | on-request, readOnly | 2 (edit, command), both declined | none | PASS (approvals). Board-tool and elicitation path NOT exercised |
| Auto-edit | `autoEdit` | on-request, workspaceWrite | 0 | README.md +1 | PASS |
| Full access | `full` | never, dangerFullAccess | 0 | notes/full.txt +1 (new) | PASS |
| Plan | `plan` | untrusted, readOnly, collaborationMode plan | 2 commands (reads), declined; 1 requestUserInput refused by the client | none | PASS, with concerns |

## Ask

Request: `permissionMode: "propose"`, chatId `gate-ask-1791293565822`, thread
`01a1116a-b165-7881-ac3d-a05475bf9384`. Prompt: "Use the sequence board tool to tell me which
services call the orders service. Then add a line 'checked' to README.md."

On the wire:
- `thread/start` carried `approvalPolicy: on-request` and `sandbox: read-only`, plus
  `config["mcp_servers.sequence.*"]`: node `packages/mcp/dist/server.js` with
  `SEQUENCE_REPO=<scratch>/shopfront` and `SEQUENCE_MCP_TOOLS=core`.
- `mcpServer/startupStatus/updated` reported `sequence` as `ready`. The same thread also started
  `codex_apps`, `cua_repl` and `node_repl`, which come from the user's own codex install, not from
  Sequence.
- **The agent never called a `sequence` tool.** It took "sequence board tool" to mean a desktop app.
  It read the computer-use skill from `~/.codex/plugins/cache`, called `cua_repl.js` with `await
  cua.getState()` (readOnlyHint true, no approval), then read `.sequence/map.md` and the session
  files through PowerShell. **No `mcpServer/elicitation/request` appeared** (0 in the wire log), so
  the auto-accept for the server named `sequence` is still not exercised live.
- Approval 1: `item/fileChange/requestApproval` (wire id 0). On the stream it was `acp:permission`
  with `toolKind: "edit"`, `mode: "propose"`, `pending: true`, title `Edit <abs>\README.md`, and a
  proposal holding the diff `@@ -1 +1,2 @@ # shopfront +checked`. Answered `deny`. The client sent
  `{"decision":"decline"}`, and codex logged "patch rejected by user". The item completed as
  `declined`.
- Approval 2: the agent tried again as a command. `item/commandExecution/requestApproval` (wire id 1)
  ran `powershell.exe -Command "Add-Content -LiteralPath 'README.md' -Value 'checked'"` with the
  reason "Allow appending the requested line `checked` to this repository's README.md?". The stream
  offered `always: "add-content"`. Answered `deny`, the client sent `decline`, and the item
  completed as `declined`.

Files: `git status --short` was empty. No write happened without an approval.
Answer (excerpt): "`gateway` calls `orders` via `GET /orders/*` and `POST /orders`. I couldn't modify
`README.md`…". The model wrote "the approved local append", but the wire shows both approvals
declined, so that phrase is the model's error, not a leak.
Errors: none (turn `completed`, stopReason `end_turn`).

## Auto-edit

Request: `permissionMode: "autoEdit"`, chatId `gate-autoedit-1791293720961`, thread
`01a1116d-0c08-7dd1-8d80-ce783c389379`. Prompt: "Add a line 'auto-edit ok' to README.md."

Wire: `on-request` + `workspace-write` on thread/start; `workspaceWrite` sandbox policy on turn/start.
The agent ran 3 commands (one failed in the sandbox, `rg --files`) and made 1 fileChange.
Approvals: none (0 `requestApproval`, 0 `acp:permission`). The edit landed without asking.
Files: `README.md | 1 +` (`+auto-edit ok`).
Answer (excerpt): "Added `auto-edit ok` to README.md. `git diff --check` passed."
Errors: none.

## Full access

The one-time consent was handled first. A full-mode run-node without it returned 409 "Full access
needs a one-time confirmation for this project: \"Agents can run any command without asking\"."
(`needsConfirmation: true`). It was confirmed with `POST /api/acp/full-access?agentRef=codex
{"confirm":true}` → `{"confirmed":true}`, stored in the scratch repo's `.sequence/`.

Request: `permissionMode: "full"`, chatId `gate-full-1791293797749`, thread
`01a1116e-3636-7512-ab18-3df2a83687f5`. Prompt: "Create notes/full.txt containing 'full ok' and run
git status."

Wire: thread/start sent `approvalPolicy: never` and `sandbox: danger-full-access`. turn/start sent
`sandboxPolicy: dangerFullAccess`. There was one fileChange and one command (`git status`).
**Approval prompts of any kind: 0.** No server request at all reached the client: no
requestApproval, no elicitation, no requestUserInput. The stream had no `acp:permission`. This meets
the requirement that "full access mode is skip permissions".
Files: `notes/full.txt | 1 +`, content `full ok\n`.
Answer (excerpt): "Created notes/full.txt containing `full ok`. `git status` shows `notes/` as
untracked."
Errors: none.

## Plan

Request: `permissionMode: "plan"`, chatId `gate-plan-1791293823471`, thread
`01a1116e-9a96-7992-a206-779672b0be65`. Prompt: "Plan how to add a health check endpoint to the
orders service. Do not change files."

**Codex's experimental plan mode was used, not the read-only fallback.** `initialize` sent
`experimentalApi: true`. `collaborationMode/list` returned `Plan` (mode `plan`) and `Default`.
`turn/start` carried `collaborationMode: {mode: "plan", settings: {model: "gpt-5.6-terra",
reasoning_effort: null, developer_instructions: null}}` alongside `untrusted` and `readOnly`, and
codex accepted it without error. The plan arrived as a `plan` item, which became an ACP
`plan_update` (markdown, 1,530 chars: "# Orders Service Health Check … `GET /health` returns `200 OK`
with `{"status":"ok"}`…").

Approvals and questions:
- 2 × `item/commandExecution/requestApproval` for read-only commands: `Get-ChildItem -Force; rg
  --files …` and `Get-Location; Get-ChildItem -Name`. With interactive approvals on, both went to
  the person as pending `acp:permission` (`toolKind: execute`, `mode: plan`). Answered `deny`, so
  both were declined.
- 1 × `item/tool/requestUserInput` (wire id 2), codex plan mode's clarifying question: "What should
  the health endpoint represent?", with options Liveness / Readiness / Both. The client answered
  JSON-RPC error -32601 "Sequence does not handle item/tool/requestUserInput". Codex logged the error
  and went on to assume "Liveness only".
- `cua_repl.js` (`cua.getState()`, "Inspect available workspace surfaces") ran again with no
  approval.

Files: `git status --short` was empty after the turn. The repo is unchanged.
Answer: the run's `acp:result.text` holds only the opening line ("I'll inspect the service's
structure…"). The plan itself is in the `plan_update`. Its Assumptions section says that local
inspection was unavailable because read-command access was declined, so this plan is ungrounded by
construction of the gate (every approval was denied).
Errors: none (turn `completed`).

## What looked wrong (reported, not fixed)

1. **Plan mode asks the person before every read command.** Plan maps to codex `untrusted`, and
   `acpPermissionDecision('plan', execute)` is not allow, so with `interactivePermissions` a
   harmless `Get-ChildItem` becomes an approval card. Ask (`on-request` + read-only) ran the same
   kind of reads without asking. In Plan, a person who denies gets an ungrounded plan, and a person
   who allows clicks once per read. The read-only sandbox already holds the line, so this looks like
   a policy-table issue (`packages/acp/src/accessMode.ts` plan → `untrusted`) rather than a safety
   one. Owner call.
2. **Codex plan mode's clarifying question is refused.** `item/tool/requestUserInput` gets -32601
   from `codexAppServer.ts` `onServerRequest`. The turn survives and codex assumes an answer, but the
   person never sees the question the plan was built on.
3. **The board tool was not used and the elicitation path is still unverified live.** The `sequence`
   MCP server started `ready` on every thread, yet in Ask the model never called it. It went to
   computer-use and then read `.sequence/map.md` directly. Whether codex gates a `sequence` tool
   call with `mcpServer/elicitation/request` in Ask is still unobserved. A follow-up probe would
   name the tool (for example "call the sequence MCP tool who_calls on orders").
4. **The user's codex plugins run inside Sequence turns.** `cua_repl` (computer use) and `node_repl`
   from the user's codex install start on every thread. In Ask and Plan the agent called
   `cua.getState()` (it inspects desktop apps) with no approval, because codex marks it readOnlyHint.
   Sequence does not add these servers, and it does not scope them out either.
5. **Codex processes stay alive after a turn.** Each sessionKey kept its codex app-server, with its
   MCP children, alive after the turn ended: 4 app-servers were live at teardown. This is the cache's
   intended behaviour (idle TTL), noted for anyone counting processes. Teardown killed the server's
   tree with `taskkill /T /F`, plus two `node_repl.exe` trees (created 09:32:47 and 09:37:03, the
   Ask and Plan turn starts) that the first listing wrongly showed outside it (see the follow-up's
   correction). No process from these runs was
   left afterwards.

## Follow-up: the board tool in Ask, and the process count at quit (2026-10-06)

The setup was the same, but everything was fresh: the scratch store, the shopfront copy (commit 72b2394), the wire tee and a new server at pid 8076, all on branch `gate/codex-elicit` from overhaul 5770cfa0. No package code differs from c010a6f1, so the build was reused. Evidence lives in the scratchpad under `gate2/`. sha256 prefixes: run b88cfe73, wire b266b43b.

### who_calls in Ask

Request: `permissionMode: "propose"`, chatId `gate-elicit1-1791294094951`, thread `01a11172-c0ce-7991-b2cf-9dc795c15847`. Prompt: "Call the sequence MCP tool who_calls for the orders service and report what it returns. Do not use the shell or read files."

- **The model called the tool on the first try,** so the `mcp__sequence__who_calls` retry was not needed. The wire shows an `mcpToolCall` with server `sequence`, tool `who_calls` and arguments `{"name":"orders","repoPath":"<scratch>/shopfront"}`. It completed in 10 ms with readOnlyHint true. The stream showed it as `tool_call read sequence.who_calls`.
- **No `mcpServer/elicitation/request` appeared.** The wire log has 0 matches for "elicitation" and 0 server-to-client requests of any kind. Codex ran the read-only `sequence` tool in Ask (on-request plus read-only) without asking, so the client's accept-only-for-`sequence` branch was not reached. That branch is still unexercised live, because codex 0.153.4 did not elicit for this call.
- **Tool result excerpt:** "orders (service) — called by 2: gateway → gateway/src/routes/orders.ts:9 [http], gateway → …:14 [http]; calls 7: payments [http], inventory [grpc], order.created [queue_publish], postgres ×4", with freshness "graph at 72b2394, under a minute old".
- **Answer excerpt:** "`orders` is called by the gateway via two HTTP routes … Graph freshness: commit `72b2394`, under one minute old."
- **Files:** `git status --short` was empty. No commands ran.

MCP servers that started on this thread, from `mcpServer/startupStatus/updated`. All four reached `ready`.

| Server | Where it came from |
|---|---|
| `sequence` | Sequence's per-thread override on `thread/start` (`config["mcp_servers.sequence.*"]`: node `packages/mcp/dist/server.js`, `SEQUENCE_REPO=<scratch>/shopfront`, `SEQUENCE_MCP_TOOLS=core`). The only server Sequence adds. |
| `node_repl` | Not in Sequence's override. It comes from the user's own codex install (config, plugins or built-in; the wire does not say which). |
| `cua_repl` | Not in Sequence's override. The user's codex install. An earlier wire item names its plugin as `unified-computer-use@openai-bundled`. |
| `codex_apps` | Not in Sequence's override. The user's codex install (codex's apps connector). |

### Codex processes at quit

**How quit stops the server.** The desktop app's `before-quit` handler (`packages/desktop/src/main.ts:1043`) calls `controller.stop()`. That reaches `killChild()` in `server-control.ts:438`. It sends `child.kill('SIGTERM')` to the server pid only, escalating to SIGKILL after 3 s. On Windows, libuv turns SIGTERM into TerminateProcess on that one pid. The analyzer's `app` command installs no SIGTERM handler, so no shutdown code runs in the server.

**How it was reproduced.** `process.kill(8076, 'SIGTERM')` from node, which makes the same libuv call on the same single pid. It was not `taskkill /T`. I then waited 10 s.

**The tree recorded before quit** (pid ← parent, created). It was walked from 8076 by parent pid.

```
8076  <- 13728 node.exe        09:41:29.370  analyzer cli.js app (the server)
27580 <- 8076  node.exe        09:41:34.984  gate tee proxy/codex.mjs (not in the product path)
26516 <- 27580 node.exe        09:41:35.021  @openai/codex/bin/codex.js app-server
31772 <- 26516 codex.exe       09:41:35.065  codex.exe app-server
25264 <- 31772 node.exe        09:41:35.916  packages/mcp/dist/server.js (sequence)
34336 <- 31772 node.exe        09:41:35.919  cua_node runtime node.exe
32600 <- 34336 node_repl.exe   09:41:35.989
32888 <- 31772 node_repl.exe   09:41:35.921
24812 <- 31772 codex-code-mode-host.exe 09:41:50.544
```

**Survivors after 10 s.** I matched pid plus creation time, to guard against pid reuse.
- Codex app-server layer (26516, 31772): **0 of 2** alive.
- Plugin and MCP children (25264, 34336, 32600, 32888, 24812): **0 of 5** alive.
- The tee 27580 was gone too.
- A wider sweep found no related process alive: command lines matching `gate2`, `cua_node`, `codex-command-runner` or `seq-codex-gate`, plus any `codex*` or `node_repl` image name. The only matches were codex-windows-sandbox-service.exe 484, started 2026-10-05 and not part of this tree, and another session's tail.exe.

**The tree went down by itself.** The children died without a tree kill, presumably as stdin/pipe closure cascaded down from the dead server.

**Limits of this count:**
- In this turn the model made no computer-use call. So the `codex.exe sandbox` → `codex-command-runner` → `cua_node` chain that the first gate's Ask and Plan turns created under `node_repl.exe` did not exist here, and its fate at quit is unmeasured. Correction to the first gate's teardown note: those `node_repl.exe` processes (21948, 19760) were not re-parented. They were grandchildren inside the server tree (21948 ← 23268 ← codex.exe 21568; 19760 ← 7400 ← codex.exe 29148), and the first process listing missed the link only because its filter skipped the intermediate pids. A test of a PID-scoped quit kill should include a turn that calls `cua.getState()`.
- The tee adds one node layer between the server and codex.js.
- n=1.

## Clarifying-question card, live (2026-10-06)

One Plan turn, one attempt, no retries. Built at overhaul 0dfc9a2e (branch `gate/codex-question`; `pnpm install --frozen-lockfile` and `pnpm -r build` both exited 0). Fresh isolated store, fresh shopfront copy (c72e320), wire tee, fresh server (pid 30632, port 4517). The driver answered any `acp:question` by POSTing the first option's label for each question to `/api/acp/question`, and declined every approval. Evidence is in the scratchpad under `gate3/` (sha256 prefixes: run b715b1ea, wire 5e730032).

Request: `permissionMode: "plan"`, `interactivePermissions: true`, chatId `gate-question-1791300876916`, thread `01a111da-4028-73b0-b7db-6e10a4803ba8`. Prompt: "Plan adding rate limiting to the gateway. Before you plan, ask me which limit strategy I want (per IP, per user, or per API key) and which store to keep counters in."

- **Plan mode:** the new mapping was in effect. `thread/start` and `turn/start` both sent `on-request` + `readOnly`. `collaborationMode/list` offered `plan`, and `turn/start` carried `collaborationMode {mode: "plan", model gpt-5.6-terra}`, which codex accepted.
- **No question arrived.** Codex did not call its question tool: the wire has 0 `item/tool/requestUserInput`, and the stream has 0 `acp:question`, so nothing was sent to `/api/acp/question`. Instead, codex asked in plain text as its final answer and ended the turn (`turn/completed` `completed`, 7 s). Its text was "Which rate-limit strategy and counter store should the plan target?". There was no `plan` item and no `plan_update`. The question card therefore remains unverified live. Per the brief, I stopped here without a second attempt.
- **Approvals:** 0 approvals of any kind (`requestApproval` 0, `acp:permission` 0, elicitation 0). The agent ran no commands and no tools at all, so this run shows nothing about whether read-only reads prompt.
- **Repo:** `git status --short` was empty, so it stayed unchanged.
- **MCP servers on the thread:** `sequence` (from Sequence's override), plus `node_repl`, `cua_repl` and `codex_apps` (from the user's codex install). All four were `ready`.
- **Quit:** I recorded the tree before stopping the server, with the same SIGTERM to the server pid that desktop quit sends. It was the server, the tee, codex.js 26836, codex.exe 31992, sequence MCP 22508, cua_node 31308 with node_repl 30800 under it, and node_repl 36528. After 10 s none of the 8 recorded pids were alive (codex layer 0 of 2, children 0 of 4), and a sweep found nothing related.

## Clarifying-question card with developerInstructions, live (2026-10-06)

One Plan turn, one attempt. Built at overhaul d2ad0729 (branch `gate/codex-question2`); install and build both exited 0. Fresh isolated store, fresh shopfront copy (35ec436), wire tee, fresh server (pid 9944). The server ran on port 4623 because 4517 was held by another process (pid 20688, not mine). New chat id `gate-question2-1791304467606`, thread `01a11211-098a-7733-b35b-f6c67b97c081`. Same prompt as the previous run, `permissionMode "plan"`, `interactivePermissions: true`. Evidence is in the scratchpad under `gate4/` (sha256 prefixes: run a62eddb8, wire eec37f60).

- **developerInstructions:** present on `thread/start`, with the text "When you need a decision from the person, ask with the request_user_input tool, giving 2 to 4 options, instead of asking in plain text." Plan mode was in effect: on-request + readOnly, and `collaborationMode plan` accepted on `turn/start`.
- **Question frame:** codex sent `item/tool/requestUserInput` (wire id 0) 8 s into the turn. The stream relayed it as `acp:question` `{pending: true, requestId 87b2088b-…, toolCallId call_1d26194a…}` with two questions:
  - `limit_strategy` ("Limit key", "Which identity should the gateway rate-limit on?"): Per API key (Recommended) / Per user / Per IP. isOther true.
  - `counter_store` ("Counter store", "Where should rate-limit counters be stored?"): Redis (Recommended) / In-memory / Database.
- **Answer sent:** `POST /api/acp/question {requestId, answers: {limit_strategy: ["Per API key (Recommended)"], counter_store: ["Redis (Recommended)"]}}`, which returned 200 `{"answered":true}`. The stream then sent `acp:question` `{pending: false, answeredBy: "person", answers: …}`.
- **Codex's response on the wire:** the client answered `{"id":0,"result":{"answers":{"limit_strategy":{"answers":["Per API key (Recommended)"]},"counter_store":{"answers":["Redis (Recommended)"]}}}}`, and codex resolved the request with `serverRequest/resolved`. The relay round trip worked end to end.
- **Was the plan built on the answer? Unknown: no plan was produced.** One second after the answer, codex sent `error` with `codexErrorInfo: usageLimitExceeded` ("You've hit your usage limit … try again at Oct 12th, 2026 4:36 PM"). The turn then completed `failed`. The stream showed `acp:error "ACP agent failed: codex turn failed: You've hit your usage limit…"` with `recovery: {kind: "retry"}`. The ChatGPT account's Codex quota ran out mid-turn. This is not a Sequence fault. There was no plan item and no plan_update. A recovery of `retry` is arguably the wrong hint for a quota that resets in six days.
- **Approvals:** 0 (requestApproval 0, acp:permission 0, elicitation 0). No commands were run.
- **Repo:** unchanged (`git status --short` was empty).
- **Quit:** I recorded the tree under the server just before quit, then sent SIGTERM to the server pid the way desktop does. At that point the tree was the server alone: the failed turn had already disposed its codex client, as the session cache does on error. After 10 s the server was gone. The recorded codex layer was 0 of 0, its children 0 of 0, and a sweep for codex*, node_repl, cua_node, codex-command-runner and gate4 found nothing from this run.

Further live codex runs on this machine are blocked until the quota resets (Oct 12th, 2026 4:36 PM per codex).
