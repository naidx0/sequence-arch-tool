# r9: Claude stalls, Stop stays, chats are lost: diagnosis

Owner reports (Jaden, 2026-10-07, installed build overhaul e61bc5e5, Claude Code through
`claude-agent-acp`): the spinner stops with no error and no retry; Claude worked and then stopped
without saying what happened; Stop stays after Claude finishes; the home-workspace chat was not
saved; chats are never titled; the Agents tree shows green with no output; no token usage.

Read-only evidence, from this machine's real store. Nothing there was written, moved or deleted.
No credential file was opened. Times are UTC (the file system shows local EDT, UTC-4).

## 1. What the store holds

| What | Path | Finding |
|---|---|---|
| Agent registry | `~/.sequence/agents.json` | `claude` = `C:\WINDOWS\system32\cmd.exe /d /s /c claude-agent-acp`. The bridge is `@agentclientprotocol/claude-agent-acp` 0.86.0 (global npm). |
| Home-workspace index | `~/.sequence/sessions/index.json` (03:33Z) | `session-3614-is1w`: `"title": "New chat"`, created 03:26:54Z, `agentThreads.claude.at` 03:28:16Z. |
| Its transcript | `~/.sequence/sessions/session-3614-is1w/chat.json` (03:26Z, 69 B) | `{"version":1,"sessionId":"session-3614-is1w","turns":[]}`. The Claude chat is not in it. |
| Its tool bodies | `~/.sequence/stream-bodies/*.txt` | 12 bodies cut at 8 KB by the stream coalescer, 03:28:37Z to 03:29:16Z: three repo docs read three times each (README, AGENTS.md, CLAUDE.md), then a Miro MCP skill result (61 KB, three times). Nothing after 03:29:16Z. |
| ml-harness index | `ml-harness/.sequence/sessions/index.json` | `session-4645-2ex2`: `agentThreads.claude.at` 03:26:22Z. |
| Its transcript | `ml-harness/.sequence/sessions/session-4645-2ex2/chat.json` (rewritten 03:38:05Z) | Last turn 2026-09-27. Today's Claude turn is not in it. |
| Last place | `~/.sequence/last-place.json` | ml-harness, 03:33:52Z. |
| Process table | `Get-CimInstance Win32_Process` at 03:40Z | `Sequence.exe` started 03:38:04Z (a quit and relaunch). No `claude-agent-acp` process alive. |

What does not exist: any record of the bridge process. `packages/desktop/src/main.ts` sends the
server's output to `console.log` only (lines 114 and 193); `AcpClient` echoes the bridge's stderr to
the server's stderr (`packages/acp/src/client.ts` start); agent events live in memory
(`agentEvents.ts`, `MAX_EVENTS = 2000`); `.sequence/ask-turns/*/events.jsonl` covers Sequence's own
ask path, not run-node. So the exit code, the stderr tail, the last JSON-RPC frames and whether
`session/prompt` was ever answered are **not recoverable** for today's turns. That gap is fixed in
this round (section 4, item 0).

## 2. What the evidence proves

- The bridge started and opened threads in both chats (03:26:22Z, 03:28:16Z: `openThread` writes
  `agentThreads` only after `session/new` or `session/resume` answered).
- In the home chat Claude ran tools for 39 s (03:28:37Z to 03:29:16Z), and then nothing reached
  the server that produced a body over 8 KB. Whether the turn ended cannot be told from the store.
- Neither chat's Claude turns were written to `chat.json`, before or after the relaunch, and the
  home chat kept the title "New chat".

## 3. Root causes (code, reproduced with fakes in this round)

**A. Agent turns are never saved, so they are never titled** (reports 3 and 4). The transcript is
written by one effect, `packages/web2/src/state/connect.tsx` (the `settledTurns` PUT, about line
1477), from `state.session.turns`, which holds Sequence's own turns only. A Claude or Codex turn
lives in the run store (`web2/src/agents/agentRuns.ts`), in memory. Nothing writes it to disk, so a
reload or relaunch drops it, in a repo or in the home workspace. The server names a chat from the
first user turn in `chat.json` (`sessionsStore.ts titleFromChat`), and the run-node route never
calls the naming path, so an agent-only chat stays "New chat". This is deterministic, not a quit
race: no single-instance or flush change would have saved it.

