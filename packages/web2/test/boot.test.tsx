import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app/App';

/**
 * ITEM 0.1 — THE BOOT HALF OF THE LOCK: ZERO NETWORK REQUESTS TO A FONT CDN.
 *
 * Local-first is a non-negotiable, not a preference: the app boots and delivers
 * its core with no network and no key. The Graphite book links Google Fonts at
 * _core.html:148-150 and says in the same breath why the app must not — "a
 * local-first product that blocks first paint on a CDN contradicts itself."
 *
 * The regression this guards is a paste, not a design decision. The book's
 * three <link> tags are sitting right there in a file everyone reads, they are
 * the fastest way to make a font "work" when something is misconfigured
 * locally, and NOTHING ELSE IN THE BUILD WOULD NOTICE: the app renders
 * correctly on a developer machine, every other test stays green, and the
 * failure only appears on a machine that is offline or behind a filter — which
 * is precisely the machine local-first exists for.
 *
 * Two independent doors are checked, because the two ways a CDN font gets in
 * are unrelated and either alone would leave a gap:
 *   - a <link> or <script> in index.html          → checked against the parsed boot document
 *   - an @import or url() in the bundled CSS      → checked against what actually reached jsdom
 * and a runtime spy covers a third: code that fetches a font at boot.
 */

const FONT_CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/*
 * Resolved from cwd, not from import.meta.url: under jsdom, `import.meta.url`
 * is an http:// URL and fileURLToPath rejects it. Vitest sets cwd to the
 * package root — the directory holding vitest.config.ts — so index.html is one
 * join away. Guarded, because a resolution that silently missed would make
 * every assertion below vacuous.
 */
const INDEX_HTML = resolve(process.cwd(), 'index.html');
if (!existsSync(INDEX_HTML)) {
  throw new Error(`boot document not found at ${INDEX_HTML} (cwd ${process.cwd()})`);
}

/**
 * CSS comments are stripped before scanning.
 *
 * A comment cannot open a socket, and the token sheet's own header discusses
 * these very hostnames in order to explain why they are absent — so scanning
 * raw text would fail on the documentation of the rule rather than on a breach
 * of it. Stripping comments is what makes the check about behaviour.
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every stylesheet that actually reached the document, as text. Vitest's
 *  `css: true` runs these through the real Vite pipeline, so this is the
 *  bundled output rather than the source of any file. */
function bootedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('\n');
}

/**
 * Absolute URLs only.
 *
 * A protocol-relative `//host/…` counts: it is absolute at run time and is the
 * classic way to slip a CDN past a check that only looks for `https://`.
 *
 * The lookahead demanding a dotted hostname, and the lookbehind rejecting a
 * preceding base64 character, are both load-bearing. Vite inlines small font
 * files as base64 data URIs, and base64 is full of `//` runs — a looser pattern
 * reports those as absolute URLs and the test fails on a font that is doing
 * exactly what it should. A test that fails for the wrong reason gets
 * "fixed" by loosening the assertion, which is how a real check dies.
 */
