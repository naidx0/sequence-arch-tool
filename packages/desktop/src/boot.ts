import type { ServerStatus } from './server-control';
import type { ProxyEnv } from './proxyEnv';

/**
 * 0.1.8.4 PERF: the boot path, kept free of `electron` so it can be driven with fakes under `node --test`.
 *
 * Two jobs, both about not making the first window wait on things it does not need:
 *   - {@link startEngine}: spawn the engine at once. Nothing is awaited in front of the spawn except the proxy answer
 *     on a first launch (no cache yet), and that wait starts when the probe starts, not after the window exists.
 *   - {@link openAppOnListening}: load the app as soon as the engine listens. The renderer already shows the scan
 *     (BootScanning, polling /api/status) when it opens mid-read, so the main process no longer holds the boot page
 *     until the scan is done; it only watches the attach in the background, for the stalled-read dialog.
 */

export interface StartEngineDeps {
  /** The port the last launch used, if any. Tried first, with no free-port probe in front of the spawn. */
  rememberedPort: () => number | undefined;
  controller: {
    usePort: (port: number, opts?: { hint?: boolean }) => void;
    start: (repoDir?: string) => Promise<ServerStatus>;
  };
  /** The proxy probe, already started by the caller (so it overlaps window creation). */
  proxy: { cached: ProxyEnv; fresh: Promise<ProxyEnv>; hadCache: boolean };
  /** `proxyForFirstSpawn`: the cached answer at once, else the live probe up to its cap. */
  proxyForFirstSpawn: (probe: StartEngineDeps['proxy']) => Promise<ProxyEnv>;
  /** Puts a proxy answer into the engine's spawn environment. */
  applyProxy: (p: ProxyEnv) => void;
  /** Seals the API keys into the spawn environment. Synchronous. */
  prepareEnv: () => void;
  lastRepo: () => string | undefined;
}

/**
 * Spawn the engine. With a cached proxy answer (every launch but the first) the spawn is issued synchronously: no
 * await precedes it. On the first launch it waits for the live probe, which has been running since the caller
 * started it, so the wait is whatever is left of it (capped), not a fresh one.
 */
export function startEngine(d: StartEngineDeps): Promise<ServerStatus> {
  const wanted = d.rememberedPort();
  if (wanted !== undefined) d.controller.usePort(wanted, { hint: true });
  d.prepareEnv();
  const go = (): Promise<ServerStatus> => d.controller.start(d.lastRepo());
  if (d.proxy.hadCache) {
    d.applyProxy(d.proxy.cached);
    void d.proxy.fresh.then((fresh) => d.applyProxy(fresh));
    return go();
  }
  return d.proxyForFirstSpawn(d.proxy).then((p) => {
    d.applyProxy(p);
    void d.proxy.fresh.then((fresh) => d.applyProxy(fresh));
    return go();
  });
}

export interface OpenAppDeps {
  windowAlive: () => boolean;
  /** True when the window already shows the boot page (nothing to reload). */
  onBootPage: () => boolean;
  showBoot: () => Promise<void>;
  /** `appUrlReady`: which page a re-created window should load. */
  setAppReady: (ready: boolean) => void;
  loadApp: () => Promise<void>;
  /** Resolves when the engine has finished its startup attach; rejects (AttachStalledError, ...) when it will not. */
  settled: () => Promise<unknown>;
  /** The attach finished (smoke uses this to start its probe). */
  onAttached?: () => void;
  /** The attach stalled or the engine stopped answering. */
  onAttachFailed: (e: Error) => void | Promise<void>;
}

/**
 * The engine is listening: put the app on screen now. Resolves once the app load has been ISSUED and finished
 * loading, never waiting for the scan; the attach is watched in the background.
 */
export async function openAppOnListening(d: OpenAppDeps): Promise<void> {
  d.setAppReady(false);
  if (d.windowAlive() && !d.onBootPage()) await d.showBoot();
  d.setAppReady(true);
  if (!d.windowAlive()) return;
  const loaded = d.loadApp();
  /* Watching starts with the load, so a scan that finishes while the page loads is not missed. */
  void d.settled().then(
    () => d.onAttached?.(),
    (e: Error) => d.onAttachFailed(e),
  );
  await loaded;
}
