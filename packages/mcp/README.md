# @sequence/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (stdio) server that
exposes Sequence's static-architecture engine as tools Claude can call. Type
intent in Claude and get a real, deterministic system-design graph back.

It is a **thin wrapper** over already-verified `@sequence/analyzer` functions —
no new engine logic. The keyless tools need no AI key and return real detected
structure; `design_suggest` needs a key and never fabricates without one. No key
ever appears in tool output or errors.

## Tools

| Tool | Input | Output |
| --- | --- | --- |
| `scan_repo` | `{ repoPath, cluster? }` | node/edge counts + the full `ArchGraph` JSON. Repos with no compose/k8s/helm manifest return a calm "no manifests yet" message (not a crash). |
| `who_calls` | `{ repoPath, name, includeImports?, limit? }` | `{ target, counts, omitted, alsoNamed?, note?, answer }` — what calls `name` and what `name` calls, every hit at `file:line`. `name` is a file, a path or path suffix, a **function**, a service or a topic. Keyless. See below. |
| `explain_repo` | `{ repoPath }` | `{ outline, mode }` — a plain-English indented outline (deterministic `structural` mode, no key needed). |
| `plain_tree` | `{ repoPath }` | the full `PlainTreeResult` JSON (structural / keyless). |
| `design_suggest` | `{ description, parentTitle?, repoName?, apiKey?, provider?, model?, baseUrl? }` | `{ nodes, proposed: true }` — proposed plain-English building blocks. Requires a key; with none, returns a connect-a-key message. |
| `classify_repo` | `{ repoPath }` | `{ type, matchedSignals, confidence }` — deterministic product-type classification. Keyless. |
| `validate_diagram` | `{ filePath }` | `{ valid, nodes, edges, kind, title }` on success; schema error list on failure. Keyless. |
| `export_diagram` | `{ repoPath?, graphPath?, format: 'seqd'\|'svg'\|'mermaid', outPath? }` | `{ content, format, source }` (stdout-equivalent) or `{ wrote, format, source }` when `outPath` is set. Never auto-writes into `.sequence/diagrams/`. Keyless. |
| `risks` | `{ repoPath, topN? }` | the logic engine's ranked structural risks — single points of failure, high-blast-radius hubs — each naming its node with a grounded score. Keyless. |
| `impact` | `{ repoPath, node }` | the blast radius of changing one named node: what breaks (`impactedBy`) and what it needs (`dependsOn`), direct and transitive. Ambiguous names return candidates, never a guess. Keyless. |
| `architecture_changed` | `{ beforePath, afterPath }` | what two scans did to the SHAPE of the system at the SERVICE level — connections that appeared or went, components that arrived. Not a graph delta: a file-level diff of a rescan is mostly import churn, and the one edge that crossed a service boundary is lost in it. "The architecture is unchanged" is a real answer and is said plainly. Keyless. |
| `coverage` | `{ repoPath }` | edges seen vs edges in the whole graph, and it NAMES the components that contributed nothing — plus source the scanner could not read at all. A 100% digest over a graph missing an entire service is the more reassuring number and the more wrong one. Keyless. |
| `find_negatives` | `{ repoPath, limit? }` | the four questions a static scan can answer and is rarely asked: a table read by a service that does not own it, a route with no caller, a topic published and never consumed, a product file no test reaches. Absence is reported honestly — no route inventory says so rather than calling every route dead. Keyless. |
| `path_between` | `{ repoPath, from, to, includeImports?, maxPaths?, maxDepth? }` | the actual ROUTE from A to B, every simple path, shortest first — not a set of neighbours. A name that does not resolve is reported as unresolved rather than as "no route", and a list cut by a bound says which bound cut it. Keyless. |
| `map` | `{ repoPath, budget?, focus? }` | the repository as one budgeted text map, the same text as `.sequence/map.md`: services ranked by PageRank with their cross-service edges at file:line, apis and modules, ending with what was omitted. Also a resource, `sequence://map?budget=4000`, for the repo the server runs in (`SEQUENCE_REPO`, else the working directory). Keyless. |
| `whiteboard` | `{ repoPath, outPath? }` | writes ONE self-contained interactive HTML system-design board (default `.sequence/whiteboard.html`): pan, zoom, search, click-a-node evidence. No server, no network — open the file in any browser, from any editor. Keyless. |
| `list_boards` | `{ repoPath }` | the project's drawing boards: the one architecture board (the scanned graph with a drawing layer) and any whiteboards, each with its item count. Keyless. |
| `create_board` | `{ repoPath, name, kind? }` | creates a named whiteboard for a free sketch. The architecture board already exists and is not created. Writes `.sequence/boards/`. |
| `draw` | `{ repoPath, board?, ops }` | adds, updates or removes rectangles, ellipses, arrows, lines, text and sticky notes on a board the open Sequence app shows live. Default board: architecture, where a mark can `anchor` to a node id or name and sit next to that service. Arrows bind `from`/`to` item or node ids. All ops apply or none do; drawings never become nodes. In a Sequence session it is a default tool (with `list_boards` and `create_board`), not behind the "all board tools" setting. |
| `drawings` | `{ repoPath, id?, version? }` | the drawings shown in the chat (SVG and HTML an agent drew inline), kept as project assets in `.sequence/drawings`: with no `id` it lists them (id, title, chat, turn, kind, versions, file name); with an `id` (as in `@drawing:d3`) it reads that drawing, optionally one `version`. Read-only; a drawing is not a board and never becomes a node. |
| `visual` | `{ repoPath, component?, spec?, title?, id?, list?, help? }` | draws a chart or diagram from numbers with one of the built-in svg components (line with forecast, bar, kpi, sparkline, histogram, donut, flow, sequence, load path, timeline, capacity forecast, dashboard): `{ component, spec }` validates the spec and saves the result as a drawing (a repeated `id` adds a version) shown in the open chat. `list: true` names the components, `help: "line"` shows a component's spec. Returns the drawing id. |
| `find_files` | `{ repoPath, query, k? }` | the files a question or task is about, ranked by a model trained on code history, each with a one-line reason and its best lines. Call it before grep or glob when you do not know which file to open. Searches the session's own repository only (a `repoPath` outside it is refused); one shared index host per repository serves every session, and a cold call answers by path words within 250 ms and says the learned ranker is still indexing. Keyless. |
| `edit_workflow` | `{ repoPath, workflow?, create?, ops? }` | lists, creates, or edits a saved workflow in `.sequence/workflows/`: adds, updates, moves or removes blocks (agent, checker, test, loop), the same edits the workflow editor makes; the open editor shows them live. Test blocks take only the four allowlisted commands. All ops apply or none do; a stale `expectedRev` is retried on a fresh read. |

