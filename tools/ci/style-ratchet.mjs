#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   THE STYLE RATCHET — S4 counts that may only go down
   tools/ci/style-ratchet.mjs

   Three static counts over packages/web2/src, checked against
   tools/measure/style-ratchet.json with the same rule as the perf ratchet
   (tools/ci/perf-ratchet.mjs checkRatchet): above its ceiling fails, below
   fails until the ceiling is lowered in the same commit.

     infiniteAnimations   CSS animation declarations that loop forever
     backdropFilters      backdrop-filter declarations that blur (not none;
                          the -webkit- twin of a declaration is not counted)
     fontBytes            bytes of every bundled font file (src/**\/fonts)
     heavyWeights         weights of 500 or more (font-weight, the font
                          shorthand, a --fw-* token, bold/bolder): the face
                          carries 350-450 (Decisions 41 and 44)

   Static and deterministic: comments are stripped before counting, so a
   rule quoted in prose is not a rule.

     node tools/ci/style-ratchet.mjs [--print]
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkRatchet } from './perf-ratchet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB_SRC = path.join(ROOT, 'packages', 'web2', 'src');
export const STYLE_RATCHET_FILE = path.join(ROOT, 'tools', 'measure', 'style-ratchet.json');

function walk(dir, keep) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...walk(p, keep));
    } else if (keep(p)) out.push(p);
  }
  return out;
}

/** CSS with every comment removed. */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Declarations `prop: value` in a stylesheet, comments stripped. */
function declarations(css) {
  const out = [];
  for (const m of stripComments(css).matchAll(/(^|[;{\s])(-webkit-)?([a-z-]+)\s*:\s*([^;{}]*)/g)) {
    out.push({ webkit: !!m[2], prop: m[3], value: m[4].trim() });
  }
  return out;
}

/** Animations in one stylesheet that loop forever. */
export function countInfinite(css) {
  return declarations(css).filter(
    (d) => (d.prop === 'animation' || d.prop === 'animation-iteration-count') && /\binfinite\b/.test(d.value),
  ).length;
}

/** backdrop-filter declarations that blur or saturate (the -webkit- twin is not counted). */
export function countBackdrop(css) {
  return declarations(css).filter((d) => d.prop === 'backdrop-filter' && !d.webkit && !/^none\b/.test(d.value)).length;
}

const HEAVY = (v) => /^(bold|bolder)$/.test(v) || (/^\d+$/.test(v) && Number(v) >= 500);
/** Weight requests of 500 or more: font-weight, a --fw-* token, a weight in the font shorthand. */
export function countHeavyWeights(css) {
  return declarations(css).filter((d) => {
    if (d.prop === 'font-weight' || /^--fw-/.test(d.prop)) return d.value.split(/\s+/).some(HEAVY);
    if (d.prop === 'font') return d.value.split(/\s+/).some(HEAVY);
    return false;
  }).length;
}

/* The counts are static and deterministic: every read of the same tree
   agrees, so a lower count is a lower ceiling at once (checkRatchet asks
   timing-based counts for agreeing reads before it suggests one). */
export const STATIC_READS = Number.POSITIVE_INFINITY;

export function measureStyle(src = WEB_SRC) {
  const sheets = walk(src, (p) => p.endsWith('.css'));
  let infiniteAnimations = 0;
  let backdropFilters = 0;
  let heavyWeights = 0;
  for (const f of sheets) {
    const css = fs.readFileSync(f, 'utf8');
    infiniteAnimations += countInfinite(css);
    backdropFilters += countBackdrop(css);
    heavyWeights += countHeavyWeights(css);
  }
  const fonts = walk(src, (p) => /[\\/]fonts[\\/][^\\/]+\.(woff2?|ttf|otf)$/.test(p));
  const fontBytes = fonts.reduce((n, f) => n + fs.statSync(f).size, 0);
  return { infiniteAnimations, backdropFilters, fontBytes, heavyWeights };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const measured = measureStyle();
  if (process.argv.includes('--print')) console.log(JSON.stringify(measured));
  const ratchet = JSON.parse(fs.readFileSync(STYLE_RATCHET_FILE, 'utf8'));
  const { ok, lines } = checkRatchet(ratchet, { ...measured, $reads: STATIC_READS });
  for (const l of lines) console.log(l.replace('tools/measure/perf-ratchet.json', 'tools/measure/style-ratchet.json'));
  console.log(ok ? 'PASS  style-ratchet' : 'FAIL  style-ratchet');
  process.exit(ok ? 0 : 1);
}
