/* An import-graph resolver for bench:closure that shares NO code with packages/analyzer: plain regexes over file text.
 * It exists to cross-check Sequence's scan graph (agreement is reported, and a repo where they disagree a lot is not
 * published). Two languages: JS/TS (relative specs, TS ".js"->".ts" ESM specs, workspace package names, tsconfig
 * "paths") and Python (absolute and relative imports resolved against package roots). Pure functions over
 * { files: [repo-relative paths], read(path) -> text }. */
import path from 'node:path';

const posix = path.posix;

/* ---------- shared graph helpers ---------- */
/** reverse adjacency: importers.get(f) = Set of files that import f. `edges` = iterable of [src, dst]. */
export function reverseAdj(edges) {
  const m = new Map();
  for (const [s, d] of edges) { if (s === d) continue; if (!m.has(d)) m.set(d, new Set()); m.get(d).add(s); }
  return m;
}
/** BFS over `adj` from `start`: returns [Set at depth 1, Set at depth 2, ...] (each depth holds only NEW files; start excluded). */
export function bfsByDepth(adj, start, maxDepth = 4) {
  const seen = new Set([start]);
  let frontier = [start];
  const out = [];
  for (let d = 1; d <= maxDepth; d++) {
    const next = new Set();
    for (const f of frontier) for (const i of adj.get(f) ?? []) if (!seen.has(i)) { seen.add(i); next.add(i); }
    out.push(next);
    frontier = [...next];
  }
  return out;
}
/** cumulative sets: result[d-1] = every file within depth d. */
export function cumulative(levels) {
  const acc = new Set();
  return levels.map((l) => { for (const f of l) acc.add(f); return new Set(acc); });
}

/* ---------- JS / TS ---------- */
const JS_EXT = /\.(?:[mc]?[jt]sx?)$/;
export const isJsFile = (p) => JS_EXT.test(p) && !/\.d\.[mc]?ts$/.test(p) && !/(^|\/)(node_modules|dist|build|coverage)\//.test(p);
const JS_SPEC = [
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w$*\s{},]*?\s+from\s+)?['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];
export function jsSpecs(text) {
  const out = new Set();
  for (const re of JS_SPEC) { re.lastIndex = 0; for (const m of text.matchAll(re)) out.add(m[1]); }
  return [...out];
}
const stripJsonComments = (s) => s.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str ?? '').replace(/,(\s*[}\]])/g, '$1');

