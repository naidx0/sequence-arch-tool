import fs from 'node:fs';
import type { ArchEdge, ArchGraph } from '@sequence/schema';
import { buildLift, kindFamily, projectToServiceLevel } from './score.js';
import { normalizeMethod, projectDetailed, specEdgeSatisfied } from './detail.js';

/**
 * Diff two scanned archgraph.json files at the service level: added/removed
 * interaction edges only. No moved/renamed detection — that's explicitly
 * out of scope; a service rename shows up as one removed + one added edge.
 *
 * When the base is a design-mode spec, an additional *detail-aware* pass runs:
 * for every service-pair present in BOTH graphs it cross-checks HTTP method/path
 * and DB table with tolerant matchers (see detail.ts). A spec edge whose detail
 * no head-side edge satisfies is a `mismatched` — "the right services talk, but
 * wrong wiring". This layer never touches the coarse projection (score.ts).
 */

interface ParsedEdge {
  src: string;
  dst: string;
  kind: string;
}

/** A spec (base-side) leaf edge whose detail no head-side edge for its pair satisfies. */
interface DetailMismatch {
  /** the coarse service-level key, e.g. `gateway -> api [http]` */
  key: string;
  /** rendered explanation: what the spec expected vs. what was found */
  description: string;
  /** a head-side `file:line` citation for this pair, if any */
  evidence?: string;
}

function parseEdgeString(s: string): ParsedEdge {
  const m = /^(.*) -> (.*) \[(.*)\]$/.exec(s);
  if (!m) throw new Error(`unparseable service-level edge: ${s}`);
  return { src: m[1], dst: m[2], kind: m[3] };
}

/**
 * Find one underlying leaf edge in `graph` whose lifted endpoints and kind
 * family match the given service-level edge, and return its first evidence
 * as `file:line`. Best-effort — returns undefined if none is found.
 */
function findEvidence(graph: ArchGraph, edge: ParsedEdge): string | undefined {
  const lift = buildLift(graph);
  for (const e of graph.edges) {
    if (e.kind === 'import') continue;
    if (kindFamily(e.kind) !== edge.kind) continue;
    if (lift(e.srcId) !== edge.src || lift(e.dstId) !== edge.dst) continue;
    if (e.evidence.length === 0) continue;
    const ev = e.evidence[0];
    return `${ev.file}:${ev.line}`;
  }
  return undefined;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

/**
 * Describe, for one failing spec-side leaf edge, what the spec asked for versus
 * what the implementation actually wired for that same service pair.
 */
function describeMismatch(key: string, spec: ArchEdge, headLeaves: ArchEdge[]): string {
  const { src, dst, kind } = parseEdgeString(key);
  const pair = `\`${src} → ${dst}\` [${kind}]`;
  if (spec.kind === 'http') {
    const method = normalizeMethod(spec.detail?.method as string | undefined);
    const path = (spec.detail?.pathPattern as string | undefined) ?? '*';
    const found = uniq(
      headLeaves.map(
        (he) =>
          `${normalizeMethod(he.detail?.method as string | undefined)} ${
            (he.detail?.pathPattern as string | undefined) ?? '*'
          }`
      )
    );
    const foundStr =
      found.length > 0
        ? `implementation has ${found.map((f) => `\`${f}\``).join(', ')}`
        : 'implementation has no matching call';
    return `${pair}: spec expects \`${method} ${path}\`, ${foundStr} (no match)`;
  }
  if (spec.kind.startsWith('db_')) {
    const table = (spec.detail?.table as string | undefined) ?? '*';
    // Only table-bearing head edges are meaningful here; a tableless connection
    // edge is not evidence of which table was accessed.
    const found = uniq(
      headLeaves
        .map((he) => he.detail?.table as string | undefined)
        .filter((t): t is string => t !== undefined)
        .map((t) => t.toLowerCase())
    );
    const foundStr =
      found.length > 0
        ? `implementation only accesses ${found.map((f) => `\`${f}\``).join(', ')}`
        : 'implementation accesses no named table';
    return `${pair}: spec expects table \`${table}\`, ${foundStr}`;
  }
  return `${pair}: detail mismatch`;
}

/**
 * Detail-aware conformance pass (design-mode only). For every coarse key present
 * in BOTH graphs, every base-side (spec) leaf edge must have AT LEAST ONE
 * head-side leaf edge whose detail matches (tolerantly). Base leaves with no
 * such match are collected; their coarse keys form `mismatched`.
 */
