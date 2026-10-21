/**
 * THE NATIVE LAYER: the press, the exit and the swipe are CSS, so this reads
 * the CSS. Run with `npm test` from site/ (`node --test tests/*.test.mjs`).
 *
 * What each check reads: src/styles/*.css and the components as written,
 * packages/web2's graphite.css as written, and (when `npm run build` has run)
 * the built stylesheet in dist/assets. It proves the rules exist and the
 * values agree; looking at the page (press, exit, swipe) is a browser job.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const GLOBALS = read(path.join(SITE, 'src/styles/globals.css'));
const NATIVE = read(path.join(SITE, 'src/styles/native.css'));
const LT = read(path.join(SITE, 'src/styles/lt.css'));
const WEB2 = read(path.resolve(SITE, '..', 'packages/web2/src/tokens/graphite.css'));

/** Every innermost rule as { selectors, body }, comments stripped. */
function rules(css) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    out.push({ selectors: m[1].split(',').map((s) => s.trim().replace(/^[\s\S]*@(media|layer)[^{]*\{\s*/, '')), body: m[2] });
  }
  return out;
}
/** True when some rule lists `selector` and its body declares a transform. */
function hasTransform(css, selector) {
  return rules(css).some((r) => r.selectors.includes(selector) && /(^|[;\s])transform\s*:/.test(r.body));
}
const token = (css, name) => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  return m && m[1].replace(/\s+/g, '');
};

/** The classes of every button or link-button in the components. */
function pressables() {
  const found = new Set();
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (p.endsWith('.tsx')) {
        for (const m of read(p).matchAll(/<(?:a|button)\b[^>]*?className="([^"]*)"/g)) {
          for (const c of m[1].split(/\s+/)) {
            if (/^(pill-|lt-btn$|cx-btn$|lt-round$|lt-mini-btn$|lt-tour-btn$|lt-navlink$|cx-navlink$|lt-os-btn$|lt-play$|cx-play$)/.test(c)) found.add(c);
          }
        }
      }
    }
  };
  walk(path.join(SITE, 'src/components'));
  walk(path.join(SITE, 'src/pages'));
  return [...found].sort();
}

test('the checker: a planted rule is found, a missing one is not (controls)', () => {
  assert.equal(hasTransform('.a:active { transform: scale(.9); }', '.a:active'), true);
  assert.equal(hasTransform('.a:hover { transform: scale(.9); }', '.a:active'), false);
  assert.equal(hasTransform('.a:active { color: red; }', '.a:active'), false);
});

test("motion tokens equal the app's (packages/web2 graphite.css)", () => {
  for (const t of ['--dur-1', '--dur-2', '--dur-3', '--dur-4', '--ease', '--ease-enter', '--ease-exit', '--ease-std', '--ease-io']) {
    const app = token(WEB2, t);
    assert.ok(app, `${t} is defined in graphite.css`);
    assert.equal(token(GLOBALS, t), app, `${t} on the site`);
  }
  assert.equal(token(GLOBALS, '--press-scale'), '.97');
});

test('the site has one ease: lt.css reads the site token, not its own curve', () => {
  assert.match(LT, /--lt-ease:\s*var\(--ease\);/);
  assert.equal([...GLOBALS.matchAll(/--ease:/g)].length, 1);
});

test('every button and link-button in the components has a pressed transform', () => {
  const set = pressables();
  assert.ok(set.length >= 8, `found ${set.length} pressables: ${set.join(' ')}`);
  for (const c of set) {
    // Variants (lt-btn-blue) share the base class's press; check the base.
    const base = c.startsWith('lt-btn-') ? '.lt-btn' : c.startsWith('cx-btn-') ? '.cx-btn' : `.${c}`;
    assert.ok(hasTransform(NATIVE, `${base}:active`), `${base}:active has a transform`);
  }
  for (const c of ['.pill-cta', '.pill-ghost', '.store-card']) assert.ok(hasTransform(NATIVE, `${c}:active`), `${c}:active`);
});

test('the press scales by --press-scale and the hover lift is 1px, only where hover exists', () => {
  assert.match(NATIVE, /\.pill-cta:active[\s\S]*?transform:\s*scale\(var\(--press-scale\)\)/);
  assert.match(NATIVE, /@media \(hover: hover\) \{\s*\.pill-cta:hover[\s\S]*?translateY\(-1px\)/);
});

test('shelves swipe: contained sideways, snapped, vertical left to the page', () => {
  for (const sel of ['.shelf', '.lt-gallery']) {
    const body = rules(NATIVE).find((r) => r.selectors.includes(sel) && /overscroll-behavior-x/.test(r.body))?.body;
    assert.ok(body, `${sel} rule`);
    assert.match(body, /overscroll-behavior-x:\s*contain/);
    assert.match(body, /overscroll-behavior-y:\s*auto/);
    assert.match(body, /scroll-snap-type:\s*x mandatory/);
    assert.match(body, /overflow-y:\s*hidden/);
  }
});

test('the dialog has an exit, a drag, a spring and a fling, and takes touch-action none', () => {
  for (const c of ['is-closing', 'is-dragging', 'is-springing', 'is-flinging']) assert.match(NATIVE, new RegExp(`\\.lt-lightbox\\.${c}`));
  assert.match(NATIVE, /@keyframes lt-pop-out/);
  assert.match(NATIVE, /\.lt-lightbox \{[^}]*touch-action:\s*none/);
});

test('mini-map boxes are draggable under touch-action none', () => {
  assert.match(LT, /\.lt-mini-box \{[^}]*touch-action:\s*none/);
});

test('page edge: no overscroll bounce, no tap flash; touch targets are 44px', () => {
  assert.match(NATIVE, /html,\s*body \{\s*overscroll-behavior:\s*none/);
  assert.match(NATIVE, /-webkit-tap-highlight-color:\s*transparent/);
  assert.match(NATIVE, /@media \(pointer: coarse\)[\s\S]*?min-height:\s*44px/);
});

test('reduced motion: no transitions, no press transform, no dialog animation', () => {
  const block = NATIVE.slice(NATIVE.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(block, /\.pill-cta,[\s\S]*?transition:\s*none !important/);
  assert.match(block, /\.pill-cta:active,[\s\S]*?transform:\s*none !important/);
  assert.match(block, /\.lt-lightbox\.is-closing,[\s\S]*?animation:\s*none !important/);
});

test('the built stylesheet carries the layer (needs `npm run build`)', (t) => {
  const dir = path.join(SITE, 'dist/assets');
  const css = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.css')) : [];
  if (!css.length) return t.skip('dist/ is not built');
  const all = css.map((f) => read(path.join(dir, f))).join('\n').replace(/\s+/g, '');
  for (const sel of ['.pill-cta:active', '.pill-ghost:active', '.store-card:active', '.lt-btn:active']) {
    assert.ok(all.includes(sel), `${sel} is in dist`);
  }
  assert.match(all, /--press-scale:\.97/);
});
