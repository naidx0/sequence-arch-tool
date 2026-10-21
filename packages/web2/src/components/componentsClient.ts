/* ══════════════════════════════════════════════════════════════════════════
   COMPONENTS — client helpers and pure models
   packages/web2/src/components/componentsClient.ts

   Bundled skills that are not in the agent's context until the person (or a
   match they approved) puts them there. The server owns the state
   (GET/PUT /api/components*); this file is fetch helpers plus the pure
   models the UI renders: no React, no DOM.
   ══════════════════════════════════════════════════════════════════════════ */

import type { DecisionSet } from '../chat/decisionModel';

export type ComponentsMode = 'auto' | 'approve' | 'manual';
export const COMPONENTS_MODES: readonly ComponentsMode[] = ['auto', 'approve', 'manual'];

export interface ComponentItem {
  id: string;
  name: string;
  blurb: string;
  source: string;
  license: string | null;
  installed: boolean;
  inWorkspace: boolean;
  status: 'ready' | 'review' | 'link-only';
  parent?: string;
  hasChildren?: boolean;
  url?: string;
}

export interface ComponentGroupView {
  id: string;
  name: string;
  blurb: string;
  components: ComponentItem[];
}

export interface ComponentsState {
  enabled: boolean;
  mode: ComponentsMode;
  groups: ComponentGroupView[];
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetch = (i, init) => fetch(i, init);

async function json<T>(r: Response): Promise<T> {
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `request failed (${r.status})`);
  return body;
}

const withBody = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const idPath = (id: string): string => id.split('/').map(encodeURIComponent).join('/');

export const fetchComponents = async (f: Fetch = defaultFetch): Promise<ComponentsState> => json(await f('/api/components'));
export const putComponentsSettings = async (patch: { enabled?: boolean; mode?: ComponentsMode }, f: Fetch = defaultFetch): Promise<ComponentsState> => json(await f('/api/components/settings', withBody('PUT', patch)));
export const setComponentInWorkspace = async (id: string, inWorkspace: boolean, f: Fetch = defaultFetch): Promise<ComponentsState> => json(await f(`/api/components/${idPath(id)}/workspace`, withBody('POST', { inWorkspace })));
export const answerComponentOffer = async (offerId: string, accept: boolean, f: Fetch = defaultFetch): Promise<void> => {
  await json(await f(`/api/components/offer/${encodeURIComponent(offerId)}`, withBody('POST', { accept })));
};
export const previewComponent = async (id: string, f: Fetch = defaultFetch): Promise<ComponentItem & { body: string | null }> => json(await f(`/api/components/${idPath(id)}`));

/** What `/components <rest>` means. `list` is the bare command. */
export type ComponentsCommand =
  | { kind: 'list' }
  | { kind: 'enabled'; enabled: boolean }
  | { kind: 'mode'; mode: ComponentsMode }
  | { kind: 'load'; id: string };

export function parseComponentsCommand(rest: string): ComponentsCommand {
  const t = rest.trim();
  const w = t.toLowerCase();
  if (w === '' || w === 'list') return { kind: 'list' };
  if (w === 'on') return { kind: 'enabled', enabled: true };
  if (w === 'off') return { kind: 'enabled', enabled: false };
  const mode = COMPONENTS_MODES.find((m) => m === w);
  if (mode) return { kind: 'mode', mode };
  return { kind: 'load', id: t };
}

/** Run-node body field for components picked from + or /components <id>. */
export const componentsBody = (ids: readonly string[]): { components?: string[] } => (ids.length ? { components: [...ids] } : {});

/* ── Turn events ─────────────────────────────────────────────────────────── */

export interface ComponentOfferView {
  offerId: string;
  turnId: string;
  componentId: string;
  name: string;
  reason: string;
  /** The same card the chat draws for any decision (chat/DecisionCard.tsx). `send` is `accept:<offerId>` or `decline:<offerId>`. */
  decision: DecisionSet;
}

const str = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** A `component:offer` stream event as a card model; null for anything else or a malformed event. */
export function componentOfferFromEvent(event: unknown): ComponentOfferView | null {
  const e = event && typeof event === 'object' ? (event as Record<string, unknown>) : null;
  if (!e || e.type !== 'component:offer' || !str(e.offerId) || !str(e.componentId) || !str(e.name)) return null;
  const reason = typeof e.reason === 'string' ? e.reason : '';
  const turnId = typeof e.turnId === 'string' ? e.turnId : '';
  const ask = `Use the "${e.name}" component for this?`;
  return {
    offerId: e.offerId,
    turnId,
    componentId: e.componentId,
    name: e.name,
    reason,
    decision: {
      kind: 'options',
      lead: ask,
      questions: [
        {
          n: 1,
          text: ask,
          options: [
            { label: 'Use it', detail: reason || null, send: `accept:${e.offerId}` },
            { label: 'Not now', detail: null, send: `decline:${e.offerId}` },
          ],
        },
      ],
    },
  };
}

