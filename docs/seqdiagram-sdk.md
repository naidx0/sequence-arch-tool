# SeqDiagram SDK

SeqDiagram is Sequence’s **intermediate representation (IR)** for grounded architecture diagrams: a small, typed JSON document between the live **ArchGraph** (what the scan found in your repo) and the views you share — Structural SVG, Mermaid text, chat chips, and CLI exports. It is not Mermaid, not the scan itself, and not a hand-drawn picture; it is the portable slice you can validate, diff, and re-render while every node id still traces to graph evidence.

## Pipeline

```
scan / design  →  ArchGraph (source of truth: nodes, edges, evidence)
                      ↓
                 SeqDiagram (.seqd)   ← format (JSON body, .seqd extension)
                      ↓
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
 Structural SVG   Mermaid text   Agents / CLI / chat
 (brand view)     (interop)      (validate / edit)
```

`.seqd` files do **not** assemble into the main architecture graph. The graph comes from the repo scan (or a design draft). A diagram file is an **overview or slice** of that graph you save, share, and render again.

## On-disk file

Grounded diagrams live in the attached repo at:

```
.sequence/diagrams/<name>.seqd
```

- `<name>` is a slug (e.g. `checkout-flow`, `shopfront-overview`).
- The extension `.seqd` marks SeqDiagram v1; the body is **JSON** (not Mermaid, not SVG).
- JSON Schema: `packages/schema/schemas/seqdiagram-v1.json`.

## Minimal valid example

```json
{
  "version": 1,
  "kind": "service-sequence",
  "title": "Checkout request path",
  "grounded": {
    "graphId": "shopfront",
    "repoPath": "/path/to/repo",
    "origin": "export"
  },
  "nodes": [
    { "id": "svc:gateway", "label": "gateway", "kind": "service", "role": "participant" },
    { "id": "svc:orders", "label": "orders", "kind": "service", "role": "participant" }
  ],
  "edges": [
    {
      "id": "e:gateway-orders-http",
      "from": "svc:gateway",
      "to": "svc:orders",
      "family": "http",
      "label": "POST /orders"
    }
  ]
}
```

Run `sequence diagram validate` on the file before committing; optional fields (`theme`, `layout`, `projections`, `meta`, node `detail`, edge `evidenceRef`) extend the core without changing validity.

## Required fields

| Field | Type | Rules |
|-------|------|--------|
| `version` | `1` | Must be exactly `1`. |
| `kind` | string | One of: `service-sequence`, `service-flow`, `package-map`, `agent-workflow`, `function-path`, `breakout-interior`. |
| `title` | string | Non-empty human title. |
| `grounded` | object | Must include `graphId` (non-empty string). Links the diagram to its source ArchGraph. |
| `grounded.graphId` | string | Required. |
| `nodes` | array | Each node requires `id`, `label`, `kind` (see schema for allowed kinds). Ids must be unique. |
| `edges` | array | Each edge requires `id`, `from`, `to`, `family` (`http`, `grpc`, `queue`, `db`, `import`, `call`, `control`). `from` / `to` must reference existing node ids. Ids must be unique. |

Common optional fields: `grounded.repoPath`, `grounded.scopeNodeIds`, `grounded.origin`, `theme` (`structural` \| `macos-dark`), `layout`, `projections.mermaid` (derived, never authoritative), `meta`.

### Agent workflow nodes (`kind: agent-workflow`)

On `agent-workflow` diagrams, nodes with `kind: agent` may carry an `agent` prompt pack:

| Field | Type | Rules |
|-------|------|--------|
| `agent.prompt` | string | **Required** on `kind: agent` when diagram `kind` is `agent-workflow`. |
| `agent.agentRef` | string | Optional ACP agent id when `runtime` is `acp`. |
| `agent.scopeFiles` | string[] | Optional repo-relative paths this agent may touch. |
| `agent.runtime` | `gateway` \| `acp` | Optional; defaults to gateway. |