function detailMismatches(
  base: ArchGraph,
  head: ArchGraph,
  added: string[],
  removed: string[]
): { mismatched: string[]; details: DetailMismatch[] } {
  const baseDetailed = projectDetailed(base);
  const headDetailed = projectDetailed(head);
  const addedSet = new Set(added);
  const removedSet = new Set(removed);

  const failingKeys = new Set<string>();
  const details: DetailMismatch[] = [];

  for (const [key, baseLeaves] of baseDetailed) {
    // Only keys genuinely connected on BOTH sides are candidates for a detail
    // mismatch; anything added/removed is already reported by the coarse diff.
    if (addedSet.has(key) || removedSet.has(key)) continue;
    const headLeaves = headDetailed.get(key) ?? [];
    for (const spec of baseLeaves) {
      const matched = specEdgeSatisfied(spec, headLeaves);
      if (!matched) {
        failingKeys.add(key);
        details.push({
          key,
          description: describeMismatch(key, spec, headLeaves),
          evidence: findEvidence(head, parseEdgeString(key)),
        });
      }
    }
  }

  details.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { mismatched: [...failingKeys].sort(), details };
}

/**
 * Render the diff as markdown. When `design` is true the base graph is an
 * authored spec, so the framing flips from "drift" to "conformance": removed
 * edges (in the spec, not the implementation) are "Missing from implementation"
 * and added edges (in the implementation, not the spec) are "Not in spec"; and,
 * new in v5, spec edges wired with the wrong HTTP method/path or DB table are
 * "Wrong wiring details". When `design` is false the output is byte-identical to
 * the scan-mode report (the detail-aware section never renders in scan mode).
 */
function renderMarkdown(
  added: string[],
  removed: string[],
  mismatched: string[],
  details: DetailMismatch[],
  head: ArchGraph,
  design: boolean
): string {
  const heading = design ? '## sequence conformance report' : '## sequence drift report';
  const lines: string[] = [heading];
  if (added.length === 0 && removed.length === 0 && mismatched.length === 0) {
    lines.push(design ? 'Implementation conforms to spec — no drift.' : 'No interaction-edge drift.');
    return lines.join('\n') + '\n';
  }

  lines.push(
    design
      ? `**${removed.length} missing from implementation / ${added.length} not in spec / ${mismatched.length} wrong wiring** service-level interaction edges (spec → implementation)`
      : `**${added.length} added / ${removed.length} removed** service-level interaction edges (base → head)`
  );

  // Sections in report order. `evidence: true` means look up a citation in the
  // head graph (only meaningful for edges that exist in the implementation).
  const sections: { label: string; items: string[]; evidence: boolean }[] = design
    ? [
        { label: '### Missing from implementation', items: removed, evidence: false },
        { label: '### Not in spec', items: added, evidence: true },
      ]
    : [
        { label: '### Added', items: added, evidence: true },
        { label: '### Removed', items: removed, evidence: false },
      ];

  let firstSection = true;
  for (const sec of sections) {
    if (sec.items.length === 0) continue;
    if (firstSection) lines.push('');
    firstSection = false;
    lines.push(sec.label);
    for (const s of sec.items) {
      const edge = parseEdgeString(s);
      const evidence = sec.evidence ? findEvidence(head, edge) : undefined;
      lines.push(
        `- \`${edge.src} → ${edge.dst}\` [${edge.kind}]${evidence ? ` — evidence: ${evidence}` : ''}`
      );
    }
  }

  // Detail-aware section: design-mode only, non-empty only.
  if (design && details.length > 0) {
    if (firstSection) lines.push('');
    firstSection = false;
    lines.push('### Wrong wiring details');
    for (const m of details) {
      lines.push(`- ${m.description}${m.evidence ? ` — evidence: ${m.evidence}` : ''}`);
    }
  }

  return lines.join('\n') + '\n';
}

export function diffGraphs(
  basePath: string,
  headPath: string
): { added: string[]; removed: string[]; mismatched: string[]; markdown: string } {
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8')) as ArchGraph;
  const head = JSON.parse(fs.readFileSync(headPath, 'utf8')) as ArchGraph;

  const baseEdges = projectToServiceLevel(base);
  const headEdges = projectToServiceLevel(head);

  const added = [...headEdges].filter((e) => !baseEdges.has(e)).sort();
  const removed = [...baseEdges].filter((e) => !headEdges.has(e)).sort();

  const design = base.mode === 'design';
  const { mismatched, details } = design
    ? detailMismatches(base, head, added, removed)
    : { mismatched: [] as string[], details: [] as DetailMismatch[] };

  const markdown = renderMarkdown(added, removed, mismatched, details, head, design);
  return { added, removed, mismatched, markdown };
}