export function buildJsResolver({ files, read }) {
  const fileSet = new Set(files);
  const tryFile = (stem) => {
    const base = stem.replace(/\.(?:[mc]?jsx?)$/, (m) => m);
    const cands = [stem];
    for (const e of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json']) cands.push(stem + e);
    /* TS ESM: './x.js' names ./x.ts */
    const m = /^(.*)\.(js|jsx|mjs|cjs)$/.exec(base);
    if (m) for (const e of ['.ts', '.tsx', '.mts', '.cts']) cands.push(m[1] + e);
    for (const e of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) cands.push(posix.join(stem, 'index' + e));
    return cands.find((c) => fileSet.has(c)) ?? null;
  };
  /* workspace packages */
  const pkgs = new Map(); // name -> dir
  for (const f of files.filter((p) => posix.basename(p) === 'package.json')) {
    try { const j = JSON.parse(read(f)); if (j.name) pkgs.set(j.name, posix.dirname(f)); } catch { /* unreadable manifest */ }
  }
  const pkgEntry = (dir, sub) => {
    if (sub) return tryFile(posix.join(dir, sub)) ?? tryFile(posix.join(dir, 'src', sub));
    let main = null;
    try { const j = JSON.parse(read(posix.join(dir, 'package.json'))); main = typeof j.exports === 'string' ? j.exports : typeof j.exports?.['.'] === 'string' ? j.exports['.'] : j.exports?.['.']?.import ?? j.exports?.['.']?.default ?? j.module ?? j.main ?? null; if (typeof main !== 'string') main = null; } catch { /* no manifest */ }
    const order = [main && posix.join(dir, main), posix.join(dir, 'src/index'), posix.join(dir, 'index'), posix.join(dir, 'src/main'), posix.join(dir, 'lib/index')].filter(Boolean);
    for (const o of order) { const r = tryFile(o); if (r) return r; }
    return null;
  };
  /* tsconfig paths */
  const aliases = []; // { re, targets: [dir-relative pattern], base }
  for (const f of files.filter((p) => /(^|\/)tsconfig[^/]*\.json$/.test(p))) {
    try {
      const j = JSON.parse(stripJsonComments(read(f)));
      const co = j.compilerOptions ?? {};
      if (!co.paths) continue;
      const base = posix.join(posix.dirname(f), co.baseUrl ?? '.');
      for (const [k, v] of Object.entries(co.paths)) aliases.push({ key: k, targets: v.map((t) => posix.join(base, t)) });
    } catch { /* unparseable tsconfig */ }
  }
  return function resolve(from, spec) {
    if (spec.startsWith('.')) return tryFile(posix.normalize(posix.join(posix.dirname(from), spec)));
    for (const a of aliases) {
      const star = a.key.indexOf('*');
      if (star < 0 ? spec === a.key : spec.startsWith(a.key.slice(0, star)) && spec.endsWith(a.key.slice(star + 1))) {
        const mid = star < 0 ? '' : spec.slice(star, spec.length - (a.key.length - star - 1));
        for (const t of a.targets) { const r = tryFile(t.replace('*', mid)); if (r) return r; }
      }
    }
    /* longest matching workspace package name */
    let best = null;
    for (const [name, dir] of pkgs) if ((spec === name || spec.startsWith(name + '/')) && (!best || name.length > best[0].length)) best = [name, dir];
    if (best) return pkgEntry(best[1], spec === best[0] ? '' : spec.slice(best[0].length + 1));
    return null;
  };
}

export function jsEdges({ files, read }) {
  const resolve = buildJsResolver({ files, read });
  const edges = [];
  for (const f of files.filter(isJsFile)) {
    let text = '';
    try { text = read(f); } catch { continue; }
    for (const spec of jsSpecs(text)) { const t = resolve(f, spec); if (t && isJsFile(t) && t !== f) edges.push([f, t]); }
  }
  return edges;
}

/* ---------- Python ---------- */
export const isPyFile = (p) => p.endsWith('.py') && !/(^|\/)(node_modules|build|dist|\.tox|venv|\.venv)\//.test(p);
/** Statements `import a.b as c, d` / `from x import (a, b as c)`; relative dots kept. */
export function pyImports(text) {
  const out = [];
  const src = text.replace(/\\\n/g, ' ').replace(/#[^\n]*/g, '');
  for (const m of src.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]+)/gm)) {
    const names = m[3].replace(/[()]/g, ' ').split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter((s) => /^[\w*]+$/.test(s));
    out.push({ kind: 'from', dots: m[1].length, mod: m[2], names });
  }
  for (const m of src.matchAll(/^[ \t]*import[ \t]+([^\n]+)/gm)) {
    for (const part of m[1].split(',')) { const mod = part.trim().split(/\s+as\s+/)[0].trim(); if (/^[\w.]+$/.test(mod)) out.push({ kind: 'import', dots: 0, mod, names: [] }); }
  }
  return out;
}
export function pyEdges({ files, read }) {
  const py = files.filter(isPyFile);
  const set = new Set(py);
  /* package roots: the parent of every top-most package directory (a directory with __init__.py whose parent has none), the repo root, src/ */
  const hasInit = new Set(py.filter((p) => posix.basename(p) === '__init__.py').map((p) => posix.dirname(p)));
  const roots = new Set(['.', 'src']);
  for (const d of hasInit) { let top = d; while (hasInit.has(posix.dirname(top)) && posix.dirname(top) !== top) top = posix.dirname(top); roots.add(posix.dirname(top)); }
  const modOf = new Map(); // dotted -> file
  for (const r of roots) {
    for (const p of py) {
      const rel = r === '.' ? p : p.startsWith(r + '/') ? p.slice(r.length + 1) : null;
      if (rel === null) continue;
      const noExt = rel.replace(/\.py$/, '');
      const dotted = (posix.basename(noExt) === '__init__' ? posix.dirname(noExt) : noExt).split('/').join('.');
      if (dotted && dotted !== '.' && !modOf.has(dotted)) modOf.set(dotted, p);
    }
  }
  const edges = [];
  for (const f of py) {
    let text = '';
    try { text = read(f); } catch { continue; }
    const pkgDir = posix.dirname(f);
    for (const im of pyImports(text)) {
      const targets = [];
      if (im.dots > 0) {
        let base = pkgDir;
        for (let i = 1; i < im.dots; i++) base = posix.dirname(base);
        const modPath = im.mod ? posix.join(base, ...im.mod.split('.')) : base;
        const asFile = [modPath + '.py', posix.join(modPath, '__init__.py')].find((c) => set.has(c));
        if (asFile) targets.push(asFile);
        for (const n of im.names) { const sub = [posix.join(modPath, n + '.py'), posix.join(modPath, n, '__init__.py')].find((c) => set.has(c)); if (sub) targets.push(sub); }
      } else if (im.kind === 'import') {
        /* `import a.b.c` binds a.b.c and loads a, a.b */
        const parts = im.mod.split('.');
        for (let i = 1; i <= parts.length; i++) { const t = modOf.get(parts.slice(0, i).join('.')); if (t) targets.push(t); }
      } else {
        const parts = im.mod.split('.');
        for (let i = 1; i <= parts.length; i++) { const t = modOf.get(parts.slice(0, i).join('.')); if (t) targets.push(t); }
        for (const n of im.names) { const t = modOf.get(`${im.mod}.${n}`); if (t) targets.push(t); }
      }
      for (const t of targets) if (t !== f) edges.push([f, t]);
    }
  }
  return edges;
}

/* ---------- grep patterns an agent would write (used by the grep-BFS arm) ---------- */
/** The module stem a grep looks for: file basename without extension; for index/__init__ files the directory name. */
export function moduleStem(file) {
  const base = posix.basename(file).replace(/\.[^.]+$/, '');
  if (base === 'index' || base === '__init__') return posix.basename(posix.dirname(file)) || base;
  return base;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** ripgrep pattern (Rust regex) matching an import line that names `stem`. */
export function importGrepPattern(lang, stem) {
  const s = esc(stem);
  if (lang === 'python') return `^\\s*(from|import)\\s+[\\w.]*\\b${s}\\b|^\\s*from\\s+[\\w.]+\\s+import\\s+.*\\b${s}\\b`;
  return `(from|import|require)\\b.*['"][^'"]*\\b${s}(\\.\\w+)?['"]`;
}
export const langGlobs = (lang) => (lang === 'python' ? ['*.py'] : ['*.js', '*.jsx', '*.mjs', '*.cjs', '*.ts', '*.tsx', '*.mts', '*.cts']);
