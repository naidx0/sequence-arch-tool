/**
 * SeqDiagram v1 CLI — validate `.seqd` files and export from ArchGraph.
 *
 * Default: stdout only. Writes to disk only when `--out <path>` is explicit.
 * Never auto-writes into an attached repo's `.sequence/diagrams/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateSeqDiagram, type ArchGraph, type SeqDiagramV1 } from '@sequence/schema';
import { archGraphToSeqDiagram, renderSeqDiagramSvg } from '@sequence/export';
import { scanRepo } from './scan.js';

export type DiagramExportFormat = 'seqd' | 'svg' | 'mermaid';

const EXPORT_FORMATS: readonly DiagramExportFormat[] = ['seqd', 'svg', 'mermaid'];

function flag(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i >= 0) {
    args.splice(i, 1);
    return true;
  }
  return false;
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) {
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  }
  return undefined;
}

/** Validate a SeqDiagram v1 JSON file. Returns a process exit code. */
export function runDiagramValidate(filePath: string): number {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`diagram validate: ${(e as Error).message}`);
    return 2;
  }

  const result = validateSeqDiagram(raw);
  if (!result.ok) {
    console.error(`invalid (${result.errors.length} problem${result.errors.length === 1 ? '' : 's'}):`);
    for (const err of result.errors) console.error(`  - ${err}`);
    return 2;
  }

  const doc = raw as SeqDiagramV1;
  console.log(
    `valid (${doc.nodes.length} nodes, ${doc.edges.length} edges, kind: ${doc.kind})`
  );
  return 0;
}

/** Load an ArchGraph from `--repo <dir>` (scan) or a positional graph JSON path. */
export async function loadGraphForDiagramExport(
  args: string[]
): Promise<{ graph: ArchGraph; source: string } | null> {
  // Accepted but ignored — export never auto-opens a browser.
  flag(args, '--no-open');
  const repo = opt(args, '--repo');
  if (repo) {
    const graph = await scanRepo(repo, { cluster: true });
    return { graph, source: path.resolve(repo) };
  }
  const graphPath = args.shift();
  if (!graphPath) return null;
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as ArchGraph;
  return { graph, source: path.resolve(graphPath) };
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

/** Export a diagram from graph JSON or `--repo`. Returns a process exit code. */
export async function runDiagramExport(args: string[]): Promise<number> {
  const out = opt(args, '--out');
  const format = opt(args, '--format') as DiagramExportFormat | undefined;

  if (!format || !EXPORT_FORMATS.includes(format)) {
    console.error(
      `diagram export: unknown format '${format ?? ''}'. expected one of: ${EXPORT_FORMATS.join(', ')}`
    );
    return 2;
  }

  let loaded: { graph: ArchGraph; source: string } | null;
  try {
    loaded = await loadGraphForDiagramExport(args);
  } catch (e) {
    console.error(`diagram export: ${(e as Error).message}`);
    return 2;
  }

  if (!loaded) {
    console.error('usage: sequence diagram export <graph.json> [--format seqd|svg|mermaid] [--out <file>]');
    console.error('       sequence diagram export --repo <dir> [--format seqd|svg|mermaid] [--out <file>]');
    return 2;
  }

  if (args.length > 0) {
    console.error(`diagram export: unexpected argument '${args[0]}'`);
    return 2;
  }

  const text = renderDiagramExport(loaded.graph, format);
  if (out) {
    fs.writeFileSync(out, text);
    console.error(`wrote ${path.resolve(out)}`);
  } else {
    process.stdout.write(text);
  }
  return 0;
}
