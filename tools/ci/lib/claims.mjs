/**
 * The checks behind tools/ci/claims.test.mjs, as functions over (registry, root) so a test can also run
 * them on a planted bad registry or file and see them fail. A check that finds nothing is only worth
 * something once it has found a planted example.
 *
 * Registry: docs/claims.json (plan 0.1). Public copy it guards: README.md, docs/PUBLIC-README.md,
 * docs/releases/*.md, site/src/components/lt/*, packages/web2/src/settings/* (non-test).
 */
import fs from 'node:fs';
import path from 'node:path';

/** A gap that says Claude, Codex or ACP does not get the thing: such a claim must be guarded against copy that asserts it for them. */
export const ENGINE_LACKS = /(?:Claude|Codex|ACP)[^.]*\b(?:do(?:es)? not|never|cannot|get no|are not)\b/i;
export const STATUSES = new Set(['real', 'partial', 'off']);
export const ENGINES = new Set(['builtin', 'acp']);

export function loadRegistry(root) {
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'claims.json'), 'utf8'));
  return Array.isArray(doc) ? doc : doc.claims;
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

/** The entry's shape: the fields the plan names, with the values it allows. */
export function checkShape(entries) {
  const problems = [];
  const ids = new Set();
  for (const e of entries) {
    const at = `claim ${e.id ?? '(no id)'}`;
    if (typeof e.id !== 'string' || e.id === '') problems.push(`${at}: id`);
    else if (ids.has(e.id)) problems.push(`${at}: duplicate id`);
    else ids.add(e.id);
    if (typeof e.text !== 'string' || e.text.trim() === '') problems.push(`${at}: text`);
    if (!Array.isArray(e.sources) || e.sources.length === 0) problems.push(`${at}: sources`);
    if (!Array.isArray(e.engines) || e.engines.length === 0 || !e.engines.every((x) => ENGINES.has(x))) problems.push(`${at}: engines must be builtin and/or acp`);
    if (!Array.isArray(e.code)) problems.push(`${at}: code must be a list`);
    if (!Array.isArray(e.tests)) problems.push(`${at}: tests must be a list`);
    if (!STATUSES.has(e.status)) problems.push(`${at}: status must be real, partial or off`);
    if (e.status !== 'real' && ENGINE_LACKS.test(e.gap ?? '') && !e.guard) problems.push(`${at}: its gap says an engine lacks it, so it needs a guard (topic, words, unless) that the copy is scanned against`);
    if (e.guard && (typeof e.guard.topic !== 'string' || typeof e.guard.words !== 'string' || typeof e.guard.unless !== 'string')) problems.push(`${at}: guard needs topic, words and unless as regex strings`);
    if (e.status !== 'real' && (typeof e.gap !== 'string' || e.gap.trim() === '')) problems.push(`${at}: a ${e.status} claim needs a gap that says what is not true yet`);
    if (e.evidence !== undefined) {
      const v = e.evidence;
      if (!v || typeof v.metric !== 'string' || typeof v.n !== 'number' || typeof v.baseline !== 'number' || typeof v.file !== 'string') problems.push(`${at}: evidence needs metric, n, baseline, file`);
    }
  }
  return problems;
}

