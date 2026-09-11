/**
 * ProgramGraph ⇄ Mermaid flowchart (v16 Phase 4, additive & PURE).
 *
 * The "spec-first workflow tuning" authoring loop: render a {@link Program} as a
 * Mermaid `flowchart TD` a human can eyeball/diff, and parse OUR OWN emitted
 * dialect back into a Program. Both functions are pure, deterministic, and
 * browser-safe (no fs/network/LLM) — the same discipline as the rest of this
 * package.
 *
 * ── The dialect (what round-trips losslessly) ────────────────────────────────
 * This module targets ITS OWN emitted format, not arbitrary hand-written
 * Mermaid. What survives a `mermaidToProgram(programToMermaid(p))` round-trip:
 *   - every node's `id`, `kind`, and `title`;
 *   - for `agent` nodes, `agent.runtime` — including the honest three-way
 *     distinction between `'acp'`, an explicit `'gateway'`, and an ABSENT
 *     runtime (which stays absent, matching the v14 byte-compat lock);
 *   - every edge's `from`, `to`, and `kind`.
 *
 * What Mermaid deliberately does NOT carry (a flowchart is a structural view,
 * not the full program): agent prompts/models/intents/outKeys, branch/loop
 * predicates, command strings, state declarations, and the program's own
 * id/name. Parsing therefore reconstructs a STRUCTURAL skeleton — nodes carry
 * only what the diagram encodes. This is why the round-trip is asserted on
 * id/kind/runtime/title + edge src/dst/kind, and not on `validateProgram`
 * acceptance of the parsed skeleton.
 *
 * ── Wire shape ───────────────────────────────────────────────────────────────
 *   flowchart TD
 *     N0["<title> [<kind>] @<id>"]
 *     N1["<title> [agent] [acp] @<id>"]
 *     N0 -->|seq| N1
 *
 * Mermaid node ids are positional (`N<index>` over `program.nodes` order), so
 * the ORIGINAL program-node id is carried inside the label as a trailing
 * `@<id>` token. Kind is a `[kind]` tag; an agent's runtime is a second
 * `[gateway]`/`[acp]` tag (emitted only when the runtime is explicitly set).
 * Label text (title + id) is percent-escaped over the characters that would
 * otherwise break Mermaid syntax, so the output is always valid.
 */

import type { Program, ProgramNode, ProgramEdge, ProgramEdgeKind, ProgramNodeKind } from './program.js';

/** Node kinds we recognize on parse — mirrors {@link ProgramNodeKind}. */
const NODE_KINDS: ReadonlySet<string> = new Set<ProgramNodeKind>([
  'start', 'end', 'agent', 'command', 'parallel', 'branch', 'loop', 'state', 'checker',
]);

/** Edge kinds we recognize on parse — mirrors {@link ProgramEdgeKind}. */
const EDGE_KINDS: ReadonlySet<string> = new Set<ProgramEdgeKind>([
  'seq', 'parallel', 'branch-true', 'branch-false', 'loop-body', 'loop-back',
]);

/**
 * Characters that must never appear raw inside a Mermaid `["..."]` label (they
 * close the label, start an entity, or collide with our own delimiters). Each is
 * percent-encoded to `%XX`; `%` itself is encoded first (it is in the set) so the
 * transform is reversible.
 */
