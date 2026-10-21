# Generative UI in Sequence (`feat/genui`)

The agent draws live, interactive cards in the chat instead of describing them. The cards come from
a fixed catalog, are checked against a strict schema, render while the agent is still writing,
animate as they change, fix themselves where they can, and send clicks back to the agent.

This is a prototype. Everything below runs and is tested, but the app's server route
(`/api/genui/*`) and the ACP bridge for clicks are not wired yet (see "What is left").

```
agent ──JSONL ops──▶ SpecStream ──▶ lossless autoFix ──▶ validate ──▶ GenUISurface (motion)
  ▲                    (partial JSON,     (aliases, enums,     (zod, strict;     │
  │                     line repair)       coercions)           streaming|final) │ click
  │                                                                │             ▼
  └──── ui.diagnostics (numbered issues) ◀── repair loop ◀── errors   buildAction ─▶ ui.action
        agent replies with patch ops         (≤2 rounds, then lossy fallback)        (allowlisted)
```

## Packages and files

| Path | What it is |
|---|---|
| `packages/genui/src/catalog.ts` | The catalog: 18 components, each a `.strict()` zod schema (`Card`, `Stack`, `Heading`, `Text`, `Badge`, `StatusLine`, `Timeline`/`TimelineItem`, `Progress`, `Metric`, `Checks`/`Check`, `FileList`, `Diff`, `KeyValue`, `Callout`, `Actions`/`Button`), allowed children, tone and status enums, known aliases. |
| `packages/genui/src/types.ts` | `UISpec` (a flat element map), `UIOp`, `Issue`, `Fix`, `UIAction`, `UIDiagnostics`. |
| `packages/genui/src/stream.ts` | `SpecStream`: takes text chunks of any size and applies each complete line. `preview()` draws the line still being written, but only for `el` ops. |
| `packages/genui/src/partialJson.ts` | `parsePartialJson` (closes an open object so it can be drawn) and `repairJson` (fences, comments, trailing commas, single quotes, bare keys, Python literals). |
| `packages/genui/src/ops.ts` | `normaliseOp` and `applyOp`: RFC 6902 `add/replace/remove` plus the shorthand ops `el`, `set`, `status`, `merge`, `append`. |
| `packages/genui/src/validate.ts` | `validateSpec(spec, 'streaming' \| 'final')` and `diagnosticsPrompt`. |
| `packages/genui/src/repair.ts` | `autoFix` (lossless, or lossy when asked) and `repairSpec` (the loop). |
| `packages/genui/src/prompt.ts` | `catalogPrompt()`: the catalog, rules and op format for the system prompt or tool help, generated from the zod schemas so it cannot drift from them. |
| `packages/genui/src/actions.ts` | `buildAction` (the click gate) and `actionToPrompt`. |
| `packages/web2/src/genui/session.ts` | `GenUISession`: one session per turn. It folds agent events into surfaces, coalesces renders to one per animation frame, runs the repair when a pass ends, and gates clicks. |
| `packages/web2/src/genui/GenUISurface.tsx` | The renderer. A registry of 18 components, a per-node error boundary, skeletons, the repair strip, and motion. |
| `packages/web2/src/genui/motion.ts` | `ENTER` and the other 8.6 timings, `useEnter`, `useAutoHeight`, `useFlip`, `useSwap`, `useTween`, `flash`, and `reducedMotion()`. |
| `packages/web2/src/genui/agent.ts` | The `GenUIAgent` interface, `Emitter`, and `HttpAgent` (SSE plus POST). |
| `packages/web2/src/genui/mockAgent.ts` | A scripted agent that makes realistic mistakes on purpose, so every repair path shows up. It needs no API key. |
| `packages/web2/src/genui/surfaceStore.ts` | The client of `/api/genui/surfaces`: `listChatSurfaces(chatId)`, `saveChatSurface`, and `persistSettled(chatId, turnId)` (the `onSettled` for a `GenUISession`). |
| `packages/web2/src/genui/GenUISavedSurface.tsx` | Draws one saved surface: no entry animation, buttons off (`restoredView` in `session.ts`, `StillContext` in `motion.ts`). |
| `packages/web2/src/genui/GenUIFence.tsx` | The ` ```genui ` fence in chat messages. It is wired in `chat/ProseMessage.tsx`. |
| `packages/web2/src/genui/genui.specimen.html` | A dev page for the full demo. |
| `packages/mcp/src/genuiTools.ts` | The MCP `ui` tool, which validates the agent's ops and returns diagnostics as `isError`. |

## Wire format: one JSON op per line

```jsonl
{"op":"el","id":"card","type":"Card","props":{"title":"Upgrade auth","badge":"Running","tone":"info"},"children":["tl","acts"]}
{"op":"el","id":"tl","type":"Timeline","children":["plan"]}
{"op":"el","id":"plan","type":"TimelineItem","props":{"title":"Plan the change","status":"running"}}
{"op":"el","id":"test","type":"TimelineItem","props":{"title":"Run tests","status":"running"},"parent":"tl"}
{"op":"set","path":"/elements/plan/props/status","value":"done"}
{"op":"add","path":"/actions/fix","value":{"description":"Fix the two failing tests"}}
{"op":"el","id":"fixbtn","type":"Button","props":{"label":"Fix failures","action":{"name":"fix"},"variant":"primary"},"parent":"acts"}
```

- **`el`** creates or updates an element. A second `el` with the same id and type merges its props, which is how
  progress moves. `parent` appends the element to that parent's children. The first element becomes the root.
- **`set`, `add`, `replace`, `remove`** are JSON Pointer patches on the spec. `remove` also unhooks the element
  from its parents.
- **`state` and `{"$state":"/ptr"}`** bind a prop to the surface's data model.
- **Actions** must be declared under `/actions/<name>` before a button can fire them. That declaration is the allowlist.

The format is flat on purpose. With a flat map, each line is complete and drawable on its own, a later line
can refer to an id that does not exist yet (it shows as a skeleton until it arrives), and a fix is
a one-line patch. A2UI's adjacency list and json-render's SpecStream make the same choice.

## The rules (why the output is always valid)

1. **Strict schema.** Unknown components and unknown props are rejected, never passed through. Every prop has a type,
   an enum, or a pattern.
2. **Two validation phases.** In `streaming`, a missing child or an undeclared action is a warning, because it may still
   arrive. In `final`, every issue counts.
3. **Nothing invalid reaches the screen.** The renderer draws only elements that validate. An element whose in-flight
   update is invalid keeps its last valid version. An element that never validated shows as a skeleton.
4. **Three repair tiers, in order:**
   - **Lossless fixer** (`autoFix`). It applies type aliases and case fixes (`card` → `Card`, `ProgressBar` →
     `Progress`), prop synonyms (`total` → `max`), enum synonyms (`completed` → `done`, `red` → `danger`), number,
     boolean and string coercions, a string action → `{name}`, child dedupe, and choosing the root. These fixes are
     written back into the committed spec, so they are not lost on the next merge.
   - **Agent round.** Whatever the fixer cannot settle goes back to the agent as numbered diagnostics
     (`[UNKNOWN_COMPONENT] /elements/trend/type: …`). The agent answers with patch ops. There are at most 2 rounds.
     This is the same pattern as Cursor's canvas diagnostics and json-render's advice to prefer re-prompting over
     lossy fixes.
   - **Lossy fallback.** If an issue is still open after that, the fallback applies: an unknown component becomes
     `Text`, a button with an undeclared action is disabled, missing children are pruned, and cycles are cut. Each
     fallback is logged as a fix with `lossy: true`.
5. **The repair is visible.** Repairing nodes get a "Fixing" chip and a soft overlay. A fixed node flashes in the accent role (fixer)
   or the done role, `--fits` (agent). The strip under the card counts "N auto, N by agent, N fallback" (separate chips, no middle dot), and opens into the full log.
6. **Per-node error boundary.** A component that throws drops just that node to a text fallback. It resets when the
   element changes.

## Limits and what never renders

- **8 surfaces a turn, 200 elements a surface** (`GENUI_LIMITS`, `packages/genui/src/limits.ts`). `SpecStream` drops any op
  that would make a 201st element (an update to an element that exists, or a removal, still lands, so a full card can
  be finished) and reports one `LIMIT_EXCEEDED` issue per chunk with the count and a hint ("summarise instead").
  The session drops the ninth surface of a turn and logs it once. The `ui` tool tells the agent in its reply
  (`DROPPED: ...`). The server holds the same lines on save. Chunk size never changes the result (tested).
- **No agent HTML in the inline renderer.** Every text prop is a React text node; `genuiNoHtml.test.tsx` scans the
  renderer sources for HTML sinks (`dangerouslySetInnerHTML`, `innerHTML`, `srcDoc`, iframes) and renders markup-laden
  props as literal text. UI outside the catalog is a later, separate tier (MCP Apps in a sandboxed iframe).

## Streaming and live updates

- Chunks of any size give the same result. A test runs the same script in chunks of 1, 3, 7 and 64 characters.
- The line in flight is previewed (closed by `parsePartialJson`), but only `el` previews are drawn. A partial `set`
  could show "18 of 1" for a moment, so it waits for its line to finish.
- The session coalesces renders to one per animation frame, the pattern of Cursor's `partialToolCallCoalescer`.
- When a pass ends (`ui.end`), the session settles it: it applies the lossless fixes, runs the agent round, applies
  the fallback, and replays anything that arrived meanwhile.

## Skin: the app's own, and a test keeps it so

A generated card is drawn from what Sequence already has (`genui.css`, locked by `genui.css.test.ts`):

- **Card**: the agent thread's card (`.s2-agcard`) in the glass medium: `--glass-pane-fill` and the `--glass-inset` edge light, a `--edge` hairline, a 16px radius, no backdrop blur (a blur over the scrolling transcript flickers on Windows). Full reading-column width. Inside it there are rows, not boxes: the card body's nodes are padded rows with a `--edge-faint` hairline between them, a timeline is plan rows edge to edge (bare glyph, title, mono duration at the far end), files are hairline rows, a diff is one soft field with tinted lines, a metric is a label and a figure on one row, a callout is the tone's wash with no frame. The only borders are the card frame, the head and row hairlines, and the read-only chip.
- **Buttons**: the app's kit, no new type (Decision 51). `BUTTON_CLASS` in `GenUISurface.tsx`: primary `s2-btn s2-btn-sm s2-blue`, secondary `s2-btn s2-btn-sm`, danger `s2-btn s2-btn-sm s2-danger`, ghost `s2-chipbtn`.
- **Tone** is one meaning per colour (HANDOFF-UX 8.3): info and accent are `--accent`, success is `--fits`, warning `--spills`, danger `--wont`. `merged` has no colour in the app (purple is Teach mode), so it uses `--fits`. Prose is never accent-coloured.
- **Icons**: every status mark is `S2Icon`, the `.s2-ring` the plan rows use for "not yet", or `AsciiSpinner`. Nothing is drawn here. `S2Icon` has no alert glyph, so a warning is `bell`, the closest the set has. A badge is the status word with a glyph only for success, warning and danger; no pill.
- **Type and space**: `--font-ui`, the `--t-*`, `--fw-*` and `--sp-*` scales; mono with tabular figures for paths, diffs, counts and durations, as the tool rows have them.
- **Charts**: `Progress` fills neutral, on the `--edge-faint` track the chart bars use (the bar is `--ink-3` until it has a verdict: neutral by default, accent only for the primary action). A real chart would reuse `charts/SeqChartView`; the catalog has none.
- **Rules the test enforces**: no hex, `rgb()` or `hsl()` literal, no `var(--x)` that `tokens/graphite.css` or `genui.css` does not define, no infinite animation, and, in `genuiSkin.test.tsx`: the border allowlist above, a glass card with no blur, no surface plates inside, the app's type only, tabular mono figures, S2Icon-only marks, no middle dot (the busy label is the shared `.shimmer-text`, the busy mark is `AsciiSpinner`).

## Motion

All motion uses WAAPI with the app's motion spec (HANDOFF-UX 8.6): enter 180ms on `cubic-bezier(0.2, 0.8, 0.2, 1)`, height changes 200ms, cross-fades 120ms, counted numbers 240ms. Under `prefers-reduced-motion`, every hook skips straight to the end state.

| Hook | Used for |
|---|---|
| `useEnter` | A new node rises in from 4px with a fade. Siblings are staggered by 45ms (up to 8). |
| `useAutoHeight` | The card and each body animate `height:auto` with a ResizeObserver and a clipped overflow. |
| `useFlip` | Children reordered or inserted slide into place. Positions come from offsets, not transformed rects, and the slide is applied through the `translate` property, so an interrupted slide resumes instead of jumping. |
| `useSwap` | A short cross-fade when a status line or badge text changes. |
| `useTween` | Counts such as `36 of 42` tick to their new value. |
| `flash` | Marks a node that a fix just changed. |

## Interaction round-trip

A click on a generated `Button` runs `buildAction`. It fires only if the action is declared on the surface, the
button is not disabled, and the agent is not mid-turn (unless the action is declared `whileBusy`). Params bind to
state at click time. `confirm` makes it a two-step click. A refused click shows its reason as the button's
title. An accepted click sends `ui.action {surfaceId, elementId, name, params}` to the agent, and the button
shows a spinner until the agent's turn ends. `actionToPrompt` turns the action into a message for agents that
only take text.

## Saved with the chat

A surface that settles is saved with its chat: the FINAL spec, not the op stream, keyed by chat, turn and surface
(`analyzer/src/server/genuiStore.ts`, `.sequence/genui/c-<chat>.json`; `GET`/`POST /api/genui/surfaces`). The session
calls `onSettled(surfaceId, spec)` after a pass passes the strict check; the chat wires
`new GenUISession(agent, { onSettled: persistSettled(chatId, turnId) })` (one session per turn, so the same surface
id on two turns does not collide).

- **The server stores nothing that would not draw.** The spec must pass `validateSpec(spec, 'final')`, stay inside
  200 elements and 200 KB, and a turn keeps at most 8 surfaces. A chat keeps its newest 300. The same
  (turn, surface) replaces itself, so the last settle wins. The file is re-checked row by row on read.
- **A reload draws the stored spec once** (`GenUISavedSurface`): no entry animation (`StillContext` turns every
  motion hook off), no repair strip, and every button disabled with the title "This turn has finished".
  The renderer validates each node again, so an edited file shows skeletons, not junk.
- **For other panels.** `listChatSurfaces(chatId)` returns the chat's saved surfaces, oldest first (`[]` when there
  are none, the chat id is not one the server can hold, or the request fails): `{ chat, turn, surface, saved, title, spec }`.
  The overview's "saved artifacts" list reads `title` and `turn` for a row and renders `spec` with `GenUISavedSurface`.

### The chat's half (`chatActions.ts`, `chatSurfaces.tsx`)

Wired. V3Chat holds the listener below (test: `v3/genuiClicks.test.tsx`) and one `ChatGenUI` per open chat (`chatSurfaces.tsx`): its events stream is open while a turn runs, each card lands at the running turn (`<TurnSurfaces turnId />`, mounted at an agent run's foot and at assistant messages), `persistSettled` saves it, and `listChatSurfaces` puts saved ones back. The listener, next to `boardSendRef`:

```tsx
import { announceGenUITurn, createChatActionHandler, listenForGenUIActions } from '../genui/chatActions';