Workflow diagrams may persist under `.sequence/workflows/<slug>.seqd` (same JSON body as `diagrams/`).

Full types and validator: `@sequence/schema` (`SeqDiagramV1`, `validateSeqDiagram`, `compileSeqDiagramToProgram`).

## CLI

```bash
# Validate a .seqd file (exit 0 = valid, 2 = invalid)
sequence diagram validate .sequence/diagrams/checkout-flow.seqd

# Export from frozen ArchGraph JSON (stdout by default)
sequence diagram export archgraph.json --format seqd
sequence diagram export archgraph.json --format svg
sequence diagram export archgraph.json --format mermaid

# Export from a live repo scan
sequence diagram export --repo ./my-service --format seqd --out /tmp/overview.seqd
```

**Formats:** `seqd` (JSON IR), `svg` (Structural theme), `mermaid` (derived projection).

The CLI **never** auto-writes into a user git repo. Output goes to stdout unless you pass `--out <path>`. Persisting under `.sequence/diagrams/` is a deliberate user or agent action.

## JavaScript API

| Function | Package | Purpose |
|----------|---------|---------|
| `validateSeqDiagram(doc)` | `@sequence/schema` | Pure validator; returns `{ ok, errors }`, never throws. |
| `archGraphToSeqDiagram(graph, opts?)` | `@sequence/export` | Project an ArchGraph to a grounded `SeqDiagramV1`. |
| `renderSeqDiagramSvg(doc)` | `@sequence/export` | Render Structural SVG from a validated document. |

```typescript
import { validateSeqDiagram } from '@sequence/schema';
import { archGraphToSeqDiagram, renderSeqDiagramSvg } from '@sequence/export';

const doc = archGraphToSeqDiagram(graph, { kind: 'service-flow', origin: 'export' });
const { ok, errors } = validateSeqDiagram(doc);
if (!ok) throw new Error(errors.join('; '));

const svg = renderSeqDiagramSvg(doc);
const json = JSON.stringify(doc, null, 2);
```

`projections.mermaid` on exported docs is convenience text from the same graph projection; edit `nodes` / `edges` as source of truth and re-export when you need fresh Mermaid.

## Why JSON (not a new diagram language)

- **Agent interop:** Models already read and write JSON with required fields — low token cost, hard to “forget” evidence or invent nodes.
- **One product, not two:** Inventing a custom grammar plus parser is a second language product; it does not make diagrams prettier or more grounded.
- **The format is SeqDiagram** (schema, rules, `.seqd` extension). JSON is only the wire encoding — same pattern as many tools that use JSON with a custom extension.
- **Human-friendly envelopes later:** A MADR markdown wrapper for authoring can sit on top; the IR stays JSON so validators and renderers stay simple.

Mermaid remains a **derived projection** for paste-into-Notion workflows, not the canonical artifact.

## Auto-write policy (default: off)

Sequence does **not** silently create `.sequence/diagrams/*.seqd` on scan or attach.

| Trigger | Writes `.seqd`? |
|---------|----------------|
| Repo scan / attach | **No** |
| Export menu with toggle OFF | **No** (download only) |
| Export menu with toggle ON (Settings → Preferences → “Share diagrams into my repo”) | **Yes** — writes `.sequence/diagrams/<slug>.seqd` via the jailed `PUT /api/file` path when a repo is attached |
| CLI without `--out` | **No** (stdout only) |
| CLI with explicit `--out` or user save | **Yes** (deliberate) |

The in-app toggle defaults **OFF** (owner lock). When ON, only SeqDiagram JSON export attempts a repo write; other export formats stay download-only. If the write fails (reserved path, offline, permissions), the export menu reports the failure honestly — the download still succeeds.

## Related docs

- File path and CLI quick reference: [`docs/research/seqdiagram-file-convention.md`](research/seqdiagram-file-convention.md)
- Owner-facing mental model: [`docs/research/seqdiagram-owner-primer.md`](research/seqdiagram-owner-primer.md)
