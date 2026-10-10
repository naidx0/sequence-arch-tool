/* ══════════════════════════════════════════════════════════════════════════
   INSTALL BRIDGE (round 7, A4)
   packages/web2/src/onboarding/BridgeInstall.tsx

   Jaden: "For Claude Code, the connector says it needs adapter though. I'm
   not sure what that means." The card says it in one sentence and offers one
   button. Pressing it runs the bridge's documented global npm install on the
   server (never before the click), shows npm's latest line while it runs and
   the result when it ends; on success the caller probes again and the agent
   reads Ready.

   Used by first run and by Settings > Agents.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { AsciiSpinner } from '../shell2/AsciiSpinner';
import type { BridgeInstallStatus, OnboardingClient } from './onboardingClient';

export interface BridgeInstallProps {
  provider: string;
  client: Pick<OnboardingClient, 'installBridge' | 'bridgeStatus'>;
  /** The install finished well: look at the machine again. */
  onInstalled: () => void;
  /** Poll interval while npm runs (tests shorten it). */
  pollMs?: number;
  /** The button's class (each surface keeps its own button style). */
  buttonClass?: string;
  /** The button's words (first run's combined step says "Install bridge and sign in"). */
  label?: string;
  /** The line shown once the install finished well. */
  doneLine?: string;
}

export function BridgeInstall({ provider, client, onInstalled, pollMs = 500, buttonClass = 'bridge-btn', label = 'Install bridge', doneLine = 'Bridge installed. Checking Claude Code again.' }: BridgeInstallProps) {
  const [st, setSt] = useState<BridgeInstallStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const done = useRef(onInstalled);
  done.current = onInstalled;

  useEffect(() => {
    if (st?.state !== 'running' || !client.bridgeStatus) return undefined;
    let live = true;
    const t = setInterval(() => {
      void client.bridgeStatus!(provider).then((a) => {
        if (!live) return;
        if (!a.ok) return setFailure(a.message);
        setSt(a.body);
      });
    }, pollMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [st?.state, client, provider, pollMs]);

  useEffect(() => {
    if (st?.state === 'done') done.current();
  }, [st?.state]);

  const start = async () => {
    if (!client.installBridge) return;
    setFailure(null);
    setSt({ state: 'running', output: [] });
    const a = await client.installBridge(provider);
    if (!a.ok) {
      setSt(null);
      setFailure(a.message);
      return;
    }
    setSt(a.body);
  };

  const last = st?.output?.length ? st.output[st.output.length - 1] : null;
  return (
    <div className="bridge" data-testid="bridge-install" data-state={st?.state ?? 'idle'}>
      {st?.state === 'running' ? (
        <p className="bridge-line" role="status" data-testid="bridge-progress">
          <AsciiSpinner />
          Installing the bridge{last ? `: ${last}` : '…'}
        </p>
      ) : st?.state === 'done' ? (
        <p className="bridge-line" role="status" data-testid="bridge-done">
          {doneLine}
        </p>
      ) : st?.state === 'failed' || failure ? null : (
        <button type="button" className={buttonClass} data-testid="bridge-install-button" disabled={!client.installBridge} onClick={() => void start()}>
          {label}
        </button>
      )}
      {st?.state === 'failed' || failure ? (
        <div className="bridge-fail" role="alert" data-testid="bridge-failed">
          <p className="bridge-line">The bridge did not install. {st?.error ?? failure}</p>
          {st?.output?.length ? <pre className="bridge-log">{st.output.slice(-6).join('\n')}</pre> : null}
          <button type="button" className={buttonClass} data-testid="bridge-retry" onClick={() => void start()}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
