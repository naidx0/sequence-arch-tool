/**
 * /api/rea*: the REA component (components/reaInstall.ts), for the Settings row.
 *
 *   GET    /api/rea[?plan=1]     { pin, status, job, plan? }   plan adds the requirement probes (git, node, npm), so it is asked for
 *   POST   /api/rea/install      { confirm: true, commit }     Start: the pinned source install plus, on Windows, the npm package's native files (202)
 *   POST   /api/rea/doctor       {}                            run `rea doctor --json` again and keep the plain-words result
 *   POST   /api/rea/register     {}                            write the `rea` entry in .sequence/mcp.json
 *   POST   /api/rea/unregister   {}                            remove that entry, if Sequence wrote it
 *   DELETE /api/rea              {}                            unregister and delete the install
 *
 * Nothing here runs by itself: install needs the person's confirm and the exact commit the row showed them, so a stale
 * page or a forged request cannot install a different commit.
 */
import type http from 'node:http';
import { MAX_BODY_BYTES, isJsonRequest, readBody, sendError, sendJson } from '../server/routeHttp.js';
import type { AddonSpec, FetchLike } from './reaAddon.js';
import { checkDoctor } from './reaDoctor.js';
import { REA_PIN, defaultAddon, installRea, isInstalled, planRea, reaInstallDir, reaStatus, registerRea, removeRea, resolveOnPath, sealedEnv, systemRunner, unregisterRea, type PlanStep, type ProgressEvent, type Runner, type StepState } from './reaInstall.js';
import { REA_READ_ONLY_TOOLS } from './reaTools.js';

export interface ReaDeps {
  userDir: () => string;
  repoRoot: () => string | null;
  /** Tests: a local bare clone and the commit/version in it. */
  repo?: string;
  commit?: string;
  version?: string;
  run?: Runner;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** The npm package whose native files Start adds. Absent: the default for this platform. Null: none. Tests point it at a local registry. */
  addon?: AddonSpec | null;
  fetchFn?: FetchLike;
}

export interface ReaJob {
  state: 'idle' | 'running' | 'done' | 'failed';
  steps: Partial<Record<PlanStep['id'] | 'doctor', StepState>>;
  /** The line a step is on while it runs ("Downloading rea-agents@6.5.0"). */
  detail?: string;
  error?: string;
  /** The step that failed. */
  failedStep?: string;
}

