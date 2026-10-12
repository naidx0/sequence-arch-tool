/**
 * THE MAC AGENT PROMPT: rendered with a Copy button, carries no version, and is
 * the same text as docs/install/mac-agent-prompt.md.
 *
 * Reads the real components: esbuild bundles Get.tsx (with the real release.ts
 * and macPrompt.ts) and react-dom/server renders it, once as a Mac and once as
 * a Windows machine. Run with `npm test` from site/.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';
import { build } from 'esbuild';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
const DOC = path.resolve(SITE, '..', 'docs', 'install', 'mac-agent-prompt.md');

/* Inside node_modules so the bundle resolves react / react-dom like the site does. */
const CACHE = path.join(SITE, 'node_modules', '.cache');
fs.mkdirSync(CACHE, { recursive: true });

async function bundle(entrySource, name) {
  const dir = fs.mkdtempSync(path.join(CACHE, 'mac-prompt-'));
  const outfile = path.join(dir, `${name}.mjs`);
  await build({
    stdin: { contents: entrySource, resolveDir: SITE, loader: 'tsx' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    alias: { '@': path.join(SITE, 'src') },
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server'],
    nodePaths: [path.join(SITE, 'node_modules')],
    logLevel: 'silent',
  });
  return import(url.pathToFileURL(outfile).href);
}

const mod = await bundle(
  `export { renderToStaticMarkup } from 'react-dom/server';
   export { createElement } from 'react';
   export { Get } from '@/components/lt/Get';
   export { copyPrompt, copyButtonLabel } from '@/components/lt/MacAgent';
   export { MAC_AGENT_PROMPT } from '@/data/macPrompt';
   export { VERSION } from '@/data/release';`,
  'entry',
);

function render(userAgent) {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true });
  return mod.renderToStaticMarkup(mod.createElement(mod.Get));
}

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

test('download area shows the Mac agent block with a Copy button, open on a Mac', () => {
  const html = render(MAC_UA);
  assert.match(html, /data-testid="mac-agent"/);
  assert.match(html, /Easiest on a Mac: give this to your agent/);
  assert.match(html, /<details class="lt-mac" open=""/);
  assert.match(html, /<button[^>]*>Copy prompt<\/button>/);
  assert.match(html, /releases\/latest/);
  assert.match(html, /SHASUMS256\.txt/);
  assert.match(html, /xattr -dr com\.apple\.quarantine \/Applications\/Sequence\.app/);
});

test('on Windows the block is a closed disclosure and the Windows button is still lit', () => {
  const html = render(WIN_UA);
  assert.match(html, /<details class="lt-mac"(?! open)/);
  assert.match(html, /lt-os-btn is-lit/);
  assert.match(html, /Download Sequence/);
});

test('the prompt contains no hard-coded version', () => {
  const prompt = mod.MAC_AGENT_PROMPT;
  assert.ok(!prompt.includes(mod.VERSION), `prompt must not contain ${mod.VERSION}`);
  assert.doesNotMatch(prompt, /\bv?\d+\.\d+\.\d+\b/);
  assert.doesNotMatch(prompt, /\/releases\/download\//);
});

test('the prompt is safe: no sudo by default, no curl piped to a shell', () => {
  const prompt = mod.MAC_AGENT_PROMPT;
  assert.doesNotMatch(prompt, /curl[^\n]*\|\s*(sh|bash|zsh)/);
  assert.match(prompt, /Do not use sudo/);
  assert.match(prompt, /xattr -dr com\.apple\.quarantine \/Applications\/Sequence\.app/);
});

function stubClipboard(writeText) {
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText } }, configurable: true });
}

test('copy: a rejected clipboard write selects the text and the button says so', async () => {
  stubClipboard(() => Promise.reject(new Error('clipboard blocked')));
  let selected = false;
  const outcome = await mod.copyPrompt(undefined, () => {
    selected = true;
  });
  assert.equal(outcome, 'selected');
  assert.equal(selected, true, 'the prompt text must be selected');
  assert.equal(mod.copyButtonLabel(outcome), 'Selected. Press Cmd+C');
});

test('copy: a successful clipboard write writes the prompt and the button says Copied', async () => {
  let written = null;
  stubClipboard((text) => {
    written = text;
    return Promise.resolve();
  });
  const outcome = await mod.copyPrompt(undefined, () => assert.fail('must not select on success'));
  assert.equal(outcome, 'copied');
  assert.equal(written, mod.MAC_AGENT_PROMPT);
  assert.equal(mod.copyButtonLabel(outcome), 'Copied');
  assert.equal(mod.copyButtonLabel('idle'), 'Copy prompt');
});

test('the site copy is the same text as docs/install/mac-agent-prompt.md', () => {
  const md = fs.readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
  const m = md.match(/```text\n([\s\S]*?)\n```/);
  assert.ok(m, 'doc has a ```text block');
  assert.equal(mod.MAC_AGENT_PROMPT, m[1]);
});
