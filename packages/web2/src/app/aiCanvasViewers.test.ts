import { describe, expect, it } from 'vitest';

import {
  CANVAS_SANDBOX_CSP,
  extractStaticPreviewFromReact,
  htmlSandboxDocument,
  sanitizeHtmlForSandbox,
} from './aiCanvasViewers';

describe('aiCanvasViewers', () => {
  it('strips script tags from HTML sandbox input', () => {
    const raw = '<div>ok</div><script>alert(1)</script>';
    expect(sanitizeHtmlForSandbox(raw)).toBe('<div>ok</div>');
  });

  it('wraps HTML fragments in a sandbox document', () => {
    const doc = htmlSandboxDocument('<p>Hello</p>');
    expect(doc).toContain('<!DOCTYPE html>');
    expect(doc).toContain('<p>Hello</p>');
    expect(doc).not.toContain('<script');
  });

  it('extracts static JSX from a simple React block', () => {
    const src = `export default function Chart() {
  return (
    <div className="chart"><span>42</span></div>
  );
}`;
    expect(extractStaticPreviewFromReact(src)).toContain('<div className="chart">');
  });

  it('returns null for hooks-heavy React source', () => {
    const src = `export default function X() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}`;
    expect(extractStaticPreviewFromReact(src)).toBeNull();
  });
});

/*
 * STAGE 4 — THE CANVAS MAY RUN SCRIPTS. Owner, 2026-09-14: "i allow scrits in
 * sandbox". `docs/research/agent-drawing-and-teaching-visuals.md` §4 required
 * this be "written down as a decision with its threat model, not slipped in";
 * Decision 15 is the ruling and these are the guards it promises.
 *
 * Asserted EXACTLY, not by regex over a rendered document. This is a security
 * boundary, and "contains the words default-src" is a different claim from
 * "forbids the network".
 */
describe('the interactive canvas sandbox', () => {
  it('KEEPS the scripts when interactive — that is the whole feature', () => {
    const doc = htmlSandboxDocument('<div id="x"></div><script>document.title="ran"</script>', {
      scripts: true,
    });
    expect(doc).toContain('<script>document.title="ran"</script>');
  });

  it('STILL STRIPS them by default — a caller must opt in', () => {
    const doc = htmlSandboxDocument('<div></div><script>alert(1)</script>');
    expect(doc).not.toContain('<script>');
  });

  it('carries the network-denying CSP, verbatim', () => {
    const doc = htmlSandboxDocument('<p>hi</p>', { scripts: true });
    expect(doc).toContain(`content="${CANVAS_SANDBOX_CSP}"`);
    // The clause that does the work: no fetch, no XHR, no WebSocket, no form
    // post, no font, no frame. Exfiltration is the real risk of running
    // model-authored JS, not a defaced box.
    expect(CANVAS_SANDBOX_CSP).toContain("default-src 'none'");
  });

  it('a MODEL-AUTHORED FULL DOCUMENT does not escape the policy', () => {
    // The one input shape that used to be returned untouched, and the one a
    // model reaches for when asked for "a complete page".
    const doc = htmlSandboxDocument(
      '<!DOCTYPE html><html><head><title>t</title></head><body><script>x()</script></body></html>',
      { scripts: true },
    );
    expect(doc).toContain(CANVAS_SANDBOX_CSP);
    // FIRST in the head: a CSP meta is ignored once a resource is declared
    // above it, so a policy after the <script> it governs is decoration.
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<title>'));
  });

  it('an <html> with no head is given one, rather than trusted', () => {
    const doc = htmlSandboxDocument('<html><body><script>x()</script></body></html>', {
      scripts: true,
    });
    expect(doc).toContain(CANVAS_SANDBOX_CSP);
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<body>'));
  });

  it('sanitizeHtmlForSandbox did NOT stop stripping — React still depends on it', () => {
    // A function whose job is to strip scripts must not quietly stop because
    // some other caller was allowed to run them.
    expect(sanitizeHtmlForSandbox('<b>x</b><script>y</script>')).toBe('<b>x</b>');
  });
});
