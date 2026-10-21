/* ══════════════════════════════════════════════════════════════════════════
   INSTALL OR UPDATE AN AGENT'S CLI, ON A CLICK (0.1.8.4)
   packages/web2/src/onboarding/CliAction.tsx

   One button for "Install" and "Update". It runs the vendor's own installer
   through the server's guarded path (POST /api/onboarding/install-adapter
   with kind 'cli': a fixed command, local callers only), shows the
   installer's latest line while it runs, and looks at the machine again when
   it ends. Nothing runs before the click.

   When it fails, or finishes while the old copy still wins on PATH, it says
   so and shows the exact command to copy. Used by the Connect menu,
   Settings > Agents and first run, each in its own button class.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { AsciiSpinner } from '../shell2/AsciiSpinner';
import type { BridgeInstallStatus, OnboardingClient } from './onboardingClient';
import { CopyPromptButton } from './setupFallback';

export interface CliActionProps {
  provider: string;
  label: string;
  mode: 'install' | 'update';
  client: Pick<OnboardingClient, 'installCli' | 'cliStatus'>;
  /** The documented command, shown to copy when the button cannot finish the job. */
  command: string;
  /** The install ended well: look at the machine again. Return false when the agent still reads out of date. */
  onDone: () => Promise<boolean | void> | boolean | void;
  buttonClass?: string;
  /** The class of the copy button (defaults to the button class). */
  copyClass?: string;
  /** The idle button's words. */
  buttonLabel?: string;
  pollMs?: number;
  /** `menuitem` inside a menu. */
  role?: string;
  /** Start on mount: the person's click that opened this (the Connect menu's Install row) was the click to install. */
  autoStart?: boolean;
}

type Phase = { at: 'idle' } | { at: 'running'; line?: string } | { at: 'checking' } | { at: 'failed'; why: string; output?: string[] } | { at: 'stale' };

export function CliAction({ provider, label, mode, client, command, onDone, buttonClass = 'bridge-btn', copyClass, buttonLabel, pollMs = 500, role, autoStart = false }: CliActionProps) {
  const [phase, setPhase] = useState<Phase>({ at: 'idle' });
  const live = useRef(true);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const verb = mode === 'update' ? 'Update' : 'Install';
  const run = async (): Promise<void> => {
    if (!client.installCli) return;
    setPhase({ at: 'running' });
    const started = await client.installCli(provider);
    if (!started.ok) {
      if (live.current) setPhase({ at: 'failed', why: started.message });
      return;
    }
    let st: BridgeInstallStatus | undefined = started.body;
    while (st && st.state === 'running' && live.current) {
      setPhase({ at: 'running', ...(st.output?.length ? { line: st.output[st.output.length - 1] } : {}) });
      await new Promise((r) => setTimeout(r, pollMs));
      const polled = client.cliStatus ? await client.cliStatus(provider) : null;
      if (!polled) break;
      if (!polled.ok) {
        st = { state: 'failed', error: polled.message };
        break;
      }
      st = polled.body;
    }
    if (!live.current) return;
    if (!st || st.state !== 'done') {
      setPhase({ at: 'failed', why: st?.error ?? 'The installer did not finish.', ...(st?.output?.length ? { output: st.output } : {}) });
      return;
    }
    setPhase({ at: 'checking' });
    const current = await done.current();
    if (!live.current) return;
    setPhase(current === false ? { at: 'stale' } : { at: 'idle' });
  };

  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const copy = (
    <CopyPromptButton text={command} label="Copy command" role={role} className={copyClass ?? buttonClass} testid={`cli-copy-${provider}`} />
  );
  return (
    <div className="bridge" data-testid={`cli-${mode}-${provider}`} data-phase={phase.at}>
      {phase.at === 'running' || phase.at === 'checking' ? (
        <p className="bridge-line" role="status" data-testid={`cli-progress-${provider}`}>
          <AsciiSpinner />
          {phase.at === 'checking' ? `Checking ${label} again…` : `${mode === 'update' ? 'Updating' : 'Installing'} ${label}${phase.line ? `: ${phase.line}` : '…'}`}
        </p>
      ) : phase.at === 'failed' ? (
        <div className="bridge-fail" role="alert" data-testid={`cli-failed-${provider}`}>
          <p className="bridge-line">
            {label} did not {mode === 'update' ? 'update' : 'install'}. {phase.why}
          </p>
          {phase.output?.length ? <pre className="bridge-log">{phase.output.slice(-6).join('\n')}</pre> : null}
          <code className="bridge-cmd" data-testid={`cli-command-${provider}`}>{command}</code>
          <button type="button" {...(role ? { role } : {})} className={buttonClass} data-testid={`cli-retry-${provider}`} onClick={() => void run()}>
            Try again
          </button>
          {copy}
        </div>
      ) : phase.at === 'stale' ? (
        <div className="bridge-fail" role="status" data-testid={`cli-stale-${provider}`}>
          <p className="bridge-line">The installer finished, but {label} still reads as out of date. An older copy earlier on your PATH may be the one that runs. To update that copy, run:</p>
          <code className="bridge-cmd" data-testid={`cli-command-${provider}`}>{command}</code>
          {copy}
        </div>
      ) : (
        <button type="button" {...(role ? { role } : {})} className={buttonClass} data-testid={`cli-${mode}-button-${provider}`} disabled={!client.installCli} title={`${verb} ${label} with its own installer`} onClick={() => void run()}>
          {buttonLabel ?? `${verb} ${label}`}
        </button>
      )}
    </div>
  );
}