const LABEL_UNSAFE = /[%"\\\r\n[\]{}|@#`<>();]/g;

function escText(s: string): string {
  return s.replace(LABEL_UNSAFE, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/** Like {@link escText} but also encodes spaces, so an id becomes a single token. */
function escId(s: string): string {
  return escText(s).replace(/ /g, '%20');
}

function unesc(s: string): string {
  return s.replace(/%([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Build the human+machine label for one node. */
function nodeLabel(node: ProgramNode): string {
  let tag = `[${node.kind}]`;
  if (node.kind === 'agent') {
    const rt = node.agent?.runtime;
    // Only emit a runtime tag when it is explicitly set: an ABSENT runtime must
    // round-trip back to absent (v14 gateway byte-compat), so we never invent one.
    if (rt === 'acp' || rt === 'gateway') tag += ` [${rt}]`;
  }
  return `${escText(node.title)} ${tag} @${escId(node.id)}`;
}

/** Snapshot role for Mermaid classDef — mirrors web `programSnapshotRoles.ts`. */
function mermaidRoleClass(node: ProgramNode): string | undefined {
  if (node.kind === 'branch') return 'gate';
  if (node.kind === 'loop') return 'retry';
  if (node.kind === 'checker') return 'checker';
  if (node.kind === 'parallel') return 'parallel';
  if (node.kind === 'start' || node.kind === 'end') return 'entry';
  const title = node.title.toLowerCase();
  if (/plan|planner/.test(title)) return 'planner';
  if (/review/.test(title)) return 'reviewer';
  if (/summar|output|final|haiku|send to user/.test(title)) return 'output';
  if (node.kind === 'agent' || node.kind === 'command') return 'worker';
  return undefined;
}

const MERMAID_CLASS_DEFS = [
  'classDef gate fill:#5c4033,stroke:#a67c52,color:#fff',
  'classDef retry fill:#2a2a2a,stroke:#888,stroke-dasharray:5 5,color:#eee',
  'classDef checker fill:#3a2a4a,stroke:#9a6abf,color:#fff',
  'classDef parallel fill:#2a3a4a,stroke:#6a9abf,color:#fff',
  'classDef worker fill:#1a3a5c,stroke:#4a90d9,color:#fff',
  'classDef planner fill:#2d4a3e,stroke:#6abf8a,color:#fff',
  'classDef reviewer fill:#3d2d4a,stroke:#9a6abf,color:#fff',
  'classDef output fill:#4a3d2d,stroke:#d4a66a,color:#fff',
  'classDef entry fill:#222,stroke:#666,color:#ccc',
] as const;

/**
 * Render a {@link Program} as a deterministic Mermaid `flowchart TD` string.
 *
 * Node order follows `program.nodes`; edge order follows `program.edges`, so the
 * same input always yields byte-identical output. Throws an honest Error if an
 * edge references a node id absent from `program.nodes` (a malformed graph would
 * otherwise emit a dangling Mermaid edge).
 */
export function programToMermaid(program: Program): string {
  const indexById = new Map<string, number>();
  program.nodes.forEach((n, i) => indexById.set(n.id, i));

  const lines: string[] = ['flowchart TD'];
  const classAssignments: string[] = [];

  program.nodes.forEach((n, i) => {
    lines.push(`  N${i}["${nodeLabel(n)}"]`);
    const role = mermaidRoleClass(n);
    if (role) classAssignments.push(`  class N${i} ${role}`);
  });

  for (const e of program.edges) {
    const from = indexById.get(e.from);
    const to = indexById.get(e.to);
    if (from === undefined) throw new Error(`programToMermaid: edge ${e.id} references unknown from-node ${e.from}`);
    if (to === undefined) throw new Error(`programToMermaid: edge ${e.id} references unknown to-node ${e.to}`);
    lines.push(`  N${from} -->|${e.kind}| N${to}`);
  }

  lines.push(...MERMAID_CLASS_DEFS);
  lines.push(...classAssignments);

  return lines.join('\n') + '\n';
}

const NODE_LINE = /^(N\d+)\["(.*)"\]$/;
const EDGE_LINE = /^(N\d+)\s*-->\|([a-z-]+)\|\s*(N\d+)$/;
// title (lazy, escaped so no raw '[') then [kind], optional [runtime], then @id.
const LABEL = /^(.*?) \[([a-z]+)\](?: \[([a-z]+)\])? @(\S+)$/;

/**
 * Parse OUR emitted Mermaid dialect back into a structural {@link Program}.
 *
 * Best-effort but LOSSLESS for the fields the dialect carries (see the module
 * header): node id/kind/title, agent runtime, and edge from/to/kind. It does not
 * attempt to parse arbitrary hand-written Mermaid. Anything it cannot honestly
 * interpret — a bad header, an unparseable node/edge/label line, an unknown
 * kind, or an edge pointing at an undeclared node — throws an Error rather than
 * returning a silent partial graph.
 *
 * Reconstructed nodes carry ONLY what the diagram encodes; fields Mermaid does
 * not represent (prompts, predicates, state, program id/name) are absent or
 * synthesized (`id: 'program'`, `name: 'program'`), so the result is a skeleton,
 * not necessarily a `validateProgram`-clean program.
 */
export function mermaidToProgram(text: string): Program {
  const rawLines = text.split('\n');
  const lines: string[] = [];
  for (const raw of rawLines) {
    const t = raw.trim();
    if (t.length > 0) lines.push(t);
  }
  if (lines.length === 0 || !/^flowchart\b/.test(lines[0])) {
    throw new Error("mermaidToProgram: input must start with a 'flowchart' header");
  }

  const nodes: ProgramNode[] = [];
  const midToId = new Map<string, string>();
  interface RawEdge { fromMid: string; toMid: string; kind: string; }
  const rawEdges: RawEdge[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (/^classDef\s/.test(line) || /^class\s/.test(line)) continue;

    const nm = NODE_LINE.exec(line);
    if (nm) {
      const mid = nm[1];
      const label = nm[2];
      const lm = LABEL.exec(label);
      if (!lm) throw new Error(`mermaidToProgram: unparseable node label on line: ${line}`);
      const title = unesc(lm[1]);
      const kind = lm[2];
      const rt = lm[3];
      const id = unesc(lm[4]);
      if (!NODE_KINDS.has(kind)) throw new Error(`mermaidToProgram: unknown node kind '${kind}' on line: ${line}`);
      if (midToId.has(mid)) throw new Error(`mermaidToProgram: duplicate mermaid node id ${mid}`);
      const node: ProgramNode = { id, title, kind: kind as ProgramNodeKind };
      if (kind === 'agent') {
        // The mermaid view does not carry the prompt; reconstruct a structural
        // agent bag and preserve the runtime distinction honestly.
        node.agent = { prompt: '' };
        if (rt !== undefined) {
          if (rt !== 'acp' && rt !== 'gateway') {
            throw new Error(`mermaidToProgram: invalid agent runtime '${rt}' on line: ${line}`);
          }
          node.agent.runtime = rt;
        }
      } else if (rt !== undefined) {
        throw new Error(`mermaidToProgram: only agent nodes may carry a runtime tag (line: ${line})`);
      }
      midToId.set(mid, id);
      nodes.push(node);
      continue;
    }

    const em = EDGE_LINE.exec(line);
    if (em) {
      rawEdges.push({ fromMid: em[1], kind: em[2], toMid: em[3] });
      continue;
    }

    throw new Error(`mermaidToProgram: unrecognized line: ${line}`);
  }

  const edges: ProgramEdge[] = rawEdges.map((re, i) => {
    const from = midToId.get(re.fromMid);
    const to = midToId.get(re.toMid);
    if (from === undefined) throw new Error(`mermaidToProgram: edge references undeclared node ${re.fromMid}`);
    if (to === undefined) throw new Error(`mermaidToProgram: edge references undeclared node ${re.toMid}`);
    if (!EDGE_KINDS.has(re.kind)) throw new Error(`mermaidToProgram: unknown edge kind '${re.kind}'`);
    return { id: `e${i}`, from, to, kind: re.kind as ProgramEdgeKind };
  });

  return { id: 'program', name: 'program', nodes, edges };
}