const busyRef = useRef(busy);
busyRef.current = busy;
/* A queued or steered click: the same path Enter-while-busy takes (composerKeyIntent 'steer'). */
const steerGenui = (text: string): void => {
  const r = runsState.runs.find((x) => x.status === 'running' && x.sessionId === state.session.activeId && x.agentRef);
  if (!r) { promptQueue.add(queueKey, text); return; }
  const sessionKey = r.nodeId ? `ask-node::${r.nodeId}::${r.agentRef}` : `chat::${r.sessionId ?? 'none'}::${r.agentRef}`;
  void import('../composer/steerClient').then(async (m) => {
    const sent = await m.steerOrQueue({ queueKey, sessionKey, text });
    if (sent.kind === 'steered') agentRuns.addSteer(r.id, text);
  });
};
const steerGenuiRef = useRef(steerGenui);
steerGenuiRef.current = steerGenui;
const genuiActions = useMemo(
  () => createChatActionHandler({ isBusy: () => busyRef.current, send: (t) => boardSendRef.current(t), steer: (t) => steerGenuiRef.current(t) }),
  [],
);
useEffect(() => listenForGenUIActions(genuiActions), [genuiActions]);
useEffect(() => {
  announceGenUITurn(busy);
  if (!busy) genuiActions.turnEnded();
}, [busy, genuiActions]);
```

`handle` answers `sent`, `steered`, `duplicate` (a double click), `busy` (not `whileBusy`, dropped) or `invalid`. The fence's agent turns
`announceGenUITurn` into the session's `turn` event, which is what clears the clicked button's spinner.

## Running it

```bash
pnpm --filter @sequence/genui build && pnpm --filter @sequence/genui test   # 18 core tests
pnpm --filter @sequence/web2 exec vitest run src/genui                      # 5 render and session tests
pnpm --filter @sequence/mcp build && node --test packages/mcp/dist/test/genuiTool.test.js
pnpm --filter @sequence/web2 dev
# then open http://127.0.0.1:5174/src/genui/genui.specimen.html
#   ?auto=1     clicks Fix -> Open PR -> Merge by itself
#   ?speed=2    plays faster
#   ?theme=dark uses the dark theme
#   ?log=0      hides the protocol log
#   ?agent=http uses the real-agent hook (needs the server route below)
```

## Wiring a real agent (Claude Code, Codex, or an API model)

There are three hooks. They share one pipeline, so an agent can use whichever its harness supports.

1. **MCP tool `ui`** (`packages/mcp/src/genuiTools.ts`, registered in the full tool list). This is the best path for
   Claude Code and Codex through the Sequence MCP server:
   - `ui({help:true})` returns `catalogPrompt()`.
   - `ui({surface, ops})` applies ops and reports the fixes it made.
   - `ui({surface, done:true})` validates strictly. Remaining errors come back as `isError` with numbered
     diagnostics, so the agent's next call is the patch. Its own model loop is the repair round.
   - When `SEQUENCE_GENUI_URL` is set, each accepted batch is POSTed there as `{surface, ops, done}`.

   `ui` is in `CORE_TOOLS`, so every session Sequence starts lists it (about 120 tokens: four fields and a one-line
   description that points at `ui({help:true})`; the core budget in `s2a-session.test.ts` stays at 3.32k: the longest core descriptions were tightened to fit
   it). The ask belt carries `GENUI_RULES_SECTION` (`askPipeline.ts`, after the inline-art rules): when to draw a card,
   when not to, and to call `ui({help:true})` once per session. The catalog itself is never pasted into a prompt.

2. **A ` ```genui ` fence** in the agent's message (`GenUIFence.tsx`, `ProseMessage.tsx`). This works with any
   agent that writes markdown. Add `catalogPrompt()` to the system prompt or to INLINE-ART-RULES. While the message
   streams, the fence draws live. When the fence closes, the pass settles with the lossless fixer and the fallback,
   because there is no agent to ask mid-message. A click raises the window event
   `sequence:genui-action` (`detail: {action, prompt}`). The chat should send `prompt` as the next user turn, or
   inject it with ACP `steer`.

