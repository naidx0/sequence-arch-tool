import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Owner report (Windows test session): the app rendered raw HTTP plumbing at the
 * user — verbatim, in the UI:
 *
 *   "no repo attached — attach one via POST /api/attach"
 *   "AI provider not configured — connect your AI key to design (PUT /api/ai-config first)"
 *
 * Those strings are developer notes, not user copy: a person reading them has no
 * POST button and no route to type into. Honest errors (a non-negotiable) means
 * telling the user what THEY can do — "open a repository from the home screen",
 * "connect your AI key in Settings".
 *
 * This is a SOURCE-SCAN lock over the two files that produce user-visible error
 * strings, so the whole CLASS is closed: no error message the server hands back
 * may carry an HTTP verb + route. The exact new copy is also pinned, because the
 * web classifier (packages/web/src/panels/aiErrors.ts) keys off the stable
 * phrases "AI provider not configured" / "connect your AI key".
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_SRC = path.resolve(here, '..', '..', 'src');
const REPO_SERVER = path.join(ANALYZER_SRC, 'server', 'repoServer.ts');
const TERMINAL = path.join(ANALYZER_SRC, 'server', 'terminal.ts');

/** Strip line + block comments — a code comment may still name a route. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Extract the full argument text of every `sendError(...)` / `rejectUpgrade(...)`
 * call, balancing parentheses so multi-line calls are captured whole.
 */
function errorCallArgs(src: string): { call: string; args: string }[] {
  const out: { call: string; args: string }[] = [];
  const re = /\b(sendError|rejectUpgrade)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    out.push({ call: m[1], args: src.slice(start, i - 1) });
  }
  return out;
}

/** The leak shape the owner saw: an HTTP verb immediately in front of a route. */
const RAW_ROUTE = /\b(GET|POST|PUT|DELETE|PATCH)\s+\/api/;

test('server errors: no user-facing error message carries an HTTP verb + /api route', () => {
  const offenders: string[] = [];
  for (const file of [REPO_SERVER, TERMINAL]) {
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    for (const { call, args } of errorCallArgs(src)) {
      if (RAW_ROUTE.test(args)) {
        offenders.push(`${path.basename(file)}: ${call}(${args.replace(/\s+/g, ' ').trim()})`);
      }
    }
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'error copy must say what the USER can do — never "via POST /api/…" or "(PUT /api/… first)"'
  );
});

test('server errors: the human replacements for the owner-reported strings are the ones shipped', () => {
  const repoServer = fs.readFileSync(REPO_SERVER, 'utf8');
  const terminal = fs.readFileSync(TERMINAL, 'utf8');

  const expected: [string, string][] = [
    [REPO_SERVER, 'no repo attached — open a repository from the home screen first'],
    [REPO_SERVER, 'AI provider not configured — connect your AI key in Settings to research'],
    [REPO_SERVER, 'AI provider not configured — connect your AI key in Settings to chat'],
    [REPO_SERVER, 'AI provider not configured — connect your AI key in Settings to design'],
    [REPO_SERVER, 'AI provider not configured — connect your AI key in Settings'],
    [REPO_SERVER, 'connect GitHub in Settings first'],
    [REPO_SERVER, 'connect GitHub in Settings first to clone by name, or paste a clone URL'],
    [REPO_SERVER, 'no design spec found — create one on the Design board first'],
    [TERMINAL, 'no repo attached — open a repository first'],
  ];
  const sources: Record<string, string> = { [REPO_SERVER]: repoServer, [TERMINAL]: terminal };
  for (const [file, phrase] of expected) {
    assert.ok(
      sources[file].includes(phrase),
      `${path.basename(file)} must ship the human copy: ${phrase}`
    );
  }

  // The dead developer strings must not come back anywhere in those files.
  for (const dead of [
    'attach one via POST',
    'PUT /api/ai-config first',
    'connect GitHub first (PUT',
    'save one via PUT /api/spec',
  ]) {
    assert.ok(!repoServer.includes(dead), `the developer-facing string must stay gone: ${dead}`);
  }
});

test('server errors: the not-configured copy still matches the web aiErrors classifier', () => {
  // packages/web/src/panels/aiErrors.ts keys the friendly "add a key in Settings"
  // CTA off these two stable phrases. Rewording the copy must never desync them.
  const repoServer = fs.readFileSync(REPO_SERVER, 'utf8');
  const notConfigured = errorCallArgs(stripComments(repoServer))
    .map((c) => c.args)
    .filter((a) => /AI provider not configured/.test(a));
  assert.ok(notConfigured.length >= 5, 'every AI endpoint keeps a not-configured error');
  for (const args of notConfigured) {
    assert.match(args, /ai provider not configured/i, 'classifier marker 1');
    assert.match(args, /connect your ai key/i, 'classifier marker 2');
  }
});
