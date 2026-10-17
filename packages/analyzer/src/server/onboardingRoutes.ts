/**
 * First-run onboarding endpoints (read-only, local-only):
 *
 *   GET /api/onboarding/providers[?refresh=1]
 *       -> { providers: [{ id, label, installed, version, state, signInCommand, installHint, plan? }] }
 *   GET /api/onboarding/repos
 *       -> { repos: [{ path, name, lastActive, recent }], truncated, ms }
 *   GET /api/onboarding/setup
 *       -> { mcpServers: [{ name, source }], skills: [{ name, source }] }
 *       names only, from ~/.claude and ~/.codex (setupImport.ts)
 *   POST /api/onboarding/install-adapter { provider }   (round 7, A4)
 *       -> { provider, state, command, output, exitCode, error? }
 *       starts the documented global npm install of the provider's bridge
 *       (Claude Code: claude-agent-acp). Only on a person's click.
 *   GET  /api/onboarding/install-adapter?provider=claude -> the same, as it runs
 *   POST /api/onboarding/install-adapter { provider, kind: 'cli' }   (claims-audit 4.2)
 *       runs the vendor's own native CLI installer (cliInstall.ts); GET ...&kind=cli polls it.
 *
 * All three are refused in hosted (auth-on) mode and for any non-local caller, with
 * the same gate as `/api/acp/*`: they describe the machine the server runs on
 * (installed CLIs, folder names under home), which is only the caller's
 * business when the caller is on that machine.
 */

import type http from 'node:http';
import { isOriginAllowed } from './terminal.js';
import { readRecent } from './store.js';
import { defaultProviderProbe, type ProviderProbe } from './providerProbe.js';
import { discoverRepos } from './repoDiscovery.js';
import { readSetupInventory } from './setupImport.js';
import { createAdapterInstaller, type AdapterInstaller } from './adapterInstall.js';
import { defaultCliInstaller, type CliInstaller } from './cliInstall.js';
import { activeUsageLimit } from './agentLimits.js';
import type { ProvidersResponse } from './providerProbe.js';

export interface OnboardingContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  authOn: boolean;
  /** The caller's canonical browse root (the jail every repo must sit inside). */
  browseRoot: string;
  /** The caller's recent-repos store dir. */
  recentStoreDir: string;
  /** Test seam; defaults to the process-wide probe. */
  probe?: ProviderProbe;
  /** Test seam; defaults to the process-wide installer. */
  installer?: AdapterInstaller;
  /** Test seam; defaults to the process-wide CLI installer (kind: 'cli'). */
  cliInstaller?: CliInstaller;
  /** The user store that remembers a spent usage limit (agentLimits.ts). */
  limitsStoreDir?: string;
  /** Test seam: the clock a remembered limit is read against. */
  now?: () => number;
}

/** The process-wide bridge installer; a finished install makes the next probe look again. */
export const defaultAdapterInstaller: AdapterInstaller = createAdapterInstaller({
  /* The bin dir is already in the default search (rememberBinDir); the probe only needs to look again. */
  onDone: () => defaultProviderProbe.invalidate?.(),
});

const INSTALL_ROUTE = '/api/onboarding/install-adapter';

/**
 * Round 7: a signed-in provider whose last turn hit its usage limit, with
 * the reset still ahead, is not Ready: it reads `limited` with the reset time.
 * Read from the server's own record of the failed turn, never by probing.
 */
function withUsageLimits(answer: ProvidersResponse, ctx: Pick<OnboardingContext, 'limitsStoreDir' | 'now'>): ProvidersResponse {
  if (!ctx.limitsStoreDir) return answer;
  const now = (ctx.now ?? Date.now)();
  return {
    providers: answer.providers.map((p) => {
      if (p.state !== 'ready') return p;
      const resetsAt = activeUsageLimit(ctx.limitsStoreDir!, p.id, now);
      return resetsAt === null ? p : { ...p, state: 'limited' as const, limitResetsAt: resetsAt };
    }),
  };
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Handle an `/api/onboarding/*` request. Returns false when the path is not one of ours. */
export async function handleOnboardingRoute(ctx: OnboardingContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const route = url.pathname;
  const install = route === INSTALL_ROUTE && (method === 'GET' || method === 'POST');
  if (
    !install &&
    (method !== 'GET' ||
      (route !== '/api/onboarding/providers' && route !== '/api/onboarding/repos' && route !== '/api/onboarding/setup'))
  ) {
    return false;
  }
  if (ctx.authOn) {
    send(res, 403, { error: 'onboarding probes are local-only and are disabled in hosted (multi-user) mode.' });
    return true;
  }
  if (!isOriginAllowed(req)) {
    send(res, 403, { error: 'onboarding probes are local-only — this request did not come from localhost.' });
    return true;
  }
  if (install) {
    const installer = ctx.installer ?? defaultAdapterInstaller;
    const cliInstaller = ctx.cliInstaller ?? defaultCliInstaller;
    if (method === 'GET') {
      const which = url.searchParams.get('kind') === 'cli' ? cliInstaller : installer;
      const st = which.status(url.searchParams.get('provider') ?? '');
      send(res, 200, st ?? { state: 'idle' });
      return true;
    }
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
      send(res, 415, { error: 'expected content-type application/json' });
      return true;
    }
    let provider = '';
    let kind = '';
    try {
      const body = (await readJson(req)) as { provider?: unknown; kind?: unknown };
      provider = typeof body?.provider === 'string' ? body.provider : '';
      kind = typeof body?.kind === 'string' ? body.kind : '';
    } catch (e) {
      send(res, 400, { error: `invalid JSON body: ${(e as Error).message}` });
      return true;
    }
    if (kind !== '' && kind !== 'cli' && kind !== 'bridge') {
      send(res, 400, { error: `unsupported install kind: ${kind}` });
      return true;
    }
    const out = (kind === 'cli' ? cliInstaller : installer).start(provider);
    if (!out.ok) send(res, out.status, { error: out.error });
    else send(res, 202, out.status);
    return true;
  }
  if (route === '/api/onboarding/providers') {
    const refresh = url.searchParams.get('refresh') === '1';
    send(res, 200, withUsageLimits(await (ctx.probe ?? defaultProviderProbe).get(refresh), ctx));
    return true;
  }
  if (route === '/api/onboarding/setup') {
    // The browse root is the caller's home in local mode (and a test's temp dir).
    send(res, 200, readSetupInventory(ctx.browseRoot));
    return true;
  }
  const recent = readRecent(ctx.recentStoreDir, ctx.browseRoot);
  send(res, 200, await discoverRepos({ root: ctx.browseRoot, recent }));
  return true;
}