**B. A turn can sit with nothing on the wire, and the page cannot tell why** (reports 1 and 2).
- `claude-agent-acp` 0.86 holds `session/prompt` open after Claude's own result while background
  subagents it started are still running (`Turn.deferredSettle`, `dist/acp-agent.js` about line
  2945). Claude's answer is complete on screen, the protocol turn has not ended, and Sequence shows
  Stop with no word about why.
- A message sent while the chat's previous turn is still held, cancelling or hung waits on the
  per-chat turn lock (`analyzer/src/server/acpSessionCache.ts run`). That wait emits nothing and has
  no watchdog: the watchdog is created inside the turn callback, after the lock.
- After Stop, the cached path only aborts (`session/cancel`). A bridge that does not settle the
  cancelled turn keeps the lock until the 10-minute idle watchdog (`acp/src/turnWatchdog.ts
  TURN_IDLE_MS`) kills it, so the next message in that chat waits silently for up to ten minutes
  ("it worked and then it stopped working").
- The watchdog's only output is `hung` after ten minutes. There is no "quiet for N seconds" signal,
  no heartbeat on the stream, and the page has no clock on the run, so thinking, a long tool, a
  waiting approval and a dead stream all look the same: the spinner and nothing else.
- Checked and not a cause: when the bridge process dies, the SDK rejects the open prompt within
  about 10 ms (`ACP connection closed`, then `AgentExitedError` with the exit code), including
  through the `cmd.exe /c` wrapper with a node grandchild (scratch run: dispose 1,017 ms, prompt
  rejected at 1,028 ms, grandchild gone). The page folds `acp:result` and `acp:error` at once
  (urgent events), and a stream that ends without either still ends the run
  (`agentRunner.ts streamRun`). So Send returns whenever the server ends the stream; Stop stays
  exactly as long as the server keeps it open.
- An approval is never dropped by the fold (`foldApproval`), and the toasts list approvals from
  every chat. The bridge declares no elicitation support to Sequence (`clientCapabilities: {}`),
  so `AskUserQuestion` is disallowed and MCP elicitations are auto-declined by the bridge, never
  left waiting. What was missing is a visible reason on the stalled turn when one is waiting.

**C. The Agents tree has no clock** (report 6). `agentTree.ts` builds green dots from tool events
with no durations, so a 40-second tool and a 40-ms one look the same, and a turn that ended with no
answer text looks like success.

**D. Token usage is dropped** (report 7). The bridge answers each prompt with `usage`
(`inputTokens`, `outputTokens`, `cachedReadTokens`, `cachedWriteTokens`; reset per user turn,
`sessionUsage` in `acp-agent.js`); `AcpClient.runTurn` keeps only `stopReason`. Codex sends
cumulative `thread/tokenUsage/updated` totals, which `codexUpdates.ts` maps to `usage_update` with
`_meta.codex.total`; the fold keeps only context used/size.

## 4. The fix, item by item (each with a test that fails first)

0. Logging that would have answered section 1: one JSON line per turn event (start, queued, agent
   frame kinds and counts, permission asked and answered, quiet periods, end or failure with stop
   reason, exit code and the last stderr lines), under `<userStore>/logs/agents-YYYY-MM-DD.jsonl`,
   capped and rotated, never prompt text, answer text or tool bodies, and secrets redacted.
1. The server sends `acp:waiting` on the stream every 10 s while a turn is open, saying what it
   knows (queued behind the previous turn, waiting for approval, a tool running and for how long,
   the bridge quiet for N s, the bridge's process gone). Stop on a cached turn that the bridge does
   not settle within a grace window disposes the process, so the next message is never queued
   behind it. The page sets `stalled` after 40 s without an agent event and words it
   "Waiting on Claude: ...".
2. Send returns exactly when the turn ends, fails or is cancelled: locked with replays of a normal
   end, an error end, a cancel and a bridge exit mid-turn.
3. The server writes each agent turn (the person's message when the turn starts, the answer when it
   ends) into the chat's `chat.json`, and a later chat PUT from the page keeps them.
4. The chat gets a title from the first message (first sentence, at most about six words, no
   filler), refreshed after the first answer while it is still ours; a rename wins.
5. Input, output and cache tokens per turn, summed per chat.
6. The Agents tree shows each step's time, the running step, the slowest step, and "ended without
   an answer" with the reason.
