/**
 * Derives the route inventory that src/test/route-inventory.test.ts replays against the live server.
 *
 *   node scripts/gen-route-inventory.mjs <rev> [<path-to-repoServer.ts-at-that-rev>]
 *
 * Reads `handle()` of repoServer.ts as it stood at <rev> (default: `git show <rev>:packages/analyzer/src/server/repoServer.ts`)
 * and records EVERY place the old monolith decided something from the path: `pathname === '/x'`,
 * `pathname.startsWith('/x/')`, and each route regex (`.exec(pathname)` / `.test(pathname)`, resolved when it is a named
 * constant). Each entry carries the methods the surrounding `if` mentions (GET when it mentions none) and an example
 * request path. The result is written next to the test, so the test never needs git history.
 *
 * The point: a route that moves out of repoServer.ts and is left out of the dispatch line quietly turns into the
 * `/api/*` catch-all 404. The test derives its subject set from THIS list, not from a hand-kept one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = path.resolve(here, '..');

const rev = process.argv[2];
if (!rev) throw new Error('usage: gen-route-inventory.mjs <rev> [file]');
const text = process.argv[3]
  ? fs.readFileSync(process.argv[3], 'utf8')
  : execFileSync('git', ['show', `${rev}:packages/analyzer/src/server/repoServer.ts`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const sf = ts.createSourceFile('repoServer.ts', text, ts.ScriptTarget.ES2022, true);
let handle;
const find = (n) => {
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'handle') handle = n;
  ts.forEachChild(n, find);
};
find(sf);
if (!handle) throw new Error('handle() not found');

/** `export const NAME = /re/;` anywhere under src/server, for the named route regexes. */
function resolveRegex(name) {
  const dir = path.join(root, 'src', 'server');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const m = new RegExp('const ' + name + '\\s*=\\s*(/.+/[a-z]*);').exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (m) return m[1];
  }
  return null;
}

/** Index of the paren closing the one opened at `open`. */
function closeOf(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '(') d++;
    else if (s[i] === ')' && --d === 0) return i;
  }
  return -1;
}

/** Example paths a route regex accepts: with every optional group dropped, and with every one taken (first alternative). */
function synth(reLiteral) {
  const body = reLiteral.replace(/^\//, '').replace(/\/[a-z]*$/, '').replace(/^\^/, '').replace(/\$$/, '');
  const expand = (src, takeOptional) => {
    let out = '';
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') { out += src[i + 1] === '/' ? '/' : src[i + 1] === '.' ? '.' : src[i] + src[i + 1]; i++; continue; }
      if (c === '(') {
        const end = closeOf(src, i);
        let inner = src.slice(i + 1, end);
        const optional = src[end + 1] === '?';
        const capturing = !inner.startsWith('?:');
        if (!capturing) inner = inner.slice(2);
        if (optional && !takeOptional) { i = end + 1; continue; }
        // first alternative at depth 0
        let depth = 0, cut = inner.length;
        for (let j = 0; j < inner.length; j++) {
          if (inner[j] === '\\') { j++; continue; }
          if (inner[j] === '(') depth++;
          else if (inner[j] === ')') depth--;
          else if (inner[j] === '|' && depth === 0) { cut = j; break; }
        }
        inner = inner.slice(0, cut);
        out += inner === '[^/]+' ? 'dummy-id' : expand(inner, takeOptional);
        i = optional ? end + 1 : end;
        continue;
      }
      if (c === '[') { const end = src.indexOf(']', i); out += src.slice(i, end + 1) === '[^/]+' ? 'dummy-id' : 'x'; i = end; if (src[i + 1] === '+' || src[i + 1] === '*') i++; continue; }
      out += c;
    }
    return out;
  };
  return [...new Set([expand(body, false), expand(body, true)])];
}

/**
 * Prefix guards that hand the request to a delegate module whose own sub-paths are not literals in handle():
 * the delegate declines an unknown tail, which would read as the catch-all. These are the delegate's real paths.
 */
const DELEGATED = {
  '/api/import/': ['/api/import/sessions', '/api/import/session'],
  '/api/harness/refine/': ['keep', 'accept', 'deny', 'rollback'].map((x) => '/api/harness/refine/dummy-id/' + x),
  '/api/app/': ['/api/app/version', '/api/app/update', '/api/app/releases'],
  '/api/onboarding/': ['/api/onboarding/providers', '/api/onboarding/setup'],
  '/api/onboarding/skills/': ['/api/onboarding/skills/find', '/api/onboarding/skills/import', '/api/onboarding/skills/remove'],
};

const entries = new Map(); // key -> { kind, pattern, example, methods:Set }
function add(kind, pattern, example, found) {
  const { methods, precise } = found;
  const key = kind + ' ' + pattern;
  const e = entries.get(key) ?? { kind, pattern, examples: [].concat(example), methods: new Set(), precise: true };
  e.precise = e.precise && precise;
  for (const m of methods) e.methods.add(m);
  entries.set(key, e);
}

