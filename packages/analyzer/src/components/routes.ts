/**
 * /api/components*
 *
 *   GET  /api/components                      { enabled, mode, groups: [{ id, name, blurb, components: [...] }] }
 *   PUT  /api/components/settings             { enabled?, mode? }
 *   POST /api/components/:id/workspace        { inWorkspace }   copy into / remove from <repo>/.sequence/components/
 *   POST /api/components/offer/:offerId       { accept }        answer a component:offer card
 *   GET  /api/components/:id                  { id, name, ..., body }   the SKILL.md, for a preview
 *
 * A component the app ships with is never in an agent's context unless this module put it there.
 */
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { bundledCatalogRoot, loadCatalog, loadMergedCatalog, parentIds, readComponentBody, userCatalogRoot, type Catalog, type ComponentEntry } from './catalog.js';
import type { OfferBook } from './inject.js';
import { COMPONENT_MODES, readComponentSettings, writeComponentSettings, type ComponentMode } from './settings.js';

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

const sourceOf = (c: ComponentEntry): string => c.source?.repo ?? c.url ?? (c.layer === 'user' ? 'workspace' : 'Sequence');

function wire(c: ComponentEntry, hasChildren: boolean) {
  return {
    id: c.id,
    name: c.label,
    blurb: c.summary,
    source: sourceOf(c),
    license: c.license ?? null,
    installed: c.status !== 'link-only',
    inWorkspace: c.layer === 'user',
    status: c.status,
    ...(c.parent ? { parent: c.parent } : {}),
    ...(hasChildren ? { hasChildren: true } : {}),
    ...(c.url ? { url: c.url } : {}),
  };
}

export function componentsPayload(catalog: Catalog, settings: { enabled: boolean; mode: ComponentMode }) {
  const parents = parentIds(catalog);
  return {
    enabled: settings.enabled,
    mode: settings.mode,
    groups: catalog.groups
      .map((g) => ({ id: g.id, name: g.label, blurb: g.summary, components: catalog.components.filter((c) => c.group === g.id).map((c) => wire(c, parents.has(c.id))) }))
      .filter((g) => g.components.length > 0),
    warnings: catalog.warnings,
  };
}

