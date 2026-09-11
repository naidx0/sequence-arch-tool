/**
 * THE ELECTRON SEAM, READ FROM THE WEB SIDE.
 *
 * `packages/desktop/src/preload.ts` exposes a single frozen object on
 * `window.sequence` through `contextBridge`. Something has to READ it, or the
 * desktop build is a browser in a native window: the preload keeps its promise
 * and nobody collects. In v1 nothing did — `grep window.sequence` over the whole
 * web tree returned zero hits — and the seam sat dead through every release.
 *
 * WHY THIS IS REBUILT AND NOT RESTORED. v1's module existed to suppress chrome:
 * that app drew a simulated macOS window (a 22px-inset, rounded, drop-shadowed
 * frame) and Electron drew its real OS frame around it, so the desktop build
 * showed a box inside a box. `isDesktop()` was how the fake frame got dropped.
 * web2 draws no simulated frame at all, so that motivation is gone and is
 * deliberately NOT carried over — citing it here would be citing the retired
 * product. What survives is the capability: on the desktop the user picks a
 * folder with the OS dialog instead of typing a path into a jailed browser.
 *
 * DOM-free and dependency-light on purpose, so the rule is unit-testable without
 * a renderer and the web bundle never depends on Electron.
 */

/** The subset of the preload bridge web2 uses. Structural, NOT imported from
 *  `@sequence/desktop` — the web bundle must not pull in Electron types. */
export interface SequenceDesktopBridge {
  openRepo(): Promise<string | null>;
  onRepoChanged?(cb: (info: { repoDir: string | null; url: string }) => void): () => void;
  /**
   * The application menu asked for the help page.
   *
   * OPTIONAL, like `onRepoChanged`, and for the same reason: a shell that
   * predates this channel is still a valid shell, and the browser build has no
   * menu at all. A caller must check before subscribing.
   */
  onOpenHelp?(cb: () => void): () => void;
}

/** Any host that may carry the bridge — a real `window`, or a test double. */
export interface DesktopHost {
  sequence?: unknown;
}

function hostOrWindow(host?: DesktopHost): DesktopHost | undefined {
  if (host !== undefined) return host;
  return typeof window === 'undefined' ? undefined : (window as unknown as DesktopHost);
}

/**
 * True when the page is running inside the Sequence Electron shell.
 *
 * The test is "the bridge exposes the capability it promises", never "the
 * property is truthy". The next thing a caller does is CALL `openRepo()`, so a
 * page carrying an unrelated `window.sequence` — a global from another script, a
 * string, a half-built stub — must read as browser, not desktop. Keying off
 * truthiness would turn a name collision into a TypeError inside a click
 * handler, which is a crash where an absence belonged.
 */
export function isDesktop(host?: DesktopHost): boolean {
  const api = hostOrWindow(host)?.sequence;
  return (
    typeof api === 'object' &&
    api !== null &&
    typeof (api as SequenceDesktopBridge).openRepo === 'function'
  );
}

/**
 * The bridge itself when present, else `undefined`.
 *
 * Callers MUST handle both. The browser build has no desktop capabilities and
 * has to stay completely usable without them — the native picker is a shortcut
 * past the folder browser, never the only door to it.
 */
export function desktopBridge(host?: DesktopHost): SequenceDesktopBridge | undefined {
  const h = hostOrWindow(host);
  return isDesktop(h) ? (h!.sequence as SequenceDesktopBridge) : undefined;
}

/**
 * Subscribe to the desktop Help menu, if there is one.
 *
 * RETURNS A NO-OP UNSUBSCRIBE WHEN THERE IS NOT, so a caller writes the same
 * three lines in a browser tab and in a window. The alternative — every caller
 * branching on `isDesktop()` before subscribing — is the shape that produces
 * one caller who forgets and one crash in the packaged build only.
 */
export function onDesktopHelp(cb: () => void, host?: DesktopHost): () => void {
  const bridge = (hostOrWindow(host)?.sequence ?? null) as SequenceDesktopBridge | null;
  if (!bridge || typeof bridge.onOpenHelp !== 'function') return () => {};
  return bridge.onOpenHelp(cb);
}
