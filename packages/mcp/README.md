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
| `whiteboard` | `{ repoPath, outPath? }` | writes ONE self-contained interactive HTML system-design board (default `.sequence/whiteboard.html`): pan, zoom, search, click-a-node evidence. No server, no network — open the file in any browser, from any editor. Keyless. |

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