/** Copy a catalog component into the repo's own layer. Never overwrites a user-authored copy. */
export function addToWorkspace(repoRoot: string, c: ComponentEntry): void {
  const dest = path.join(userCatalogRoot(repoRoot), ...c.id.split('/'));
  if (c.layer === 'user' || fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(c.dir, dest, { recursive: true });
}

export function removeFromWorkspace(repoRoot: string, id: string): boolean {
  const root = userCatalogRoot(repoRoot);
  const dir = path.join(root, ...id.split('/'));
  if (!loadCatalog(root, 'user').components.some((c) => c.id === id)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export async function handleComponentsRoute(ctx: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  pathname: string;
  storeDir: string;
  repoRoot: string | null;
  offers: OfferBook;
  /** Show an event on the running turn of this thread key's stream; false when no turn is running. */
  emit?: (key: string, event: Record<string, unknown>) => boolean;
  readBody: () => Promise<string>;
  bundledRoot?: string;
}): Promise<boolean> {
  const { res, method, pathname } = ctx;
  if (pathname !== '/api/components' && !pathname.startsWith('/api/components/')) return false;
  const catalog = (): Catalog => loadMergedCatalog(ctx.repoRoot, ctx.bundledRoot ?? bundledCatalogRoot());
  const json = async (): Promise<Record<string, unknown> | null> => {
    try {
      const b = JSON.parse(await ctx.readBody()) as unknown;
      return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  if (pathname === '/api/components') {
    if (method !== 'GET') return false;
    send(res, 200, componentsPayload(catalog(), readComponentSettings(ctx.storeDir)));
    return true;
  }
  let rest: string;
  try {
    rest = decodeURIComponent(pathname.slice('/api/components/'.length));
  } catch {
    send(res, 400, { error: 'the component id is not a valid URL path' });
    return true;
  }

  if (rest === 'settings') {
    if (method !== 'PUT') return false;
    const b = await json();
    const enabled = b?.enabled;
    const mode = b?.mode;
    const okMode = mode === undefined || COMPONENT_MODES.includes(mode as ComponentMode);
    if (!b || !okMode || (enabled !== undefined && typeof enabled !== 'boolean') || (enabled === undefined && mode === undefined)) {
      send(res, 400, { error: 'body must be {"enabled"?: true|false, "mode"?: "auto"|"approve"|"manual"} with at least one' });
      return true;
    }
    writeComponentSettings(ctx.storeDir, { ...(typeof enabled === 'boolean' ? { enabled } : {}), ...(mode !== undefined ? { mode: mode as ComponentMode } : {}) });
    send(res, 200, componentsPayload(catalog(), readComponentSettings(ctx.storeDir)));
    return true;
  }

  /* The agent's own `components load` (packages/mcp) asks here, because the answer depends on the mode NOW:
     auto + ready -> load; approve, or a review component -> a card is raised and the body is withheld. */
  if (rest === 'request') {
    if (method !== 'POST') return false;
    const addr = ctx.req.socket.remoteAddress ?? '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr)) {
      send(res, 403, { error: 'local only' });
      return true;
    }
    const b = await json();
    const key = typeof b?.key === 'string' ? b.key : '';
    const id = typeof b?.componentId === 'string' ? b.componentId : '';
    const settings = readComponentSettings(ctx.storeDir);
    if (!settings.enabled || settings.mode === 'manual') {
      send(res, 200, { decision: 'refused', message: settings.enabled ? 'The person set components to manual: they pick what loads.' : 'Components are switched off.' });
      return true;
    }
    const c = catalog().components.find((x) => x.id === id);
    if (!c) {
      send(res, 404, { error: `no component ${id}` });
      return true;
    }
    if (c.status === 'link-only') {
      send(res, 200, { decision: 'link', url: c.url ?? null });
      return true;
    }
    if (settings.mode === 'auto' && c.status === 'ready') {
      send(res, 200, { decision: 'load' });
      return true;
    }
    const o = key ? ctx.offers.open(key, { componentId: c.id, name: c.label, reason: 'the agent asked to use it' }) : null;
    if (o) ctx.emit?.(key, { type: 'component:offer', turnId: '', offerId: o.offerId, componentId: o.componentId, name: o.name, reason: o.reason });
    send(res, 200, { decision: 'offer', raised: !!o });
    return true;
  }

  if (rest.startsWith('offer/')) {
    if (method !== 'POST') return false;
    const b = await json();
    if (!b || typeof b.accept !== 'boolean') {
      send(res, 400, { error: 'body must be {"accept": true|false}' });
      return true;
    }
    if (!ctx.offers.answer(rest.slice('offer/'.length), b.accept)) {
      send(res, 404, { error: 'that offer is unknown or already answered' });
      return true;
    }
    send(res, 200, { ok: true, accepted: b.accept });
    return true;
  }

  if (rest.endsWith('/workspace')) {
    if (method !== 'POST') return false;
    const id = rest.slice(0, -'/workspace'.length);
    const b = await json();
    if (!b || typeof b.inWorkspace !== 'boolean') {
      send(res, 400, { error: 'body must be {"inWorkspace": true|false}' });
      return true;
    }
    if (!ctx.repoRoot) {
      send(res, 409, { error: 'attach a repository first: the workspace layer lives in it' });
      return true;
    }
    const c = catalog().components.find((x) => x.id === id);
    if (!c) {
      send(res, 404, { error: `no component ${id}` });
      return true;
    }
    if (b.inWorkspace) {
      if (c.status === 'link-only') {
        send(res, 409, { error: `${id} is a link, not an installable component` });
        return true;
      }
      addToWorkspace(ctx.repoRoot, c);
    } else removeFromWorkspace(ctx.repoRoot, id);
    send(res, 200, componentsPayload(catalog(), readComponentSettings(ctx.storeDir)));
    return true;
  }

  if (method !== 'GET') return false;
  const c = catalog().components.find((x) => x.id === rest);
  if (!c) {
    send(res, 404, { error: `no component ${rest}` });
    return true;
  }
  send(res, 200, { ...wire(c, false), body: readComponentBody(c) });
  return true;
}
