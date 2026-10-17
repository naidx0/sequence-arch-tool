/**
 * The export formats, in one place for `sequence export` (cli.ts) and GET /api/export (repoServer.ts), so
 * the app and the command line cannot disagree. The renderers are @sequence/export's; nothing here
 * reimplements one.
 */
import type { ArchGraph } from '@sequence/schema';
import { archToMarkdown, dependencyMatrix, mermaidFlow, mermaidSequence } from '@sequence/export';

export interface ExportFormat {
  render: (g: ArchGraph) => string;
  /** File extension for a saved copy, with the dot. */
  ext: string;
  mime: string;
  /** Offered by GET /api/export (the CLI offers every format). */
  api: boolean;
}

export const EXPORT_FORMATS: Readonly<Record<string, ExportFormat>> = {
  'mermaid-seq': { render: (g) => mermaidSequence(g), ext: '.mmd', mime: 'text/plain', api: false },
  'mermaid-flow': { render: (g) => mermaidFlow(g), ext: '.mmd', mime: 'text/plain', api: true },
  'matrix-md': { render: (g) => dependencyMatrix(g).markdown, ext: '.md', mime: 'text/markdown', api: false },
  'matrix-csv': { render: (g) => dependencyMatrix(g).csv, ext: '.csv', mime: 'text/csv', api: true },
  'arch-md': { render: (g) => archToMarkdown(g), ext: '.md', mime: 'text/markdown', api: true },
};

export const API_EXPORT_FORMATS: readonly string[] = Object.entries(EXPORT_FORMATS)
  .filter(([, f]) => f.api)
  .map(([k]) => k);

/** `<repo>-architecture.mmd`, with anything that is not a safe file-name character in the repo name replaced. */
export function exportFilename(repoName: string, format: string): string {
  const stem = repoName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 120).replace(/[-.]+$/, '') || 'repo';
  return `${stem}-architecture${EXPORT_FORMATS[format]?.ext ?? ''}`;
}
