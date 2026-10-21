/**
 * Whether a captured console line is about one of the routes a spec deliberately refuses (answers with a 404).
 *
 * The harness appends the failing request's URL to the browser's message as a trailing `[url]` (lib/harness.mjs). A
 * route is matched by that URL's EXACT pathname, never by substring: `line.includes('/api/git')` also excused
 * /api/git/events, the stream the product must not open against a host without an engine.
 */
export function isRefusedLine(line, routes) {
  const m = /\[(https?:\/\/[^\]\s]+)\]\s*$/.exec(line);
  if (!m) return false;
  try {
    return routes.includes(new URL(m[1]).pathname);
  } catch {
    return false;
  }
}
