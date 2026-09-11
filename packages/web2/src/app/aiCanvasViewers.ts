/**
 * Safe viewers for HTML and React canvas blocks — no script execution.
 */

const SCRIPT_TAG = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;

/** Strip script tags before sandbox display. */
export function sanitizeHtmlForSandbox(html: string): string {
  return html.replace(SCRIPT_TAG, '');
}

/** Wrap fragment HTML in a minimal document — no script, no hardcoded palette. */
export function htmlSandboxDocument(body: string): string {
  const safe = sanitizeHtmlForSandbox(body);
  const trimmed = safe.trimStart();
  if (trimmed.startsWith('<!')) return trimmed;
  const inner = trimmed.startsWith('<html') ? trimmed : `<body>${safe}</body>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:0.75rem;font:inherit;line-height:1.45}
</style></head>${inner}</html>`;
}

/**
 * Extract static JSX/HTML from a simple React component for bounded preview.
 * Returns null when the shape is too complex to preview without compile.
 */
export function extractStaticPreviewFromReact(source: string): string | null {
  const trimmed = source.trim();
  if (trimmed.startsWith('<')) return trimmed;
  const returnMatch = /return\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*}/.exec(trimmed);
  if (returnMatch?.[1]) {
    const jsx = returnMatch[1].trim();
    if (jsx.startsWith('<') && !jsx.includes('{') && !jsx.includes('useState')) {
      return jsx;
    }
  }
  const returnLine = /return\s+(<[\s\S]+?>)\s*;?\s*}/.exec(trimmed);
  if (returnLine?.[1] && !returnLine[1].includes('{')) {
    return returnLine[1].trim();
  }
  return null;
}
