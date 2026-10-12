/**
 * WHERE INPUTS ARE DECLARED WHEN THERE IS NO CONTAINER MANIFEST.
 *
 * The card's left-hand column came only from compose/K8s `environment:` blocks,
 * which means it had nothing to say about any repository that is not deployed as
 * containers. Measured across every repository on this machine — six real ones
 * plus the fixture — exactly one had a compose file with app-service env, so
 * "declared, never read" was `0 of 0` everywhere it mattered. A card whose only
 * denominator is zero is not a card.
 *
 * `.env.example` (and its `.sample` / `.template` spellings) is the convention a
 * single-process app uses to declare the same thing. It is checked in precisely
 * so a reader knows what the app expects, which makes it a DECLARATION in the
 * card's sense — the same claim compose makes, in the file that project uses to
 * make it.
 *
 * ── SCOPE, AND WHY IT IS THE REPOSITORY AND NOT A SERVICE ──────────────────
 *
 * A root `.env.example` says "this app expects these"; it does not say which
 * service reads which. Spreading its keys across every app service would invent
 * an accusation per service for a key only one of them uses. So these are held
 * at repository scope, and a key counts as read when ANY scanned service reads
 * it. That is the strongest claim the file actually supports.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface DeclaredInput {
  name: string;
  /** The file that declared it, repo-relative. */
  source: string;
}

const CANDIDATES = [
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.defaults',
  '.env.dist',
];

/*
 * A `.env.example` line is `NAME=value`, optionally `export`-prefixed, with `#`
 * comments and blanks between. Values are ignored entirely — the card compares
 * NAMES, and a checked-in example value is a placeholder by definition.
 */
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * Read the repository's declared inputs from whichever example file it uses.
 *
 * Deliberately does NOT read a real `.env`: that file is a developer's local
 * machine, is gitignored, and frequently holds secrets. Reading it would make
 * the card's answer depend on who ran it, and would put credentials in a
 * structure that gets rendered.
 */
export function declaredFromDotenvExample(repoRoot: string): DeclaredInput[] {
  const out: DeclaredInput[] = [];
  const seen = new Set<string>();
  for (const name of CANDIDATES) {
    const abs = path.join(repoRoot, name);
    let text: string;
    try {
      if (!fs.statSync(abs).isFile()) continue;
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const m = LINE.exec(line);
      if (!m) continue;
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ name: m[1], source: name });
    }
  }
  return out;
}
