/**
 * ITEM 2.4 — THE BOOT LANE'S PUBLIC SURFACE.
 *
 * Everything the shell needs and nothing it does not. The four files behind
 * this barrel are free to be reorganised; this list is the contract.
 *
 * HOW THE SHELL (2.3) AND THE STORE (2.2) USE IT:
 *
 *   const boot = useBoot(createBootTransport());     // once, at the root
 *   …
 *   <BootSurface transport={transport} onRepoLoaded={…} onOpenAttach={…} />
 *
 * and the store maps the outcome onto the frozen `RepoSlice` with one switch:
 *
 *   attached        → { phase:'attached', repo: withDoc(outcome.repo) }
 *   static-graph    → { phase:'attached', repo: withDoc(outcome.repo) }  + net.reachable = false
 *   unattached      → { phase:'unattached' }
 *   foreign-repo    → { phase:'unattached' }        (shell.overlay stays closed)
 *   sign-in-required→ { phase:'unattached' }        (the sign-in surface is unbuilt — §5.6)
 *   no-engine       → { phase:'unattached' }        + net.reachable = false
 *   hydrate-failed  → { phase:'failed', attempted, failure }
 *
 * `withDoc` is the store's own step, not this lane's: `ScannedRepo` carries
 * `doc: SeqDiagramV1`, and `loadRepo` makes it by applying the projector the
 * application bound (`seqdFromGraph`, in `src/canvas/`). See the
 * `ScannedRepoDraft` doc comment.
 *
 * AND THE OUTCOME HAS TO GET THERE. `BootSurface` takes an `onSettled`
 * callback and `bootSurfacePropsFrom` points it at `boot/settled`. Without
 * that one line the switch above is dead code and the board draws nothing —
 * which is exactly what the Wave 3 gate measured in the shipped bundle.
 */

export { BootSurface } from './BootSurface';
export type { BootSurfaceProps } from './BootSurface';

export { AttachDialog } from './AttachDialog';
export type { AttachDialogProps } from './AttachDialog';

export { createBootTransport, isSameOriginPath } from './bootClient';

export {
  BOOT_ROUTES,
  classifyWireFailure,
  readScannedGraph,
  runBoot,
  summarizeGraph,
} from './bootSequence';
export type {
  BootOutcome,
  BootTransport,
  PlatformReport,
  ScannedRepoDraft,
  WireResult,
} from './bootSequence';

export { ATTACH_FAILURE_KINDS, attachFailureCopy, classifyAttachFailure } from './attachFailure';
export type { AttachFailureKind, FailureCopy, FailureTone } from './attachFailure';

export { useBoot } from './useBoot';
export type { BootPhase, UseBoot } from './useBoot';

export { pathCrumbs } from './paths';
export type { Crumb } from './paths';
