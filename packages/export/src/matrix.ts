/**
 * Dependency matrix projection: a square who-calls-whom grid whose rows and
 * columns are the lifted service-level labels and whose cells hold the
 * comma-joined kind families of the edges from row → column. Emitted as both a
 * GitHub-flavoured Markdown table and CSV.
 */
import type { ArchGraph } from '@sequence/schema';
import { projectEdges, orderParticipants } from './project.js';

/** Escape a Markdown table cell (pipes would start a new column). */
function mdCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * Quote a CSV field per RFC 4180: wrap in double quotes when it contains a
 * comma, a quote, or a newline, doubling any embedded quote. Labels AND cells
 * (which are themselves comma-joined family lists) go through this.
 */
function csvCell(text: string): string {
  // Spreadsheet formula-injection guard: Excel / Sheets treat a cell beginning
  // with = + - or @ as a formula, so a label like `=cmd()` could execute on
  // open. Prefix a single quote to force literal-text interpretation (the OWASP
  // CSV-injection mitigation). Done BEFORE quoting so the `'` rides inside the
  // quotes when RFC-4180 quoting is also needed.
  let s = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function dependencyMatrix(graph: ArchGraph): { markdown: string; csv: string } {
  const edges = projectEdges(graph);
  const order = orderParticipants(edges);

  // cell[src][dst] = set of kind families
  const cells = new Map<string, Map<string, Set<string>>>();
  for (const e of edges) {
    let row = cells.get(e.src);
    if (!row) {
      row = new Map();
      cells.set(e.src, row);
    }
    let fams = row.get(e.dst);
    if (!fams) {
      fams = new Set();
      row.set(e.dst, fams);
    }
    fams.add(e.family);
  }
  const cellText = (src: string, dst: string): string => {
    const fams = cells.get(src)?.get(dst);
    return fams ? [...fams].sort().join(',') : '';
  };

  // Markdown
  const header = ['from \\ to', ...order];
  const md: string[] = [];
  md.push('| ' + header.map(mdCell).join(' | ') + ' |');
  md.push('| ' + header.map(() => '---').join(' | ') + ' |');
  for (const src of order) {
    const cols = order.map((dst) => cellText(src, dst));
    md.push('| ' + [src, ...cols].map(mdCell).join(' | ') + ' |');
  }
  const markdown = md.join('\n') + '\n';

  // CSV
  const csvRows: string[] = [];
  csvRows.push(header.map(csvCell).join(','));
  for (const src of order) {
    const cols = order.map((dst) => cellText(src, dst));
    csvRows.push([src, ...cols].map(csvCell).join(','));
  }
  const csv = csvRows.join('\n') + '\n';

  return { markdown, csv };
}
