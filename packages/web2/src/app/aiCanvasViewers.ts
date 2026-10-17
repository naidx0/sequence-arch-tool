/**
 * Viewers for HTML and React canvas blocks.
 *
 * ── STAGE 4: THE CANVAS MAY RUN SCRIPTS NOW ───────────────────────────────
 *
 * `docs/research/agent-drawing-and-teaching-visuals.md` §4 named this the one
 * change that "should be written down as a decision with its threat model, not
 * slipped in". Owner, 2026-09-14: *"i allow scrits in sandbox"*. Decision 15
 * carries the ruling; this file carries the mechanism, and the mechanism is two
 * guards, both of which matter more than the flag itself.
 *
 * GUARD 1 — `allow-scripts` WITHOUT `allow-same-origin`, ALWAYS.
 * Those two together are not a weaker sandbox, they are NO sandbox: a frame
 * holding both can reach its own `<iframe>` element through `window.parent` and
 * strip the sandbox attribute outright. Alone, `allow-scripts` gives the frame a
 * unique opaque origin — no parent DOM, no host cookies, no host localStorage,
 * no same-origin fetch. That single omission is the whole boundary, which is
 * why it is stated here rather than left to a reader of the JSX to notice.
 *
 * GUARD 2 — A CSP THAT FORBIDS THE NETWORK.
 * Script execution's real risk in this product is not a defaced box, it is
 * EXFILTRATION: model-authored JS reading the lesson and POSTing it somewhere.
 * `default-src 'none'` closes every fetch, XHR, WebSocket, form post, font and
 * frame; `img-src data:` keeps inline pixels working without opening a request
 * channel. The page may compute and draw. It may not phone home.
 *
 * WHAT IS STILL TRUE AFTER THIS, AND IS NOT CLAIMED AWAY: a script can spin
 * forever, and a sandboxed `srcDoc` frame may share the tab's event loop. A
 * hostile or buggy widget can therefore make the tab unresponsive until the
 * block is closed. That is a real remaining limit and the honest cost of the
 * flag, not something this comment can dispose of.
 */

const SCRIPT_TAG = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;

/**
 * Strip script tags.
 *
 * STILL HERE, AND STILL USED — by the React path, which has no execution story
 * and previews a static extract. Only the HTML block became interactive; a
 * function whose job is to strip scripts must not quietly stop stripping them
 * because some OTHER caller was allowed to run them.
 */
export function sanitizeHtmlForSandbox(html: string): string {
  return html.replace(SCRIPT_TAG, '');
}

/**
 * The Content-Security-Policy every interactive canvas document carries.
 *
 * Exported so a test can assert the exact string rather than a regex over a
 * rendered document: this is a security boundary, and "contains the words
 * default-src" is not the same claim as "forbids the network".
 */
export const CANVAS_SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";

export interface HtmlSandboxOptions {
  /**
   * Let the document's own scripts run. The CALLER pairs this with
   * `sandbox="allow-scripts"` on the frame; this function only builds the
   * document, and one built with scripts but rendered into a frame without the
   * flag is inert rather than unsafe.
   */
  scripts?: boolean;
}

/** Wrap fragment HTML in a minimal document. */
export function htmlSandboxDocument(body: string, opts: HtmlSandboxOptions = {}): string {
  const interactive = opts.scripts === true;
  const safe = interactive ? body : sanitizeHtmlForSandbox(body);
  const trimmed = safe.trimStart();
  const meta = interactive
    ? `<meta http-equiv="Content-Security-Policy" content="${CANVAS_SANDBOX_CSP}">`
    : '';

  /*
   * A FULL DOCUMENT FROM THE MODEL STILL GETS THE POLICY.
   *
   * This used to return a model-authored `<!DOCTYPE …>` untouched, which was
   * harmless while nothing could run. With scripts on it would have been THE
   * hole: the one input shape that skips every guard is the one a model reaches
   * for when asked for "a complete page". The meta is injected into its head —
   * or a head is created for it — so no spelling of the input gets script
   * execution without the policy.
   */
  if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
    if (!interactive) return trimmed;
    return injectHead(trimmed, meta);
  }
  return wrapDoc(`<body>${safe}</body>`, meta);
}

function wrapDoc(inner: string, meta: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${meta}<style>
body{margin:0;padding:0.75rem;font:inherit;line-height:1.45}
</style></head>${inner}</html>`;
}

/**
 * Put the policy in the document's own head.
 *
 * FIRST CHILD OF `<head>`, because a CSP meta is ignored once a resource has
 * been declared above it — a policy arriving after the `<script>` it governs is
 * decoration. With no head to find, the document is re-wrapped rather than
 * trusted.
 */
function injectHead(doc: string, meta: string): string {
  if (meta === '') return doc;
  const head = /<head\b[^>]*>/i.exec(doc);
  if (head) {
    const at = head.index + head[0].length;
    return doc.slice(0, at) + meta + doc.slice(at);
  }
  const html = /<html\b[^>]*>/i.exec(doc);
  if (html) {
    const at = html.index + html[0].length;
    return `${doc.slice(0, at)}<head>${meta}</head>${doc.slice(at)}`;
  }
  return wrapDoc(doc, meta);
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
