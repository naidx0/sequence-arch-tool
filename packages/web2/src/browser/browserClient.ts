import type { PostNetFetchRequest, PostNetFetchResponse } from '@sequence/api-types';

export const NET_FETCH_ROUTE = '/api/net-fetch';

export type NetFetchOutcome =
  | { outcome: 'ok'; body: PostNetFetchResponse }
  | { outcome: 'error'; status: number; message: string };

export async function netFetch(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NetFetchOutcome> {
  const body: PostNetFetchRequest = { url };
  let res: Response;
  try {
    res = await fetchImpl(NET_FETCH_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { outcome: 'error', status: 0, message: (e as Error).message };
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { outcome: 'error', status: res.status, message: 'the server did not answer with JSON' };
  }
  if (!res.ok) {
    const err =
      parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `request failed (${res.status})`;
    return { outcome: 'error', status: res.status, message: err };
  }
  return { outcome: 'ok', body: parsed as PostNetFetchResponse };
}