export function createReaRoutes(deps: ReaDeps) {
  let job: ReaJob = { state: 'idle', steps: {} };
  const commit = deps.commit ?? REA_PIN.commit;
  const addon = (): AddonSpec | null => (deps.addon === undefined ? defaultAddon(deps.platform) : deps.addon);
  const status = (root: string | null) => reaStatus(root, deps.userDir(), commit, deps.platform);

  const view = async (withPlan: boolean) => ({
    pin: { ...REA_PIN, commit },
    status: status(deps.repoRoot()),
    job,
    readOnlyTools: REA_READ_ONLY_TOOLS.length,
    ...(withPlan
      ? { plan: await planRea({ userDir: deps.userDir(), commit, ...(deps.repo ? { repo: deps.repo } : {}), ...(deps.run ? { run: deps.run } : {}), ...(deps.platform ? { platform: deps.platform } : {}), ...(deps.env ? { env: deps.env } : {}), addon: addon() }) }
      : {}),
  });

  const startInstall = (): void => {
    job = { state: 'running', steps: {} };
    const onProgress = (e: ProgressEvent): void => {
      const { detail: _was, ...rest } = job;
      job = { ...rest, steps: { ...job.steps, [e.step]: e.state }, ...(e.detail && e.state === 'running' ? { detail: e.detail } : {}) };
    };
    void installRea({
      userDir: deps.userDir(),
      commit,
      ...(deps.repo ? { repo: deps.repo } : {}),
      ...(deps.version ? { version: deps.version } : {}),
      ...(deps.run ? { run: deps.run } : {}),
      ...(deps.env ? { env: deps.env } : {}),
      ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
      ...(deps.platform ? { platform: deps.platform } : {}),
      addon: addon(),
      onProgress,
    }).then((r) => {
      job = r.ok ? { ...job, state: 'done' } : { ...job, state: 'failed', error: r.error, failedStep: r.step };
    });
  };

  /** True when the request was for this family (and has been answered). */
  async function handle(req: http.IncomingMessage, res: http.ServerResponse, method: string, pathname: string, url: URL): Promise<boolean> {
    if (pathname !== '/api/rea' && !pathname.startsWith('/api/rea/')) return false;
    if (pathname === '/api/rea' && method === 'GET') {
      sendJson(res, 200, await view(url.searchParams.get('plan') === '1'));
      return true;
    }
    const readJson = async (): Promise<Record<string, unknown> | null> => {
      if (!isJsonRequest(req)) {
        sendError(res, 415, 'expected content-type application/json');
        return null;
      }
      try {
        const parsed = JSON.parse((await readBody(req, MAX_BODY_BYTES)) || '{}') as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        /* falls through */
      }
      sendError(res, 400, 'invalid JSON body');
      return null;
    };

    if (pathname === '/api/rea/install' && method === 'POST') {
      const body = await readJson();
      if (!body) return true;
      if (body.confirm !== true || body.commit !== commit) {
        sendError(res, 400, `Installing REA needs { "confirm": true, "commit": "${commit}" }: the commit the plan showed.`);
        return true;
      }
      if (job.state === 'running') {
        sendError(res, 409, 'REA is already being installed.');
        return true;
      }
      startInstall();
      sendJson(res, 202, await view(false));
      return true;
    }

    if (pathname === '/api/rea/register' && method === 'POST') {
      if ((await readJson()) === null) return true;
      const root = deps.repoRoot();
      if (!root) {
        sendError(res, 400, 'Open a project first: REA is added to its .sequence/mcp.json.');
        return true;
      }
      const current = status(root);
      if (!current.installed) {
        sendError(res, 409, 'REA is not installed yet. Install it first.');
        return true;
      }
      const node = resolveOnPath('node', deps.env ?? process.env, deps.platform);
      if (!node) {
        sendError(res, 409, `Node.js was not found on PATH, and REA needs ${REA_PIN.node}.`);
        return true;
      }
      const done = registerRea(root, deps.userDir(), current.installDir, node);
      if (!done.ok) {
        sendError(res, 409, done.error);
        return true;
      }
      sendJson(res, 200, { registered: true, path: done.path, status: status(root) });
      return true;
    }

    if (pathname === '/api/rea/doctor' && method === 'POST') {
      if ((await readJson()) === null) return true;
      if (!isInstalled(deps.userDir(), commit)) {
        sendError(res, 409, 'REA is not installed yet. Start it first.');
        return true;
      }
      if (job.state === 'running') {
        sendError(res, 409, 'REA is being installed; wait for it to finish.');
        return true;
      }
      const env = sealedEnv(deps.env ?? process.env);
      await checkDoctor({ installDir: reaInstallDir(deps.userDir(), commit), run: deps.run ?? systemRunner, env, platform: deps.platform ?? process.platform });
      sendJson(res, 200, await view(false));
      return true;
    }

    if (pathname === '/api/rea/unregister' && method === 'POST') {
      if ((await readJson()) === null) return true;
      const root = deps.repoRoot();
      const removed = root ? unregisterRea(root, deps.userDir()) : false;
      sendJson(res, 200, { removed, status: status(root) });
      return true;
    }

    if (pathname === '/api/rea' && method === 'DELETE') {
      if (job.state === 'running') {
        sendError(res, 409, 'REA is being installed; wait for it to finish.');
        return true;
      }
      const root = deps.repoRoot();
      const unregistered = root ? unregisterRea(root, deps.userDir()) : false;
      const removed = removeRea(deps.userDir(), commit);
      job = { state: 'idle', steps: {} };
      sendJson(res, 200, { removed, unregistered, status: status(root) });
      return true;
    }

    sendError(res, 404, 'no such REA route');
    return true;
  }

  return { handle, view };
}
