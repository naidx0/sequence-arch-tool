/**
 * SeqDiagram MCP tools — validate `.seqd` files and export from ArchGraph.
 *
 * Uses browser-safe `@sequence/schema` + `@sequence/export` directly (no CLI shell).
 * Writes to disk only when `outPath` is explicit; never auto-writes into
 * `.sequence/diagrams/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateSeqDiagram, type ArchGraph, type SeqDiagramV1 } from '@sequence/schema';
import { archGraphToSeqDiagram, renderSeqDiagramSvg } from '@sequence/export';
import { scanRepo } from '@sequence/analyzer';

export type DiagramExportFormat = 'seqd' | 'svg' | 'mermaid';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const EXPORT_FORMATS: readonly DiagramExportFormat[] = ['seqd', 'svg', 'mermaid'];

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function isNoManifests(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const o = e as { code?: unknown; name?: unknown };
  return o.code === 'no-manifests' || o.name === 'NoManifestsError';
}

const NO_MANIFEST_MESSAGE =
  'Nothing to scan here: no container manifests (docker-compose / Kubernetes / Helm) AND ' +
  'no recognizable package manifest or source were found in this path. Sequence scans ' +
  'container-manifest repos and (since v9) manifest-less code repos via their package ' +
  'manifests (package.json, pyproject, go.mod, Cargo.toml, …); this message means the ' +
  'directory is empty or unrecognized.';

export interface ValidateDiagramInput {
  filePath: string;
}

/** `validate_diagram` — validate a SeqDiagram v1 JSON file. */
export function validateDiagramTool(input: ValidateDiagramInput): ToolResult {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(input.filePath, 'utf8'));
  } catch (e) {
    return fail(`validate_diagram: ${(e as Error).message}`);
  }

  const result = validateSeqDiagram(raw);
  if (!result.ok) {
    return fail(
      `invalid (${result.errors.length} problem${result.errors.length === 1 ? '' : 's'}):\n` +
        result.errors.map((err: string) => `  - ${err}`).join('\n')
    );
  }

  const doc = raw as SeqDiagramV1;
  return ok({
    valid: true,
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    kind: doc.kind,
    title: doc.title,
  });
}

export interface ExportDiagramInput {
  repoPath?: string;
  graphPath?: string;
  format: DiagramExportFormat;
  outPath?: string;
}

/** Render diagram export text from a loaded ArchGraph. */
export function renderDiagramExport(graph: ArchGraph, format: DiagramExportFormat): string {
  const doc = archGraphToSeqDiagram(graph, { origin: 'export' });
  switch (format) {
    case 'seqd':
      return `${JSON.stringify(doc, null, 2)}\n`;
    case 'svg':
      return renderSeqDiagramSvg(doc);
    case 'mermaid':
      return doc.projections?.mermaid ?? '';
  }
}

async function loadGraphForExport(
  input: ExportDiagramInput
): Promise<{ graph: ArchGraph; source: string }> {
  if (input.repoPath && input.graphPath) {
    throw new Error('provide either repoPath or graphPath, not both');
  }
  if (input.repoPath) {
    const graph = await scanRepo(input.repoPath, { cluster: true });
    return { graph, source: path.resolve(input.repoPath) };
  }
  if (input.graphPath) {
    const graph = JSON.parse(fs.readFileSync(input.graphPath, 'utf8')) as ArchGraph;
    return { graph, source: path.resolve(input.graphPath) };
  }
  throw new Error('export_diagram needs repoPath (scan) or graphPath (ArchGraph JSON)');
}

/** `export_diagram` — export a diagram from a repo scan or ArchGraph JSON. */
export async function exportDiagramTool(input: ExportDiagramInput): Promise<ToolResult> {
  if (!EXPORT_FORMATS.includes(input.format)) {
    return fail(
      `export_diagram: unknown format '${input.format}'. expected one of: ${EXPORT_FORMATS.join(', ')}`
    );
  }

  let loaded: { graph: ArchGraph; source: string };
  try {
    loaded = await loadGraphForExport(input);
  } catch (e) {
    if (isNoManifests(e)) return fail(NO_MANIFEST_MESSAGE);
    return fail(`export_diagram: ${(e as Error).message}`);
  }

  const text = renderDiagramExport(loaded.graph, input.format);

  if (input.outPath) {
    const out = path.resolve(input.outPath);
    fs.writeFileSync(out, text);
    return ok({ wrote: out, format: input.format, source: loaded.source });
  }

  return ok({ content: text, format: input.format, source: loaded.source });
}
