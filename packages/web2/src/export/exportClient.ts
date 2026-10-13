/**
 * Export from the app (claim V35): asks the server for the scanned graph as Mermaid, CSV or Markdown.
 * The server renders with the same functions `sequence export` runs, so a saved copy equals the command's
 * output. No UI uses this yet; a board menu entry can call `fetchExport` and save `content` as `filename`.
 */

export type ExportFormat = 'mermaid-flow' | 'matrix-csv' | 'arch-md';

/** The formats GET /api/export offers, in menu order. */
export const EXPORT_FORMATS: readonly ExportFormat[] = ['mermaid-flow', 'matrix-csv', 'arch-md'];

export interface ExportFile {
  format: ExportFormat;
  /** `<repo>-architecture.mmd`, `.csv` or `.md`. */
  filename: string;
  mime: string;
  content: string;
}

export type ExportResult = { ok: true; file: ExportFile } | { ok: false; status: number; message: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchExport(format: ExportFormat, fetchImpl: Fetch = fetch): Promise<ExportResult> {
  let r: Response;
  try {
    r = await fetchImpl(`/api/export?format=${encodeURIComponent(format)}`, { headers: { accept: 'application/json' } });
  } catch (e) {
    return { ok: false, status: 0, message: (e as Error).message };
  }
  const body = (await r.json().catch(() => null)) as (Partial<ExportFile> & { error?: string }) | null;
  if (!r.ok || !body || typeof body.content !== 'string' || typeof body.filename !== 'string') {
    return { ok: false, status: r.status, message: body?.error ?? `the server answered ${r.status}` };
  }
  return { ok: true, file: { format, filename: body.filename, mime: body.mime ?? 'text/plain', content: body.content } };
}
