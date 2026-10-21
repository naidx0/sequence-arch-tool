/**
   THE TOKEN USAGE WIRE /api/usage/tokens
   packages/web2/src/settings/tokenUsageClient.ts

   Counts only: the local server reads the repo's stored turns and answers
   totals per local day. Like versionClient, every failure is null: an
   unreachable server is "no data yet", never an error on the page.
   ------------------------------------------------ */

import type { GetTokenUsageResponse } from '@sequence/api-types';

export interface TokenUsageClient {
  tokens(): Promise<GetTokenUsageResponse | null>;
}

export function createTokenUsageClient(fetchImpl: typeof fetch = (...a) => fetch(...a)): TokenUsageClient {
  async function json<T>(url: string): Promise<T | null> {
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
  return {
    tokens: () => json<GetTokenUsageResponse>('/api/usage/tokens'),
  };
}