/** A `component:used` event as the line the chat shows ("Used the Charts component"). */
export function componentUsedFromEvent(event: unknown): { turnId: string; componentId: string; name: string; line: string } | null {
  const e = event && typeof event === 'object' ? (event as Record<string, unknown>) : null;
  if (!e || e.type !== 'component:used' || !str(e.componentId) || !str(e.name)) return null;
  return { turnId: typeof e.turnId === 'string' ? e.turnId : '', componentId: e.componentId, name: e.name, line: `Used the ${e.name} component` };
}

/* ── Listing client (the Components picker, V3Chat) ─────────────────────────
   Quiet on failure: a 404 from GET /api/components means the engine has no
   Components, so list() answers null and the UI hides every entry. */

export interface ComponentEntry {
  id: string;
  name: string;
  blurb: string;
  source?: string;
  license?: string;
  installed?: boolean;
  inWorkspace?: boolean;
}

export interface ComponentGroup {
  id: string;
  name: string;
  blurb: string;
  components: ComponentEntry[];
}

export interface ComponentsListing {
  enabled: boolean;
  mode: ComponentsMode;
  groups: ComponentGroup[];
}

export interface ComponentsClient {
  /** The listing, or null when the route is absent or unreadable (the UI then hides Components). */
  list(): Promise<ComponentsListing | null>;
  /** `PUT /api/components/settings`; true when the server took it. */
  setSettings(patch: { enabled?: boolean; mode?: ComponentsMode }): Promise<boolean>;
  /** `POST /api/components/:id/workspace`. */
  setWorkspace(id: string, inWorkspace: boolean): Promise<boolean>;
  /** `POST /api/components/offer/:offerId`: Use it (true) or Keep the regular workflow (false). */
  answerOffer(offerId: string, accept: boolean): Promise<boolean>;
}

/** Shape check: a listing the picker can draw, else null. Unknown fields ride along unread. */
export function readListing(raw: unknown): ComponentsListing | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { enabled?: unknown; mode?: unknown; groups?: unknown };
  if (typeof r.enabled !== 'boolean' || !Array.isArray(r.groups)) return null;
  const groups: ComponentGroup[] = [];
  for (const g of r.groups as unknown[]) {
    const gg = g as Partial<ComponentGroup> | null;
    if (!gg || typeof gg.id !== 'string' || typeof gg.name !== 'string' || !Array.isArray(gg.components)) continue;
    const components = (gg.components as unknown[]).filter(
      (c): c is ComponentEntry => !!c && typeof (c as ComponentEntry).id === 'string' && typeof (c as ComponentEntry).name === 'string',
    );
    groups.push({ id: gg.id, name: gg.name, blurb: typeof gg.blurb === 'string' ? gg.blurb : '', components: components.map((c) => ({ ...c, blurb: typeof c.blurb === 'string' ? c.blurb : '' })) });
  }
  const mode = COMPONENTS_MODES.includes(r.mode as ComponentsMode) ? (r.mode as ComponentsMode) : 'approve';
  return { enabled: r.enabled, mode, groups };
}

export function createComponentsClient(fetchImpl?: Fetch): ComponentsClient {
  const doFetch: Fetch = (input, init) => (fetchImpl ?? ((i, n) => fetch(i, n)))(input, init);
  const send = async (method: string, url: string, body: unknown): Promise<boolean> => {
    try {
      const res = await doFetch(url, { method, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
      return res.ok;
    } catch {
      return false;
    }
  };
  return {
    async list() {
      try {
        const res = await doFetch('/api/components', { headers: { accept: 'application/json' } });
        if (!res.ok) return null;
        return readListing(await res.json());
      } catch {
        return null;
      }
    },
    setSettings: (patch) => send('PUT', '/api/components/settings', patch),
    setWorkspace: (id, inWorkspace) => send('POST', `/api/components/${encodeURIComponent(id)}/workspace`, { inWorkspace }),
    answerOffer: (offerId, accept) => send('POST', `/api/components/offer/${encodeURIComponent(offerId)}`, { accept }),
  };
}