3. **`HttpAgent`** (`agent.ts`), for a server-run agent loop such as the Anthropic or OpenAI API, or the Codex
   app-server:
   - `GET /api/genui/events?session=` is an SSE stream of `AgentToUI` events (`ui.text` for raw JSONL from the
     model, `ui.ops` for parsed ops, `ui.end`, `turn`, `say`).
   - `POST /api/genui/turn {session, prompt}` starts a turn.
   - `POST /api/genui/action {session, action}` sends a click. The server appends `actionToPrompt(action)` as a
     user message.
   - `POST /api/genui/repair {session, diagnostics}` returns `{ops}` or `{text}`. The server sends
     `diagnostics.prompt` to the model and returns its reply.

   The analyzer serves these (`packages/analyzer/src/server/genuiRoutes.ts`, registered in `repoServer.ts`):
   - **The session** is the chat id. A chat opens `events?session=<chat id>`; a turn launched for that chat gives its
     agent's MCP server `SEQUENCE_GENUI_URL=http://127.0.0.1:<port>/api/genui/ingest?session=<chat id>&key=<key>`
     (`sequenceMcp.ts` `genuiUrl`, set in `runNodeRoutes.ts` for Claude over ACP and Codex). The `ui` tool posts
     `{surface, ops, done}` there; the hub turns that into `ui.ops` and, when `done`, `ui.end` on the chat's stream.
     A surface that has not finished is replayed to a stream that connects mid-pass; a finished one is not.
   - **`ingest`** takes no cookie (the MCP process has none): it needs the per-process key, a loopback peer and an
     allowed origin. `events`, `turn`, `action`, `repair` are session-gated under auth.
   - **`turn`, `action`, `repair`** are answered by a `GenuiRunner` (none is attached by default, so a turn answers
     `{accepted: true, runner: false}` and `repair` answers 501, which the client reads as "use the fallback").
     `action` always returns the `actionToPrompt` text it would send.
   - `ui.text` is only produced by a runner that streams model text; the MCP path sends parsed ops.

## What is left

- Attach a `GenuiRunner` for an API-model loop (the routes and the hub are done; `turn`, `action` and `repair` have
  no runner yet).
- Treat MCP Apps (sandboxed iframes) as a separate, later tier for UI outside the catalog. Never render agent HTML
  inline.
