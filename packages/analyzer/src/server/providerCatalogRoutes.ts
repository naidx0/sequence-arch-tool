/**
 * GET /api/providers/catalog -> { providers, detected }
 *
 * The model-provider catalog (providerCatalog.ts) for Settings › Models, and which providers already
 * have a key on this machine, by variable NAME only. Same gate as the onboarding routes: it describes
 * the machine the server runs on, so it answers only a local caller and never in hosted mode.
 */

import type http from 'node:http';
import { isOriginAllowed } from './terminal.js';
import { detectEnvProviders, providerCatalog } from './providerCatalog.js';
import { sendError, sendJson } from './routeHttp.js';

export const PROVIDER_CATALOG_ROUTE = '/api/providers/catalog';

export function handleProviderCatalogRoute(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, method: string, authOn: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (pathname !== PROVIDER_CATALOG_ROUTE) return false;
  if (method !== 'GET') {
    sendError(res, 405, `${method} is not supported on ${pathname}`);
    return true;
  }
  if (authOn || !isOriginAllowed(req)) {
    sendError(res, 403, 'the provider catalog is local-only');
    return true;
  }
  sendJson(res, 200, { providers: providerCatalog(), detected: detectEnvProviders(env) });
  return true;
}
