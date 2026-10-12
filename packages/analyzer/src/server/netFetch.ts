/**
 * Scoped public HTTP fetch for Browser panel + ask `fetch_url`.
 * Reuses liveResearch SSRF guards and size/time caps — no cookie jar, no Chromium.
 */

import {
  fetchUrlContent,
  type FetchedSource,
  type FetchImpl,
} from '../research/liveResearch.js';

export type NetFetchResponse = FetchedSource;

export async function netFetchUrl(
  rawUrl: string,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<NetFetchResponse> {
  return fetchUrlContent(rawUrl, opts);
}
