/**
 * EVERY `var(--x)` IN web2 CSS MUST RESOLVE TO SOMETHING.
 *
 * WHY THIS EXISTS
 * ---------------
 * An undefined custom property is dropped SILENTLY. `color: var(--text)` where
 * no `--text` exists is not an error, not a warning, and not a visible fallback
 * — the declaration simply does not apply, and the element inherits whatever it
 * would have had. So a stylesheet written against the wrong vocabulary looks
 * *almost* right, which is the hardest kind of wrong to see.
 *
 * That was not hypothetical. Until 2026-09-02 the `sequence-design` skill — which
 * AUTO-LOADS on any restyle request in this repo — taught a token vocabulary that
 * had been dead for weeks: `--bg`, `--panel`, `--text`, `--accent-text`,
 * `--r-panel`, `--glass-*`, `--steel-*`. The live substrate is
 * `tokens/graphite.css`: `--bg-ground`, `--surface-N`, `--ink-N`, `--e0..4`,
 * `--t-NN`, `--r-N`. Any agent that loaded that skill wrote CSS against names
 * that do not exist and got no signal at all. The skill was repaired; this test
 * is what makes the repair enforceable, because the next wrong vocabulary will
 * arrive the same way and be just as quiet.
 *
 * Checked on 2026-09-02 when this was written: 21 sheets, 291 tokens defined,
 * ZERO unresolvable references. The dead vocabulary never reached a stylesheet.
 * This test exists so that stays true.
 *
 * WHAT COUNTS AS RESOLVING — three legitimate cases, all verified against the
 * tree rather than assumed:
 *
 *   1. DEFINED IN CSS. `--sp-4: 4px` somewhere in web2's sheets.
 *   2. GIVEN A FALLBACK. `var(--board-cam-z, 1)` is safe by construction: the
 *      author said what happens when it is absent.
 *   3. SET AT RUNTIME from TS/TSX. `--shell-chat-over` and `--shell-rail-over`
 *      are written by `Shell.tsx`, `--side-w` by the shell's layout, and
 *      `--board-cam-z` by `Board.tsx` — real values that only exist once React
 *      has laid the frame out. A CSS-only scan cannot see these and would report
 *      four false positives, which is how a well-meant lock gets deleted.
 *
 * WHAT THIS DOES NOT ASSERT. It does not check that a token means the right
 * thing, or that its value is sane, or that a runtime-set token is actually set
 * on the element that uses it. It asserts the one property whose absence is
 * invisible: that the name exists somewhere. `test/firewall.test.ts` still owns
 * "no hex outside the substrate"; this owns "no name that resolves to nothing".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB2 = path.join(ROOT, 'packages/web2/src');

function walk(dir, test_, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, test_, out);
    else if (test_.test(entry.name)) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8');

/** `--name` on the left of a colon, anywhere in web2's stylesheets. */
function definedTokens(cssFiles) {
  const defined = new Set();
  for (const f of cssFiles) {
    for (const m of read(f).matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1]);
  }
  return defined;
}

/**
 * `--name` mentioned anywhere in TS/TSX — the runtime-set case.
 *
 * Deliberately a plain substring search rather than a parse of the style object:
 * a token is set through `style={{ '--x': v }}`, through `setProperty('--x', v)`,
 * and through a typed cast in at least three spellings in this tree. The
 * question here is only "does any code know this name", and a false ACCEPT is
 * far cheaper than a false reject — a false reject gets this whole test deleted.
 */
function runtimeTokens(codeFiles) {
  const seen = new Set();
  for (const f of codeFiles) {
    for (const m of read(f).matchAll(/(--[A-Za-z0-9_-]+)/g)) seen.add(m[1]);
  }
  return seen;
}

test('every var(--token) in web2 CSS resolves — defined, defaulted, or set at runtime', () => {
  const cssFiles = walk(WEB2, /\.css$/);
  const codeFiles = walk(WEB2, /\.tsx?$/);
  assert.ok(cssFiles.length > 5, `expected web2 stylesheets, found ${cssFiles.length}`);

  const defined = definedTokens(cssFiles);
  const runtime = runtimeTokens(codeFiles);
  assert.ok(defined.size > 100, `expected a real token ramp, found ${defined.size} definitions`);

  const unresolved = [];
  for (const f of cssFiles) {
    const text = read(f);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      /* The `,` capture is the fallback: `var(--x, 1)` is safe by construction. */
      for (const m of line.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)) {
        const [, name, fallback] = m;
        if (fallback) continue;
        if (defined.has(name)) continue;
        if (runtime.has(name)) continue;
        unresolved.push(`${rel(f)}:${i + 1}: var(${name}) — ${line.trim().slice(0, 90)}`);
      }
    });
  }

  assert.equal(
    unresolved.length,
    0,
    `A stylesheet references a custom property that resolves to NOTHING.\n\n` +
      unresolved.slice(0, 12).join('\n') +
      `\n\n  An undefined custom property is dropped silently — no error, no warning,\n` +
      `  no visible fallback. The declaration just does not apply, so the surface\n` +
      `  looks almost right and nothing says why.\n\n` +
      `  WHAT TO DO:\n` +
      `    · Use the live name. The substrate is packages/web2/src/tokens/graphite.css\n` +
      `      (--bg-ground, --surface-N, --ink-N, --e0..4, --t-NN, --lh-NN, --sp-N, --r-N).\n` +
      `      The dead vocabulary a retired skill taught — --bg, --panel, --text,\n` +
      `      --accent-text, --r-panel, --glass-*, --steel-* — does not exist.\n` +
      `    · Or give it a fallback, if absence is a real state: var(--x, 1).\n` +
      `    · Or set it at runtime and it is accepted here automatically.`,
  );
});

test('the scan can actually see a broken token — it is not passing vacuously', () => {
  /*
   * THE GUARD ON THE GUARD. Every assertion above is "found nothing wrong",
   * which is also what a scan that reads no files reports. So prove the detector
   * fires: a synthetic sheet using a name nothing defines must be caught by the
   * same predicate the real scan uses.
   */
  const cssFiles = walk(WEB2, /\.css$/);
  const defined = definedTokens(cssFiles);
  const runtime = runtimeTokens(walk(WEB2, /\.tsx?$/));

  const deadName = '--panel'; // one of the retired skill's own tokens
  assert.ok(
    !defined.has(deadName) && !runtime.has(deadName),
    `${deadName} is supposed to be dead; if it is back, this test's example needs rechoosing`,
  );

  const line = `  color: var(${deadName});`;
  const hits = [...line.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)].filter(
    ([, name, fallback]) => !fallback && !defined.has(name) && !runtime.has(name),
  );
  assert.equal(hits.length, 1, 'the predicate failed to catch a token that resolves to nothing');
});
