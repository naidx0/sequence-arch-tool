/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE SCAN KNOWS ABOUT A NODE, AS ONE SHORT LINE
   packages/web2/src/canvas/scanFacts.ts

   Decision 49's card carries a one-line definition under its title (Jaden:
   "icons, small definitions"). Where the graph has a summary the card says
   that; where it has none, this is the line: the facts the scan recorded on
   the node itself, in its own words, joined by commas.

     a service     its main language, its framework, its file count
                   ("ts, express, 6 files")
     a datastore   its technology and its role ("<technology>, broker")

   NOTHING IS INVENTED. Every word comes off `node.meta` as the analyzer wrote
   it, and a fact the title already says is left out ("Redis" does not read
   its own technology under it). No facts: null, and the card says the kind word.
   ══════════════════════════════════════════════════════════════════════════ */

interface ScanLanguage {
  language?: unknown;
  share?: unknown;
}

export interface ScanNodeLike {
  label: string;
  meta?: Record<string, unknown> | null;
}

function word(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The node's main language: the one with the largest share. */
function mainLanguage(meta: Record<string, unknown>): string | null {
  const list = Array.isArray(meta.languages) ? (meta.languages as ScanLanguage[]) : [];
  let best: { name: string; share: number } | null = null;
  for (const entry of list) {
    const name = word(entry?.language);
    const share = typeof entry?.share === 'number' ? entry.share : 0;
    if (name && (!best || share > best.share)) best = { name, share };
  }
  return best?.name ?? null;
}

/** At most two facts, in the order a reader asks for them. */
export function scanFacts(node: ScanNodeLike, displayedTitle = node.label): string | null {
  const meta = node.meta;
  if (!meta || typeof meta !== 'object') return null;
  const files = typeof meta.files === 'number' && meta.files > 0 ? meta.files : null;
  const candidates = [
    word(meta.tech) ?? mainLanguage(meta),
    word(meta.framework),
    word(meta.role) === 'datastore' ? null : word(meta.role),
    files === null ? null : files === 1 ? '1 file' : `${files} files`,
  ];
  /* Whole words, so "ts" is not found inside "Payments". */
  const title = new Set(`${displayedTitle} ${node.label}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const fact of candidates) {
    if (!fact) continue;
    const key = fact.toLowerCase();
    if (seen.has(key) || title.has(key)) continue;
    seen.add(key);
    out.push(fact);
    /* Two facts: the line holds about two dozen characters at the narrowest
       card, and "py, fastapi, 7 files" was cut there (UX audit). */
    if (out.length === 2) break;
  }
  return out.length > 0 ? out.join(', ') : null;
}