`scan_repo`, `explain_repo`, and `plain_tree` are **keyless** — they run with no
network access and no AI key. `design_suggest` reads its key from the tool's
`apiKey` argument, or from the `SEQUENCE_AI_KEY` environment variable.

## Use it from the editor you already have

Sequence's engine is not tied to the Sequence app. Any MCP client gets the
grounded graph, the risk/impact engine, and the interactive whiteboard with
zero migration:

**Claude Code**
```bash
claude mcp add sequence -- node <path-to>/packages/mcp/dist/server.js
```

**Cursor** (`.cursor/mcp.json` in your project, or global settings):
```json
{ "mcpServers": { "sequence": { "command": "node", "args": ["<path-to>/packages/mcp/dist/server.js"] } } }
```

**Codex / any stdio MCP client**: run `node packages/mcp/dist/server.js` as a
stdio server; every tool above self-describes.

Then, from your own chat: *"call the sequence whiteboard tool on this repo"* —
and open `.sequence/whiteboard.html`. The system-design board is created right
away, interactable, and grounded in a real scan; no account, no key, no switch.

## Install & build

```bash
pnpm install
pnpm --filter @sequence/mcp build
```

This produces `dist/server.js`, the executable exposed as the `sequence-mcp` bin.

## Claude / MCP client config

