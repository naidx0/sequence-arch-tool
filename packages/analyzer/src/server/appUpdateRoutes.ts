/**
 * Version, update and release-notes endpoints (local-only; see appUpdate.ts):
 *
 *   GET  /api/app/version            -> { version, commit, platform, arch, desktop }
 *   GET  /api/app/update[?force=1]   -> { check: UpdateCheck, install: InstallJob }
 *        reads the day's cache; asks GitHub only when it is stale. Offline is a field, not an error.
 *   POST /api/app/update/install     -> 202 { install: InstallJob }   (the person's click)
 *        body { version }: the version the button showed (400 without it); a different latest is refused.
 *        downloads, verifies and runs the installer; poll the GET for progress.
 *   GET  /api/app/releases           -> { notes: [{ version, title, body }] } newest first
 *
 * Refused in hosted (auth-on) mode and for any non-local caller: installing software is the
 * business of the machine's own user.
 */

import type http from 'node:http';
import { isOriginAllowed } from './terminal.js';
import { automaticUpdateCheckAllowed } from './askAgentMap.js';
import { userStoreDir } from './store.js';
import { UpdateService, defaultUserDir, readReleaseNotes, readVersionInfo } from './appUpdate.js';

export interface AppRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  authOn: boolean;
  service?: UpdateService;
  /** Whether an automatic (not forced) check may reach GitHub; defaults to the `updates.check` setting and SEQUENCE_NO_UPDATE_CHECK. */
  autoCheck?: () => boolean;
}

let shared: UpdateService | null = null;
export function defaultUpdateService(): UpdateService {
  shared ??= new UpdateService({ userDir: defaultUserDir() });
  return shared;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

const ROUTES = new Set(['/api/app/version', '/api/app/update', '/api/app/update/install', '/api/app/releases']);

/** Handle an `/api/app/*` request. Returns false when the path is not one of ours. */
export async function handleAppRoute(ctx: AppRouteContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const route = url.pathname;
  if (!ROUTES.has(route)) return false;
  const post = route === '/api/app/update/install';
  if (method !== (post ? 'POST' : 'GET')) return false;
  if (ctx.authOn) {
    send(res, 403, { error: 'updates are local-only and are disabled in hosted (multi-user) mode.' });
    return true;
  }
  if (!isOriginAllowed(req)) {
    send(res, 403, { error: 'updates are local-only: this request did not come from localhost.' });
    return true;
  }
  const service = ctx.service ?? defaultUpdateService();
  if (route === '/api/app/version') {
    send(res, 200, readVersionInfo());
    return true;
  }
  if (route === '/api/app/releases') {
    send(res, 200, { notes: readReleaseNotes() });
    return true;
  }
  if (route === '/api/app/update') {
    const force = url.searchParams.get('force') === '1';
    /* The Version section refreshes by itself when it opens. With the switch off that must not reach the network:
       the cached answer comes back marked checkDisabled. Only "Check now" (force=1) fetches. */
    const allowed = ctx.autoCheck ?? (() => automaticUpdateCheckAllowed(userStoreDir()));
    if (!force && !allowed()) {
      send(res, 200, { check: { ...service.cachedCheck(), checkDisabled: true }, checkDisabled: true, install: service.status() });
      return true;
    }
    const check = await service.check(force);
    send(res, 200, { check, install: service.status() });
    return true;
  }
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
    send(res, 415, { error: 'expected content-type application/json' });
    return true;
  }
  /* The body names the version the button showed: { "version": "0.1.5" }. The job installs that one or nothing. */
  const body = await readJson(req);
  const version = body && typeof body.version === 'string' ? body.version.trim() : '';
  if (!/^v?\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    send(res, 400, { error: 'expected { "version": "<the version shown on the button>" }' });
    return true;
  }
  /* Started, not awaited: install() has already set the job running, so this answers that, and the page
     polls GET /api/app/update for progress and for the failure, if it fails. */
  void service.install(version);
  send(res, 202, { install: service.status() });
  return true;
}

/** A small JSON body, or null when it is not one (or is over 4 KB). */
function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= 4096) chunks.push(c);
    });
    req.on('error', () => resolve(null));
    req.on('end', () => {
      if (size > 4096) return resolve(null);
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        resolve(typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
  });
}
