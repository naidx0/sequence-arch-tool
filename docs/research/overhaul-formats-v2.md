# Overhaul formats v2: ontology, board view state, map.md, agent events

Copied from the Sequence Build Spec, Part 3 (project coordinator, 2026-10-05). Streams build against
this file. Where existing code already differs, keep whichever is simpler and note it in
`lab/handoff.md`. Everything is additive: a version 1 graph still loads.

## 3.1 Ontology v2 (schema) — stream 3

`Graph.version = 2`. Readers accept 1 and 2; writers emit 2.

New node kinds (added to NodeKind):

| kind | id | parentId | made from |
|---|---|---|---|
| `api` | `api:<svcId>:<METHOD> <pathPattern>` (gRPC: `api:<svcId>:<Service>/<Method>`) | the providing service | `routes[]` and proto services the scan already collects |
| `external` | `ext:<host-or-sdk>` (e.g. `ext:api.stripe.com`, `ext:s3`) | none | client calls and connection strings whose target is not a scanned service (detectHttp unmatched URLs, detectConnections, known SDK imports) |

New optional fields:
- ArchNode: `tags?: string[]` (framework, language, folder role, CODEOWNERS team), `owner?: string`
  (CODEOWNERS), `status?: 'live' | 'added' | 'removed' | 'changed'` (diff view only).
- ArchEdge: `apiId?: string` (the api node an http/grpc edge lands on; dstId stays the service so old
  readers keep working), `external?: true`.
- Edge kinds unchanged. Containment stays `parentId`, never an edge.

Tests: v1 fixture loads unchanged; every matched http edge on shopfront gets an apiId; every
unmatched outbound URL becomes exactly one ext node; no ext node for a host that is a scanned service.

## 3.2 Board view state (composite board, Nx style) — stream 3

```ts
interface BoardViewState {
  view: 'map' | 'flow' | 'grid' | 'diff' | 'hotspots';
  expanded: string[];      // node ids opened in place (nested), default []
  focus?: string;          // node id; with proximity, shows only its neighbourhood
  proximity: 1 | 2 | 3;    // hops around focus, default 1
  hidden: string[];        // ids hidden from the sidebar
  showImports: boolean;    // default false
  dir: 'LR' | 'TB';        // default LR
  agentOverlay: boolean;   // default true while any agent is running
}
```

- Serialized to the URL hash as bare tokens so it survives reloads and can be shared:
  `#map.f-svc_orders.p1.x-svc_orders+svc_payments`.
- Budget rule: at most 50 visible boxes. Expanding a node that would pass 50 first collapses the
  least recently expanded sibling; anything still over rolls into a `+N` chip in that group.
- Edge lifting: an edge whose endpoints are hidden inside collapsed groups is drawn between their
  nearest visible ancestors. Lifted edges with the same (src, dst, kind) merge into one line with
  `count` and the union of evidence. Clicking a lifted line lists its underlying edges with
  file:line.
- Default landing: `view=map`, nothing expanded, imports hidden: services, stores, topics, externals.
- Layout: elkjs layered with `elk.hierarchyHandling: INCLUDE_CHILDREN`, two-pass (render, measure,
  layout), worker, animated transition between states.

Tests: never more than 50 boxes after any expand sequence on codeforge; lifted edge count equals
the sum of underlying edges; hash round-trips.

## 3.3 map.md (agent-readable map) — stream 2

Command: `sequence map --budget 4000 [--focus svc:orders]` writes `.sequence/map.md`. MCP: resource
`sequence://map?budget=4000` and tool `map(budget, focus?)`.

Grammar (one line per item, parseable back; round-trip test required):

```
# map <repoName> · scanned <ISO time> · budget <n> · <S> services <E> edges
<svcLabel> (<language>, <framework>) [<tag>, ...]
  -> <dst>  <http|grpc> <detail>  <file>:<line>
  => <topic>  publish  <file>:<line>
  <= <topic>  consume  <file>:<line>
  ~> <datastore>  <read|write> <table>  <file>:<line>
  apis: GET /orders/*, POST /orders
  modules: <label> (<n> files), ...
omitted: <k> services, <m> edges. Ask with neighbors(<id>) or path(<a>,<b>).
```

Budget algorithm:
1. Rank services by summed PageRank of their files.
2. Add services in rank order, each with its cross-service edges first (sorted by confidence, then
   kind), then apis, then modules, while the token count stays under budget (gpt-tokenizer o200k if
   it is already a dependency; otherwise chars/4).
3. Always end with the `omitted:` line.

Also write a 6-line block for AGENTS.md / CLAUDE.md that points at `.sequence/map.md` and names the
MCP tools.

A/B (pre-registered): same local agent, same 36 sealed questions, 2 runs per arm, map.md at 4k vs
current. Baseline F1 0.21. Keep only if above 2.5 SE.

## 3.4 Agent events — stream 2

Route: `POST /api/agent-event` accepts a Claude Code hook payload unchanged (`session_id,
transcript_path, cwd, hook_event_name, tool_name, tool_input, tool_response, agent_id?,
agent_type?`). ACP and Codex app-server events go through the same normalizer in-process.

```ts
interface AgentEvent {
  id: string; at: number;
  source: 'claude-hook' | 'acp' | 'codex';
  sessionId: string; agentId?: string; parentAgentId?: string;
  kind: 'session_start' | 'tool_start' | 'tool_end' | 'subagent_start' | 'subagent_stop' | 'stop';
  tool?: string; toolKind?: 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'think' | 'other';
  paths: string[];          // repo-relative, from tool_input.file_path / ACP locations / Codex fileChange
  status: 'running' | 'done' | 'failed';
}
```

- Path to board: file node by path, then up through parentId to module and service. Touched edges =
  edges whose evidence file is that path.
- `GET /api/agent-events` (SSE) streams events to the board, roster, tree and timeline. The
  AgentNode tree is built from these events.
- Reply to PostToolUse (Edit|Write|MultiEdit) with `hookSpecificOutput.additionalContext` only when
  the file sits on a cross-service edge, max 600 characters, from the graph only. Example:
  "orders/app/db.py is in service orders. It writes table orders (orders/app/db.py:22). payments
  reads that table (payments/src/ledger.js:8)."
- Hook config: passed per session with `--settings <file>` when Sequence launches Claude Code. Never
  edit the user's own settings.json. PostToolUse is synchronous (returns context). SessionStart,
  SubagentStart/Stop, TaskCreated/Completed and Stop are `async: true`.
- SessionStart reply: `additionalContext` = the first 1k tokens of map.md.

Tests: a scripted session of 20 edits produces 20 highlights; p95 hook to highlight under 1 s; no
additionalContext for a file with no cross-service edges; the user's settings.json is byte-identical
after a session.
