/**
 * First-glance title on a board card — owner 2026-08-26: bare scan ids like
 * `api` / `postgres` read as broken lowercase; title-case word segments without
 * inventing a rename the graph does not carry.
 */
export function displayLabel(label: string): string {
  const t = label.trim();
  if (!t) return t;
  /* Source filenames — keep literal (`app.ts`, `routes.ts`). */
  if (/\.[a-z0-9]{1,8}$/i.test(t)) return t;
  /* Already mixed case or multi-word prose — leave it. */
  if (/[A-Z]/.test(t) || /\s/.test(t)) return t;
  /* kebab/snake/dot ids from manifests: `order-service` → `Order Service`. */
  if (/^[a-z0-9][a-z0-9._-]*$/.test(t)) {
    return t
      .split(/[._-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return t;
}

/**
 * Condensed board title for far zoom — first word / segment, capped so a
 * zoomed-out card still names the node without wrapping into a paragraph.
 */
export function shortBoardLabel(label: string, maxChars = 14): string {
  const full = displayLabel(label);
  if (!full) return full;
  const first = full.split(/\s+/)[0] ?? full;
  if (first.length <= maxChars) return first;
  return `${first.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * Sibling-aware far-zoom titles — the word that DIFFERS is the title.
 *
 * Measured on hoppscotch (17 services, 2026-08-29): twelve of them begin
 * "Hoppscotch …", `shortBoardLabel` keeps only the first word, and the board
 * showed nine cards all reading "Hoppscotch" — indistinguishable, the exact
 * "no two sibling rows read the same" violation the legibility gate names.
 *
 * Rule, deliberately one level deep: when three or more siblings share their
 * FIRST word, that word is a family name carrying no per-card information at
 * this zoom — drop it and show what remains ("Backend", "Old Backend",
 * "Sh Admin"). One level only: recursing ("Old Backend" → "Backend") would
 * collide the old family with the new one, which is worse than a shared
 * prefix. A label that IS the family word alone keeps it. The closer rungs
 * still carry the full name — nothing is renamed, only condensed.
 */
export function distinctiveShortLabels(
  labels: readonly string[],
  maxChars = 14,
): Map<string, string> {
  const seqs = labels.map((l) => displayLabel(l).split(/\s+/).filter(Boolean));
  const firstCount = new Map<string, number>();
  for (const ws of seqs) {
    const first = ws[0];
    if (first) firstCount.set(first, (firstCount.get(first) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  labels.forEach((raw, i) => {
    const ws = seqs[i] ?? [];
    const family = ws[0] !== undefined && ws.length > 1 && (firstCount.get(ws[0]) ?? 0) >= 3;
    const rest = family ? ws.slice(1) : ws;
    let text = rest.join(' ') || ws.join(' ') || raw;
    if (text.length > maxChars) text = `${text.slice(0, Math.max(1, maxChars - 1))}…`;
    out.set(raw, text);
  });
  return out;
}