Point your MCP client at the built server. Either use the `sequence-mcp` bin (if
the package is linked / installed globally):

```json
{
  "mcpServers": {
    "sequence": {
      "command": "sequence-mcp"
    }
  }
}
```

…or invoke the built file directly with node (use the absolute path to your
checkout):

```json
{
  "mcpServers": {
    "sequence": {
      "command": "node",
      "args": ["/absolute/path/to/codeforge/packages/mcp/dist/server.js"]
    }
  }
}
```

To enable `design_suggest`, add your AI key to the server environment:

```json
{
  "mcpServers": {
    "sequence": {
      "command": "node",
      "args": ["/absolute/path/to/codeforge/packages/mcp/dist/server.js"],
      "env": { "SEQUENCE_AI_KEY": "sk-..." }
    }
  }
}
```

The key is placed only into the provider request; it is never logged, echoed, or
returned in any tool output or error.

## `who_calls` — the reason to run this server

`scan_repo` returns the whole graph: **megabytes of JSON on this monorepo** — enough
to exceed a 200k context window on its own (do not treat any fixed "N tokens" figure as
stable; the graph moves with the tree). `who_calls` answers the specific question instead,
and carries the file and line that justify every edge.

Measured on this monorepo (2026-08-19):

| question set | `who_calls` |
| --- | --- |
| "who imports X", 12 busiest files | 100% recall (518 of 518 importers), reproduced independently |
| "who calls function X", 6 symbols | 5 of 6 answered from the call graph |

**No comparison against `rg` is published here, and that is deliberate.** Two numbers
that were in an earlier draft did not survive review and are retracted rather than
softened:

- *"100% precision"* is **circular**. `who_calls`' callers ARE the graph's in-edges to
  the resolved node, so precision measured against that same graph can only ever come
  back 100%. It measures nothing.
- *"`rg` scores 90.1%"* is **not reproducible**. It depends entirely on the `rg`
  invocation chosen; an independent reviewer's naive `rg -l` scored 18.2% on the same
  questions. A number that moves that far with the flags is not a property of `rg`.

The honest claim is qualitative and does not need a benchmark: `who_calls` answers from
the call graph, so it does not report an identifier appearing in a comment, a string or
an unrelated declaration, and it does not miss a caller that reaches the target through
a re-export. Recall above is a real measurement; treat everything else as unmeasured
until a harness lands in the repo that anyone can re-run.

The mechanism, which needs no benchmark to state: a name is borne by several files
here (`store.ts` by three, `index.ts` by fourteen), and a text match cannot tell which
one a given import resolves to. `who_calls` reads the resolved graph, so it can.

Three things it will never do silently:

- **Ambiguity** — a name several files share resolves to the most-connected one and
  reports the rest in `alsoNamed`. Pass a path (`packages/web2/src/state/store.ts`) to pick.
- **Truncation** — `omitted` counts what the cap withheld. Default cap 200 per
  direction; raise it with `limit`.
- **Scope** — a symbol miss returns a `note` saying the symbol index covers function
  *definitions* only, so "not found" is a statement about the index rather than a
  false statement about your repo. Constants and types are not in it yet.

The function-level answer needs a function graph, which costs a full re-parse
(~3.1 s here). It is built lazily — only when the file graph has no answer — and
cached in `.sequence/functions.json` alongside the arch cache, keyed on the same
`scannedAt`. Cold builds cost seconds and warm reads cost tens of milliseconds; two
independent runs on this machine differed enough (3.9 s / 155 ms and 3.1 s / 76 ms)
that no single figure is published here.

## Notes

- stdio is the JSON-RPC channel: the server writes only protocol frames to
  stdout and sends any diagnostics to stderr.
- Structure is always deterministic and real. `design_suggest` proposals are
  explicitly marked `proposed: true` — a design, not a scan.