function absoluteUrlsIn(text: string): string[] {
  return text.match(/(?<![\w+/=])(?:https?:)?\/\/(?=[a-z0-9-]+(?:\.[a-z0-9-]+)+)[^\s"')]+/gi) ?? [];
}

describe('item 0.1 — boot touches no font CDN', () => {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  const realOpen = globalThis.XMLHttpRequest?.prototype.open;

  beforeEach(() => {
    seen.length = 0;

    globalThis.fetch = vi.fn((input: unknown) => {
      seen.push(String(input));
      return Promise.reject(new Error('no network in a boot test'));
    }) as unknown as typeof fetch;

    if (globalThis.XMLHttpRequest) {
      globalThis.XMLHttpRequest.prototype.open = function open(
        this: XMLHttpRequest,
        _method: string,
        url: string | URL,
      ) {
        seen.push(String(url));
      } as unknown as XMLHttpRequest['open'];
    }
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (globalThis.XMLHttpRequest && realOpen) {
      globalThis.XMLHttpRequest.prototype.open = realOpen;
    }
  });

  it('issues only the chat-column boot reads while booting', () => {
    render(<App />);

    /*
     * P2.5 blank workspace: chat alone by default. Legitimate reads:
     * ai-config (model label), sessions list (sidebar), chat-memory + canvas-doc (reload).
     */
    const hosts = seen.map((u) => {
      try {
        return new URL(u, 'http://localhost').pathname;
      } catch {
        return u;
      }
    });
    for (const path of hosts) {
      expect(['/api/ai-config', '/api/sessions', '/api/chat-memory', '/api/canvas-doc'].includes(path)).toBe(true);
    }
  });

  it('names no font CDN in any stylesheet that reached the document', () => {
    render(<App />);

    const css = stripCssComments(bootedCss());

    expect(css.length).toBeGreaterThan(0);
    for (const host of FONT_CDN_HOSTS) {
      expect(css).not.toContain(host);
    }
  });

  it('loads every @font-face from a local file, never an absolute URL', () => {
    render(<App />);

    const css = stripCssComments(bootedCss());

    // The fonts must actually be here — an empty sheet would pass the
    // "no CDN" checks above for the wrong reason entirely.
    expect(css).toContain('@font-face');
    expect(css).toContain('Instrument Sans');
    expect(css).toContain('JetBrains Mono');

    const srcUrls = (css.match(/src:\s*[^;}]+/g) ?? []).flatMap(absoluteUrlsIn);
    expect(srcUrls).toEqual([]);
  });

  it('carries no absolute URL anywhere in the booted CSS', () => {
    render(<App />);

    expect(absoluteUrlsIn(stripCssComments(bootedCss()))).toEqual([]);
  });

  /**
   * index.html is read from disk and PARSED, then asserted against as a DOM.
   *
   * §4.6 bans the source-grep tier, and rightly — 179 of v1's test files grep
   * source text as a proxy for behaviour. This is not that. index.html is not a
   * source file the bundler transforms; it IS the boot document, byte for byte,
   * and the assertions below are on elements and their resolved attributes,
   * not on substrings of a file. There is no other way to observe the boot
   * document's own <head>, because by the time a render test runs, the head it
   * sees is jsdom's, not this one.
   */
  it('has no external <link> or <script> in the boot document', () => {
    const dom = new JSDOM(readFileSync(INDEX_HTML, 'utf8'));
    const { document: boot } = dom.window;

    const refs = [
      ...Array.from(boot.querySelectorAll('link'), (el: Element) => el.getAttribute('href')),
      ...Array.from(boot.querySelectorAll('script'), (el: Element) => el.getAttribute('src')),
    ].filter((v): v is string => Boolean(v));

    for (const ref of refs) {
      expect(absoluteUrlsIn(ref)).toEqual([]);
    }

    /*
     * The book's snippet is <link rel="preconnect"> plus <link href="…css2?
     * family=Instrument+Sans…">. preconnect carries no stylesheet and so would
     * survive a check that only looked at rel="stylesheet" — it still opens the
     * socket, which is the thing local-first forbids. Assert the whole tag type
     * is absent rather than one of its rel values.
     */
    expect(boot.querySelectorAll('link[rel~="preconnect"]')).toHaveLength(0);
    expect(boot.querySelectorAll('link[rel~="stylesheet"]')).toHaveLength(0);
  });

  it('renders the shell with no server and nothing that needs one', () => {
    // RE-POINTED, not weakened. Until Wave 2 mounted the frame this asserted
    // `boot-smoke` — the Wave 0 token specimen, whose own text read "Nothing
    // here is a product surface." App now renders the real three-pane shell,
    // so the placeholder's testid is gone. The INVARIANT is unchanged and is
    // the one that matters: the app paints with no network and no key, which
    // is a stated non-negotiable (`docs/CANON.md` §1).
    const { getByTestId } = render(<App />);

    expect(getByTestId('chat-column')).toBeTruthy();
    /*
     * P2.5 blank workspace: chat alone; board pane mounts on Architecture tab.
     * BootSurface is retired for OpenCode boot; attach lives in chat and the appbar.
     */
    expect(getByTestId('shell-workspace')).toBeTruthy();
    expect(getByTestId('workspace-tabs')).toBeTruthy();
    expect(getByTestId('shell').getAttribute('data-tab-layout')).toBe('true');
    expect(document.querySelectorAll('[data-testid="board-node"]')).toHaveLength(0);
  });
});