/** Methods named by `method === 'X'` inside the nearest enclosing statements (the condition and the body). */
/** `method === 'X'` literals anywhere inside an expression. */
function methodLiterals(expr) {
  const out = new Set();
  const scan = (n) => {
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
      const l = n.left, r = n.right;
      if (ts.isIdentifier(l) && l.text === 'method' && ts.isStringLiteral(r)) out.add(r.text);
    }
    ts.forEachChild(n, scan);
  };
  scan(expr);
  return out;
}

/**
 * The methods the path comparison itself is conjoined with: `pathname === '/x' && method === 'GET'`, also through
 * `||` groups and parentheses. PRECISE: the route was written as a (path, method) pair, so every such method must be served.
 * Anything else falls back to the methods the surrounding `if` mentions, which only says the path is served by SOMETHING.
 */
function preciseMethods(node) {
  let cur = node;
  for (let hops = 0; hops < 8 && cur.parent; hops += 1) {
    const p = cur.parent;
    if (ts.isParenthesizedExpression(p)) { cur = p; continue; }
    if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
      if (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        const other = p.left === cur ? p.right : p.left;
        const m = methodLiterals(other);
        if (m.size > 0) return m;
      }
      cur = p;
      continue;
    }
    break;
  }
  return null;
}

function methodsAround(node) {
  const exact = preciseMethods(node);
  if (exact) return { methods: exact, precise: true };
  return { ...methodsAroundLoose(node), precise: false };
}

function methodsAroundLoose(node) {
  const found = new Set();
  let cur = node;
  let hops = 0;
  while (cur && cur !== handle.body && hops < 6) {
    if (ts.isIfStatement(cur)) {
      const scan = (n) => {
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
          const l = n.left, r = n.right;
          if (ts.isIdentifier(l) && l.text === 'method' && ts.isStringLiteral(r)) found.add(r.text);
        }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
          const l = n.left, r = n.right;
          if (ts.isIdentifier(l) && l.text === 'method' && ts.isStringLiteral(r)) found.add(r.text);
        }
        ts.forEachChild(n, scan);
      };
      scan(cur.expression);
      if (found.size === 0) scan(cur.thenStatement);
      if (found.size > 0) break;
    }
    cur = cur.parent;
    hops += 1;
  }
  return { methods: found.size > 0 ? found : new Set(['GET']) };
}

const isPathname = (n) => ts.isIdentifier(n) && n.text === 'pathname';
const visit = (n) => {
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    const [a, b] = [n.left, n.right];
    const lit = isPathname(a) && ts.isStringLiteral(b) ? b.text : isPathname(b) && ts.isStringLiteral(a) ? a.text : null;
    if (lit && lit.startsWith('/')) add('exact', lit, lit, methodsAround(n));
  }
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
    const pe = n.expression;
    if (pe.name.text === 'startsWith' && isPathname(pe.expression) && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0])) {
      const p = n.arguments[0].text;
      if (p.startsWith('/')) {
        const base = p.endsWith('/') ? p : p + '/';
        /* a guard written `startsWith(prefix) && endsWith(suffix)` serves ONLY that shape: probe it */
        let ifs = n;
        while (ifs && !ts.isIfStatement(ifs)) ifs = ifs.parent;
        const suffixes = ifs ? [...ifs.expression.getText().matchAll(/pathname.endsWith('([^']+)')/g)].map((m) => m[1]) : [];
        const examples = suffixes.length > 0 ? suffixes.map((x) => base + 'dummy-id' + x) : DELEGATED[p] ?? [base + 'x'];
        add('prefix', p, examples, methodsAround(n));
      }
    }
    if ((pe.name.text === 'exec' || pe.name.text === 'test') && n.arguments.length === 1 && isPathname(n.arguments[0])) {
      const target = pe.expression;
      let re = null;
      if (ts.isRegularExpressionLiteral(target)) re = target.text;
      else if (ts.isIdentifier(target)) re = resolveRegex(target.text);
      if (re) add('regex', re, synth(re), methodsAround(n));
      else console.error('unresolved route regex:', target.getText());
    }
  }
  ts.forEachChild(n, visit);
};
visit(handle.body);

const out = {
  generatedFrom: rev,
  catchAllMarker: 'unknown endpoint:',
  routes: [...entries.values()]
    .map((e) => ({ kind: e.kind, pattern: e.pattern, examples: e.examples, methods: [...e.methods].sort(), precise: e.precise }))
    .sort((a, b) => (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : a.kind < b.kind ? -1 : 1)),
};
const dest = path.join(root, 'src', 'test', 'route-inventory.routes.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${path.relative(root, dest)}: ${out.routes.length} routes from ${rev}`);