/** Whether `file` (text) declares `symbol`: a function, const, class, interface, type or enum, or a method-style line. */
export function declares(text, symbol) {
  const sym = symbol.replace(/[$]/g, '\\$&');
  return (
    new RegExp(`\\b(?:function\\*?|const|let|var|class|interface|type|enum)\\s+${sym}\\b`).test(text) ||
    new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?${sym}\\s*\\(`, 'm').test(text)
  );
}

/** Every `code` entry is `file` or `file#symbol`: the file exists and, with a symbol, declares it. */
export function checkCode(entries, root) {
  const problems = [];
  for (const e of entries) {
    for (const ref of e.code ?? []) {
      const [file, symbol] = ref.split('#');
      if (!file || !exists(root, file)) {
        problems.push(`${e.id}: code file missing: ${file}`);
        continue;
      }
      if (symbol !== undefined && (symbol === '' || !declares(read(root, file), symbol))) problems.push(`${e.id}: ${file} does not declare ${symbol}`);
    }
  }
  return problems;
}

/** Every `tests` file exists. Test files under a package's src/test or tools/ci are picked up by that package's own glob. */
export function checkTests(entries, root) {
  const problems = [];
  for (const e of entries) for (const t of e.tests ?? []) if (!exists(root, t)) problems.push(`${e.id}: tests file missing: ${t}`);
  return problems;
}

/* ── the deny-list ───────────────────────────────────────────────────────────── */

/**
 * Phrases that were false when they were found (plan 0.2). `unless` excuses a line that states the
 * correction; `where`: 'all' scans every guarded file, 'public' only README.md, docs/PUBLIC-README.md and
 * the site's lt/* (the places that present the current release).
 */
export const DENY = [
  { id: 'subscription-signin', re: /no way to sign in/i, why: 'Claude Code and Codex run on the person\'s signed-in CLI, subscription included' },
  { id: 'picker-weak', re: /3% to 9%/, why: 'the trained ranker reads contents; the old picker figure is history (84.9% vs 51.0% for grep)' },
  { id: 'tool-count', re: /\bAll (?:\d+|sixteen) (?:\w+ )?tools\b/i, why: 'the registry has more tools; the Settings row derives its count from it' },
  { id: 'surface-count', re: /\b8 surfaces\b/i, why: '6 surfaces ship' },
  { id: 'chart-height', re: /taller than 420/i, unless: /superseded|no height cap/i, why: 'the 420 px cap was reversed in 0.1.5' },
];

/** Stale "current" version strings: 0.1.4 and 0.1.5 are not the current release. */
export const STALE_CURRENT = [
  { id: 'stale-current-version', re: /current (?:version|release)(?: is|:)?\s*v?0\.1\.[45]\b/i, where: 'public' },
  { id: 'stale-download', re: /\bdownload v0\.1\.[45]\b/i, where: 'public' },
  { id: 'stale-whats-new', re: /what['’]?s new in 0\.1\.[45]\b/i, where: 'readme' },
];

export function walk(root, rel, accept) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(root, r, accept));
    else if (accept(e.name)) out.push(r);
  }
  return out;
}

/** The guarded files, relative to root. */
export function guardedFiles(root) {
  return {
    readme: ['README.md', 'docs/PUBLIC-README.md'].filter((f) => exists(root, f)),
    releases: walk(root, 'docs/releases', (n) => /^v[\d.]+\.md$/.test(n)),
    site: walk(root, 'site/src/components/lt', (n) => /\.(ts|tsx)$/.test(n)),
    settings: walk(root, 'packages/web2/src/settings', (n) => /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)),
  };
}

/** The version the app is: packages/desktop/package.json, with any four-part build number kept. */
export function currentVersion(root) {
  return JSON.parse(read(root, 'packages/desktop/package.json')).version;
}

/** `v0.1.7.md` is the current release's notes when the app is 0.1.7 or 0.1.7.N. */
export function currentReleaseFile(root) {
  const three = currentVersion(root).split('.').slice(0, 3).join('.');
  return `docs/releases/v${three}.md`;
}

/**
 * Scan `files` ({rel: text}) for the deny-list. Returns "file:line: id" strings. `kinds` says which
 * group each file belongs to, so the current-version rules apply only to the places that present the
 * current release.
 */
export function scanDeny(texts, kinds, rules = DENY, stale = STALE_CURRENT) {
  const hits = [];
  for (const [rel, text] of Object.entries(texts)) {
    /* Per paragraph with the whitespace folded, so a phrase wrapped over two lines is still one phrase. */
    const paras = [];
    let at = 1;
    for (const chunk of text.split(/(\r?\n\s*\r?\n)/)) {
      if (!/^\r?\n\s*\r?\n$/.test(chunk)) paras.push([at, chunk.replace(/\s+/g, ' ')]);
      at += chunk.split('\n').length - 1;
    }
    paras.forEach(([n, line]) => {
      const i = n - 1;
      for (const r of rules) if (r.re.test(line) && !(r.unless && r.unless.test(line))) hits.push(`${rel}:${i + 1}: ${r.id} (${r.why})`);
      for (const r of stale) {
        const k = kinds[rel];
        const applies = r.where === 'readme' ? k === 'readme' : k === 'readme' || k === 'site' || k === 'current-release';
        if (applies && r.re.test(line)) hits.push(`${rel}:${i + 1}: ${r.id}`);
      }
    });
  }
  return hits;
}

/**
 * A partial claim with a guard: no sentence of public copy may be about its topic, name the engines it does
 * not hold for, and carry none of the scoping words. `files` is {rel: text}; whitespace is folded per paragraph.
 */
export function checkEngineGuards(entries, files) {
  const problems = [];
  for (const e of entries) {
    if (e.status === 'real' || !e.guard) continue;
    const topic = new RegExp(e.guard.topic, 'i');
    const words = new RegExp(e.guard.words, 'i');
    const unless = new RegExp(e.guard.unless, 'i');
    for (const [rel, text] of Object.entries(files)) {
      for (const para of text.split(/\r?\n\s*\r?\n/)) {
        for (const sentence of para.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/)) {
          if (topic.test(sentence) && words.test(sentence) && !unless.test(sentence)) problems.push(`${rel}: asserts ${e.id} for an engine it does not hold on: ${sentence.slice(0, 120)}`);
        }
      }
    }
  }
  return problems;
}

/** README's "The current version is X" must be the app's version. */
export function checkReadmeVersion(texts, version) {
  const problems = [];
  for (const [rel, text] of Object.entries(texts)) {
    for (const m of text.matchAll(/current version is v?(\d+(?:\.\d+){2,3})/gi)) if (m[1] !== version) problems.push(`${rel}: says the current version is ${m[1]}, the app is ${version}`);
  }
  return problems;
}

/* ── partial claims keep their scope ─────────────────────────────────────────── */

const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase();

/**
 * A partial or off claim that carries `scopeWords` may be quoted in public copy only with one of those
 * words nearby (same paragraph). A quote is each ` / `-separated part of its text, at least 30 characters.
 */
export function checkPartialScope(entries, texts) {
  const problems = [];
  for (const e of entries) {
    if (e.status === 'real' || !e.scopeWords?.length) continue;
    const quotes = e.text.split(' / ').map(norm).filter((q) => q.length >= 30);
    for (const [rel, text] of Object.entries(texts)) {
      for (const para of text.split(/\r?\n\s*\r?\n/)) {
        const p = norm(para);
        if (quotes.some((q) => p.includes(q)) && !e.scopeWords.some((w) => p.includes(w.toLowerCase()))) problems.push(`${rel}: quotes ${e.id} (${e.status}) without a scope word (${e.scopeWords.join(' | ')})`);
      }
    }
  }
  return problems;
}
