/* ══════════════════════════════════════════════════════════════════════════
   CONNECT A MODEL TO RUN THIS (P0-4)
   packages/web2/src/chat/ConnectToRun.tsx

   The one card a blocked ask gets, above the composer, in place of the old
   "AI provider not configured" banner. It names what was kept and what is
   missing in one sentence, opens the connect flow right here (first run's
   own flow, drawn inline), and hands back what got connected so the kept
   question runs without being typed again (blockedAsk.ts).
   ══════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';

import { FirstRun } from '../onboarding/FirstRun';
import { createOnboardingClient, type OnboardingClient } from '../onboarding/onboardingClient';
import type { SettingsClient } from '../settings/settingsClient';
import { S2Icon } from '../shell2/icons';

export interface ConnectToRunProps {
  /** The blocked question, kept. */
  question: string | null;
  /** An agent or a model is connected: run the kept question. */
  onConnected: (r: { agent?: string; model?: string }) => void;
  onDismiss?: () => void;
  client?: OnboardingClient;
  settings?: SettingsClient;
}

/** The one sentence: what will happen, and what is missing. */
export function connectToRunLine(question: string | null): string {
  return question ? 'Your message is kept and runs as soon as a model or an agent is connected.' : 'Nothing can answer yet: connect a model or an agent.';
}

export function ConnectToRun({ question, onConnected, onDismiss, client, settings }: ConnectToRunProps) {
  const [open, setOpen] = useState(false);
  const wire = useMemo(() => client ?? createOnboardingClient(), [client]);
  return (
    <div className="s2-notice ctr-card" data-testid="connect-to-run" data-open={open ? 'true' : 'false'}>
      <span className="s2-notice-mark" aria-hidden="true">
        <S2Icon name="bolt" small />
      </span>
      <p className="s2-notice-text" role="status" data-testid="connect-to-run-text">
        Connect a model to run this
        <span>{connectToRunLine(question)}</span>
      </p>
      <div className="s2-notice-acts">
        {open ? null : (
          <button type="button" className="s2-btn s2-btn-sm s2-blue" data-testid="connect-to-run-open" onClick={() => setOpen(true)}>
            Connect a model
          </button>
        )}
        {onDismiss ? (
          <button type="button" className="s2-ibtn s2-ibtn-sm" aria-label="Dismiss" data-testid="s2-failure-dismiss" onClick={onDismiss}>
            <S2Icon name="x" small />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="ctr-flow" data-testid="connect-to-run-flow">
          <FirstRun
            inline
            client={wire}
            {...(settings ? { settings } : {})}
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
            onReady={(r) => {
              setOpen(false);
              onConnected(r);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
