/* Reads for the rail's section views. Each list loads when its row first opens, never at boot, and says which of
   loading, failed or ready it is in so the view can use honest words for each. */

import { useCallback, useEffect, useState } from 'react';

import { PROFILES_ROUTE } from '../chat/agentProfiles';

export type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T };

/** Runs `load` on mount; a null answer is a failed read. `retry` reads again. */
export function useLoad<T>(load: () => Promise<T | null>): { state: Load<T>; retry: () => void } {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    void load()
      .then((data) => {
        if (live) setState(data === null ? { status: 'error' } : { status: 'ready', data });
      })
      .catch(() => {
        if (live) setState({ status: 'error' });
      });
    return () => {
      live = false;
    };
    // `load` is built once per open by the view; a retry is the only reason to read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  return { state, retry };
}

export interface RailProfile {
  name: string;
  description: string;
  readOnly: boolean;
}

/** GET /api/acp/profiles, with a failed read told apart from an empty list (loadProfiles folds both into []). */
export async function fetchRailProfiles(f: typeof fetch): Promise<RailProfile[] | null> {
  try {
    const res = await f(PROFILES_ROUTE, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { profiles?: unknown };
    if (!Array.isArray(body.profiles)) return null;
    const out: RailProfile[] = [];
    for (const p of body.profiles as Array<Partial<RailProfile> | null>) {
      if (p && typeof p.name === 'string') out.push({ name: p.name, description: typeof p.description === 'string' ? p.description : '', readOnly: p.readOnly === true });
    }
    return out;
  } catch {
    return null;
  }
}

/** Case-insensitive match over the words a row shows. */
export const matches = (query: string, ...fields: Array<string | undefined>): boolean => {
  const q = query.trim().toLowerCase();
  return q === '' || fields.some((f) => (f ?? '').toLowerCase().includes(q));
};
