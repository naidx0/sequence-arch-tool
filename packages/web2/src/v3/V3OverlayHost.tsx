import { useCallback } from 'react';

import { ConnectedActivity } from '../activity';
import { Icon } from '../chat/Icon';
import { AttachDialog, createBootTransport, type BootTransport } from '../boot';
import { HelpPanel } from '../help/HelpPanel';
import { ConnectedReview, createReviewClient } from '../review';
import { RewindPanel } from '../rewind';
import { ConnectedSearch } from '../search/ConnectedSearch';
import { flushAndReload } from '../sessions/sessionPersist';
import { createSettingsClient } from '../settings';
import { SettingsPanel } from '../settings/SettingsPanel';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import type { ShellOverlay } from '../state/types';

const transport: BootTransport = createBootTransport();
const settingsClient = createSettingsClient();
const reviewClient = createReviewClient();

export function V3OverlayHost() {
  const store = useStore();
  const state = useAppState();
  const overlay = state.shell.overlay;
  const repoRoot = groundedRepoRoot(state);

  const close = useCallback(() => {
    store.dispatch({ type: 'shell/overlay', overlay: null });
  }, [store]);

  if (!overlay) return null;

  return (
    <div className="v3-overlay-scrim" role="presentation" data-kind={overlay.kind} onClick={close}>
      <div
        className="v3-overlay-panel"
        role="presentation"
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
        <OverlayBody overlay={overlay} close={close} repoRoot={repoRoot} />
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
      <div role="dialog" aria-label="Settings" data-testid="overlay-settings">
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
  if (overlay.kind === 'activity') return <ConnectedActivity />;
  if (overlay.kind === 'review') {
    const fromProposal = overlay.proposalId !== '';
    return <ConnectedReview scope={fromProposal ? 'last-turn' : undefined} />;
  }
  if (overlay.kind === 'rewind') {
    return (
      <div role="dialog" aria-label="Rewind" data-testid="overlay-rewind">
        <RewindPanel client={reviewClient} onRestored={() => window.location.reload()} />
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
