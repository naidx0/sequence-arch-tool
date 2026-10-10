# Sequence code map (Wave 8)

Grounded, interactive map of the Sequence monorepo primary modules.

## Files (regenerate together)

| File | Purpose |
|------|---------|
| `codemap.html` | Self-contained interactive viewer (search, filter, zoom, flows, hover tooltips) |
| `codemap.json` | Full nodes, edges, and E2E flows with source evidence |
| `codemap.lock` | Commit SHA, dirty flag, and deterministic module fingerprints |
| `agent-graph.json` | Slim `{nodes, edges, flows}` projection for AI agents (tweet/archify shape) |

Never edit one file alone — all four must stay in sync with each other.

## Open the map

Open `codemap.html` in any browser (double-click, drag-and-drop, or `file://` URL). No build step required.

```bash
# From repo root — any static file server also works
xdg-open docs/codemap/codemap.html   # Linux
open docs/codemap/codemap.html       # macOS
```

## Give agents the graph

- **`agent-graph.json`** — preferred for other AI agents: slim nodes (id, label, path, role, summary), edges, and flows with steps only.
- **`codemap.json`** — full graph with evidence, entrypoints, tests, and constraints when an agent needs provenance.

## Validate

```bash
node -e "JSON.parse(require('fs').readFileSync('docs/codemap/codemap.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('docs/codemap/agent-graph.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('docs/codemap/codemap.lock','utf8'))"
```

Relationships without source evidence are marked `unknown` in `codemap.json`.
