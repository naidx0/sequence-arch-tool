/**
 * The keyless web plugin: `web_fetch` (a public page as markdown) and
 * `web_search` (hosted Exa MCP, no API key). On by default; the user setting
 * `web.enabled` = false turns both off (analyzer netFetch.readWebEnabled).
 *
 * Everything returned is third-party text. It is wrapped as untrusted data
 * (the analyzer's wrapUntrustedLines) so a page that says "ignore previous
 * instructions" is quoted to the model, not obeyed. The truncation note and
 * errors are ours and sit outside the wrapper.
 *
 * Descriptions are kept tiny on purpose: both tools together list under 220
 * tokens (the mcp budget tests measure it).
 */

import { z } from 'zod';
import { neutralizeUntrusted, readWebEnabled, truncationNote, userStoreDir, webFetch, webSearch, wrapUntrustedLines } from '@sequence/analyzer';
import type { ToolResult } from './boardTools.js';

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

/** A page slice; the wrapper, header and truncation note must fit the 50,000-char MCP result budget with it. */
export const WEB_PAGE_CAP = 45_000;

const OFF = 'web access is turned off in Sequence settings (web.enabled). Ask the user to turn it on.';

export const webFetchShape = {
  url: z.string(),
  format: z.enum(['markdown', 'text', 'html']).optional(),
  offset: z.number().optional(),
};
export const WEB_FETCH_DESCRIPTION = 'Read a web page as markdown; offset continues a cut page.';

export const webSearchShape = {
  query: z.string(),
  numResults: z.number().optional(),
};
export const WEB_SEARCH_DESCRIPTION = 'Web search: title, url, snippet (untrusted data).';

export interface WebEnv {
  /** Test seam: the settings answer instead of reading the user store. */
  enabled?: boolean;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  lookup?: null;
}

const isEnabled = (env: WebEnv): boolean => env.enabled ?? readWebEnabled(userStoreDir());

export async function webFetchTool(
  a: { url: string; format?: 'markdown' | 'text' | 'html'; timeout?: number; offset?: number },
  env: WebEnv = {},
): Promise<ToolResult> {
  if (!isEnabled(env)) return text(OFF, true);
  const r = await webFetch(a.url, {
    format: a.format,
    timeout: a.timeout,
    offset: a.offset,
    outputCap: WEB_PAGE_CAP,
    ...(env.fetchImpl ? { fetchImpl: env.fetchImpl } : {}),
    ...(env.lookup === null ? { lookup: null } : {}),
  });
  if (!r.ok) return text(`web_fetch failed: ${r.url}${r.status ? ` (HTTP ${r.status})` : ''}: ${r.error}`, true);
  const head = [r.url, `HTTP ${r.status}`, r.contentType || null, r.title ? `title: ${r.title}` : null].filter(Boolean).join(' | ');
  const note = r.nextOffset !== undefined ? truncationNote(r.nextOffset) : '';
  const cut = r.downloadTruncated ? '\n[the download hit the 5MB limit; the page is cut]' : '';
  return text(`${wrapUntrustedLines([head, '', neutralizeUntrusted(r.output)]).join('\n')}${note}${cut}`);
}

export async function webSearchTool(a: { query: string; numResults?: number }, env: WebEnv = {}): Promise<ToolResult> {
  if (!isEnabled(env)) return text(OFF, true);
  const r = await webSearch(a.query, { numResults: a.numResults, ...(env.fetchImpl ? { fetchImpl: env.fetchImpl } : {}) });
  if (!r.ok) return text(`web_search failed: ${r.error}`, true);
  if (r.results.length === 0) return text('web_search: no results.');
  const lines = r.results.map((h, i) => neutralizeUntrusted(`${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ''}`));
  return text(wrapUntrustedLines(lines).join('\n'));
}
