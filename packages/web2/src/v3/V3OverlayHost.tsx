import { Suspense, lazy, useCallback, useEffect, useRef } from 'react';

import { openWorkflows } from '../agents/agentsSection';
import { Icon } from '../chat/Icon';
import '../shell2/pages.css';
import { createBootTransport } from '../boot/bootClient';
import type { BootTransport } from '../boot/bootSequence';
import { ConnectedReview } from '../review';
import { createReviewClient } from '../review/reviewClient';
import { RewindPanel } from '../rewind';
import { flushAndReload } from '../sessions/sessionPersist';
import { createSettingsClient } from '../settings/settingsClient';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import type { ShellOverlay } from '../state/types';
import { focusFirst, trapFocus } from '../shell/focusTrap';

/* EVERY OVERLAY LOADS WHEN IT OPENS, not at boot (perf ratchet, bootJsBytes;
   the reskin's merge measured +27,889 B over the ceiling): Settings, Activity,
   Help, Search and the Open-project dialog are each a chunk of their own, as
   Review and Rewind already were. */
/* A test awaits the same module (`await import('../settings/SettingsPanel')`)
   rather than racing findBy's timeout; exporting these imports from here
   would put the export in the boot chunk. */
const SettingsPanel = lazy(() => import('../settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })));
const HelpPanel = lazy(() => import('../help/HelpPanel').then((m) => ({ default: m.HelpPanel })));
const ConnectedSearch = lazy(() => import('../search/ConnectedSearch').then((m) => ({ default: m.ConnectedSearch })));
const AttachDialog = lazy(() => import('../boot/AttachDialog').then((m) => ({ default: m.AttachDialog })));

const transport: BootTransport = createBootTransport();
const settingsClient = createSettingsClient();
const reviewClient = createReviewClient();

export function V3OverlayHost() {
  const store = useStore();
  const state = useAppState();
  const overlay = state.shell.overlay;
  const repoRoot = groundedRepoRoot(state);
  const modalRef = useRef<HTMLDivElement>(null);
  const modalKind = overlay?.kind;
  useEffect(() => {
    const panel = modalRef.current;
    if (!modalKind || !panel) return;
    const release = trapFocus(panel);
    // Attach's outer close is hidden in favor of its lazy body's own close.
    // If only the frame existed initially, move into the arriving controls.
    const observer = new MutationObserver(() => {
      if (document.activeElement === panel) focusFirst(panel);
    });
    observer.observe(panel, { childList: true, subtree: true });
    return () => { observer.disconnect(); release(); };
  }, [modalKind]);

  const close = useCallback(() => {
    store.dispatch({ type: 'shell/overlay', overlay: null });
  }, [store]);

  /*
   * ── ESCAPE CLOSES IT, AND NOTHING DID ─────────────────────────────────
   *
   * Settings, Search, Help, Review, Activity, Rewind and the Open-project
   * dialog all open in this one panel, and the only ways out were the × and a
   * click on the scrim. `App.test.tsx` has asserted "closes on Escape and
   * leaves the rail standing" for both Review and Activity since the v2 shell,
   * and V3 rebuilt the host without the key.
   *
   * CAPTURE PHASE, AND IT CLAIMS THE KEY. This panel is modal — it covers the
   * board and the composer — and other surfaces listen for Escape on
   * `document` for their own reasons (`ConnectedBoard` closes its anatomy
   * view, twice). Letting the event through would close something behind the
   * overlay that the reader cannot see, which is the worst kind of action: it
   * happened, it was not asked for, and there was no way to notice. A modal
   * that is on top takes the key.
   */
  useEffect(() => {
    if (!overlay) return undefined;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      store.dispatch({ type: 'shell/overlay', overlay: null });
    }
    /* ON `window`, NOT ON `document`. A real keydown from the focused element
       bubbles document -> window, so window sees every one of them; a listener
       on document misses a key dispatched AT window, which is what every test
       and some host integrations do. Capture there is the first thing to run
       on any path, which is what makes claiming the key possible at all. */
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [overlay, store]);

  /* The Activity overlay is gone: Workflows live in the Agents surface, so the old door opens that. */
  const toWorkflows = overlay?.kind === 'activity';
  useEffect(() => {
    if (!toWorkflows) return;
    store.dispatch({ type: 'shell/overlay', overlay: null });
    openWorkflows(store);
  }, [toWorkflows, store]);

  if (!overlay || toWorkflows) return null;

  return (
    <div className="v3-overlay-scrim" role="presentation" data-kind={overlay.kind} onClick={close}>
      <div
        className="v3-overlay-panel"
        ref={modalRef}
        tabIndex={-1}
        role={overlay.kind === 'settings' ? 'dialog' : 'presentation'}
        aria-modal={overlay.kind === 'settings' ? true : undefined}
        aria-label={overlay.kind === 'settings' ? 'Settings' : undefined}
        data-testid={`v3-overlay-${overlay.kind}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/*
          THE MARK IS THE VOCABULARY'S, NOT A CHARACTER (owner, 2026-09-19:
          "the X on settings, the icon is off centred").

          It was a literal `×` — a glyph that sits on the font's own baseline
          inside a button 28 wide and `--control-h` tall, with nothing
          centring it. Two of the three reasons it looked wrong are in that
          sentence: text metrics are not box metrics, and the box was not
          square. `ic-x` is drawn on the same 24 grid as every other mark and
          the button below centres it in a square.
        */}
        <button type="button" className="v3-overlay-close" aria-label="Close" onClick={close}>
          <Icon name="x" size={14} />
        </button>
        <Suspense fallback={null}>
          <OverlayBody overlay={overlay} close={close} repoRoot={repoRoot} />
        </Suspense>
      </div>
    </div>
  );
}

function OverlayBody({
  overlay,
  close,
  repoRoot,
}: {
  overlay: ShellOverlay;
  close: () => void;
  repoRoot: string | null;
}) {
  const store = useStore();

  if (overlay.kind === 'settings') {
    return (
      <div className="v3-overlay-settings-host" data-testid="overlay-settings">
        <SettingsPanel
          client={settingsClient}
          pane={overlay.pane}
          onAutonomyChange={(enabled) =>
            store.dispatch({ type: 'composer/permission-enabled', enabled })
          }
          onOpenFolder={() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } })}
          onLeaveRepo={
            repoRoot
              ? () => {
                  store.dispatch({ type: 'repo/detached' });
                  close();
                }
              : undefined
          }
        />
      </div>
    );
  }

  if (overlay.kind === 'attach') {
    return (
      <AttachDialog
        transport={transport}
        onClose={close}
        onAttached={(draft) => {
          store.dispatch({ type: 'repo/loaded', draft, at: Date.now() });
          close();
          void flushAndReload();
        }}
      />
    );
  }

  if (overlay.kind === 'search') return <ConnectedSearch />;
  if (overlay.kind === 'help') return <HelpPanel />;
  if (overlay.kind === 'review') {
    const fromProposal = overlay.proposalId !== '';
    return <ConnectedReview scope={fromProposal ? 'last-turn' : undefined} />;
  }
  if (overlay.kind === 'rewind') {
    return (
      <div role="dialog" aria-label="Rewind" data-testid="overlay-rewind">
        <RewindPanel
          client={reviewClient}
          onRestored={() => window.location.reload()}
          onAgentChanged={(paths) => store.dispatch({ type: 'repo/stale', reason: 'file-written', changedPaths: paths, at: Date.now() })}
        />
      </div>
    );
  }

  /* sessions overlay is the left rail in V3 — palette still lists it for reachability. */
  if (overlay.kind === 'sessions') {
    return (
      <p className="settings-note" data-testid="v3-overlay-sessions-note">
        Sessions live in the left rail. Pick a chat there.
      </p>
    );
  }

  return null;
}
