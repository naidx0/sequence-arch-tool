/**
 * Assemble the Sequence Graphite book into one openable file.
 *
 * `_core.html` and every file in `pages/` is a FRAGMENT — no doctype, no head,
 * no body, and all CSS lives in the substrate. This wraps the substrate once,
 * then splices the sheets after it in filename order, which is sheet order.
 *
 *   node docs/brand/graphite/tools/assemble.mjs
 *   -> docs/brand/graphite/sequence-graphite.html
 *
 * Deliberately dumb: no templating, no minification, no reordering. The book is
 * the fragments; this only makes them viewable in a browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOK = path.resolve(HERE, '..');
const OUT = path.join(BOOK, 'sequence-graphite.html');

/** core.autocrlf=true — sources are CRLF in the working tree, LF in git. */
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

const core = read(path.join(BOOK, '_core.html'));

const pagesDir = path.join(BOOK, 'pages');
const pages = fs
  .readdirSync(pagesDir)
  .filter((f) => f.endsWith('.html'))
  .sort();

if (!pages.length) {
  console.error('no sheets found in', pagesDir);
  process.exit(1);
}

const head = [
  '<!doctype html>',
  '<html lang="en" data-theme="dark">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Sequence — Graphite</title>',
  '</head>',
  '<body>',
].join('\n');

const body = [core, ...pages.map((f) => read(path.join(pagesDir, f)))].join(
  '\n\n<!-- ' + '='.repeat(70) + ' -->\n\n',
);

fs.writeFileSync(OUT, head + '\n' + body + '\n</body>\n</html>\n');

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`assembled ${pages.length} sheets + substrate -> ${path.relative(BOOK, OUT)} (${kb} KB)`);
for (const p of pages) console.log('  ' + p);
