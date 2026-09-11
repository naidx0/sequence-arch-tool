import { describe, expect, it } from 'vitest';

import {
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
