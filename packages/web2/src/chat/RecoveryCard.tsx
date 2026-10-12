/* ══════════════════════════════════════════════════════════════════════════
   A FAILED AGENT RUN SAYS WHAT TO DO NEXT (R10: one quiet row, not a card)
   packages/web2/src/chat/RecoveryCard.tsx

   The server classifies a failure (acp recovery.ts) and the card offers the
   one useful step (build spec Part 5, row 23):
     signIn   "Sign in again" runs the vendor's own login in a terminal right
              here (the first-run sign-in terminal, TerminalPane signIn=…);
              when it ends, Retry.
     retry    "Retry" asks the same question again in the same chat. The
              server rejoins the agent's thread, so nothing the agent knew is
              lost (a hung turn, a crashed process, a rate limit).
     install  the agent's command is not on this machine: say so; Retry once
              it is installed.
     wait     the account's usage limit is spent: one quiet line saying when
              it resets, and no Retry, which could only fail the same way.
   The terminal mounts only when "Sign in again" is pressed.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

import type { AgentRun } from '../agents/agentRuns';
/* Static: the terminal is already in the boot chunk (the Terminal tab), so a
   dynamic import here would only add a module namespace object to it. */
import { TerminalPane } from '../terminal/TerminalPane';
import { S2Icon } from '../shell2/icons';
import { createOnboardingClient, type OnboardingClient } from '../onboarding/onboardingClient';
import { isSettling, settleSignIn, signedAt, useSignInVersion } from '../onboarding/signInState';
import { agentSetupPrompt, draftIntoComposer } from '../onboarding/agentSetupPrompt';
import { useStoreIfAny } from '../state/connect';
import { CopyPromptButton, nothingCanAnswer } from '../onboarding/setupFallback';

const VENDOR: Record<string, string> = { codex: 'Codex', claude: 'Claude' };

/** Close a sentence once: some locales already end a time with a period ("4:36 p.m."). */
export function endSentence(s: string): string {
  return s.endsWith('.') ? s : `${s}.`;
}

/** "Codex usage limit reached. It resets Oct 12, 2026, 4:36 PM." The time is the viewer's own. */
export function usageLimitLine(vendor: string, resetsAt: number | undefined, locale?: string): string {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) return `${vendor} usage limit reached.`;
  const when = new Date(resetsAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return endSentence(`${vendor} usage limit reached. It resets ${when}`);
}

/** The agent's name as people say it. */
export function vendorOf(run: Pick<AgentRun, 'agentRef' | 'recovery'>): string {
  const ref = run.recovery?.provider ?? run.agentRef ?? '';
  return VENDOR[ref] ?? (ref ? ref.charAt(0).toUpperCase() + ref.slice(1) : 'The agent');
}

/**
 * The failure in the agent's own words, without the server's wrapper. A dead
 * process now says its exit code and its last stderr lines (acp client.ts,
 * round 7); this is what the notice shows under its headline.
 */
export function failureDetail(error: string | null): string {
  return (error ?? '').replace(/^ACP agent failed:\s*/, '').trim();
}

/** "4:36 PM" when it resets today, "Oct 12, 4:36 PM" otherwise. */
export function resetsAtShort(resetsAt: number, now = Date.now(), locale?: string): string {
  const d = new Date(resetsAt);
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? d.toLocaleTimeString(locale, { timeStyle: 'short' }) : d.toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * A run that failed because no agent is connected yet (agentRunner NO_AGENT_TEXT): the runner fails it before any
 * agent is named, with cause notInstalled and no agentRef. Its card offers Connect and Set up in chat.
 */
export function isNoAgent(run: Pick<AgentRun, 'agentRef' | 'recovery'>): boolean {
  return run.recovery?.kind === 'retry' && run.recovery?.cause === 'notInstalled' && !run.agentRef;
}

/** The one sentence a failed or stopped run gets. Pure. */
export function noticeSentence(run: AgentRun, now = Date.now()): string {
  const vendor = vendorOf(run);
  const kind = run.recovery?.kind ?? 'retry';
  if (run.interrupted) return run.retry ? `${vendor} was interrupted by a restart.` : 'Interrupted by a restart.';
  if (isNoAgent(run)) return 'No agent is connected yet.';
  if (kind === 'wait') {
    const at = run.recovery?.resetsAt;
    return typeof at === 'number' && Number.isFinite(at) ? endSentence(`Usage limit, resets ${resetsAtShort(at, now)}`) : 'Usage limit reached.';
  }
  if (kind === 'settings') return "This permission mode doesn't allow that.";
  if (kind === 'signIn') return `${vendor} is signed out.`;
  if (kind === 'install') return `${vendor} isn't installed.`;
  if (run.turn === 'hung') return `${vendor} stopped responding.`;
  if (run.error === 'Stopped.' || run.stopReason === 'cancelled') return 'Stopped.';
  switch (run.recovery?.cause) {
    case 'localServer':
      return "Couldn't reach Sequence's local server.";
    case 'network':
      return `Couldn't reach ${vendor}'s servers.`;
    case 'timeout':
      return `${vendor} stopped responding.`;
    case 'bridgeExit':
      return `${vendor} quit unexpectedly.`;
    default:
      return run.endedWithoutAnswer ? `${vendor} ended without an answer.` : `${vendor} stopped before it answered.`;
  }
}

type Tone = 'muted' | 'warn';

/**
 * A FAILED RUN IS ONE QUIET ROW: a small mark, one sentence, text actions,
 * and the real reason (stderr, exit code) behind "Details". A failure the
 * server did not classify is a retry. Retry is pressed once: the row then
 * says the new attempt is below.
 */
/** Run a failed turn again. `auto` is the usage-limit timer, `declineAuto` is Don't; the answer says whether anything was sent. */
export type RetryFn = (run: AgentRun, opts?: { auto?: boolean; declineAuto?: boolean }) => boolean | Promise<boolean> | void;

export function RecoveryCard({ run, onRetry, onboarding }: { run: AgentRun; onRetry?: RetryFn; onboarding?: OnboardingClient }) {
  useSignInVersion();
  const store = useStoreIfAny();
  const [signing, setSigning] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [retriedHere, setRetried] = useState(false);
  const retried = retriedHere || run.retried === true;
  /* A turn that ended on a usage limit reruns by itself when the limit resets, once per chat and window
     (the server hands out one claim), only for the chat's newest turn, never at once for a reset already past. */
  const [declinedHere, setDeclined] = useState(false);
  const declined = declinedHere || run.autoDeclined === true;
  const resetsAt = run.recovery?.kind === 'wait' ? run.recovery.resetsAt : undefined;
  const [seenAt] = useState(() => Date.now());
  const auto =
    run.status === 'failed' && typeof resetsAt === 'number' && Number.isFinite(resetsAt) && resetsAt > seenAt && resetsAt > (run.endedAt ?? 0) && !!onRetry && !!run.retry && !retried && !declined;
  useEffect(() => {
    if (!auto) return;
    const delay = Math.min(Math.max(5_000, resetsAt! + 5_000 - Date.now()), 2_147_000_000);
    const timer = setTimeout(() => {
      void Promise.resolve(onRetry!(run, { auto: true })).then((sent) => {
        if (sent) setRetried(true);
        else setDeclined(true);
      });
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, resetsAt, run.id]);
  if (run.status !== 'failed') return null;
  const kind = run.recovery?.kind ?? 'retry';
  const setup = isNoAgent(run);
  const canRetry = Boolean(onRetry && run.retry) && kind !== 'wait' && kind !== 'settings' && !setup;
  const detail = kind === 'wait' || run.interrupted || setup ? '' : failureDetail(run.error);
  const provider = run.recovery?.provider;
  /* One sign-in state (onboarding/signInState): once the person has signed in, a run that began before that is
     not a reason to ask again. It says it is checking, then Retry is the step. A run that began AFTER the
     sign-in and still failed signed-out is the vendor really reporting it, so Sign in stays. */
  const checking = kind === 'signIn' && !!provider && isSettling(provider);
  const signedSince = kind === 'signIn' && !!provider && !checking && signedAt(provider) > 0 && signedAt(provider) >= run.startedAt;
  const stopped = noticeSentence(run) === 'Stopped.';
  const tone: Tone = stopped ? 'muted' : 'warn';
  return (
    <div className="agnote" role="status" data-testid="agent-recovery" data-kind={kind} data-tone={tone} data-stopped={stopped ? 'true' : 'false'}>
      <div className="agnote-row">
        <span className="agnote-mark" aria-hidden="true">
          <S2Icon name={stopped ? 'x' : 'bolt'} small />
        </span>
        <span className="agnote-text" data-testid="agent-recovery-why">{checking ? 'Checking sign-in...' : signedSince ? 'Signed in. Retry to continue.' : noticeSentence(run)}</span>
        <span className="agnote-acts">
          {kind === 'signIn' && provider && !signing && !checking && !signedSince ? (
            <button type="button" className="agnote-act" data-testid="agent-recovery-signin" onClick={() => setSigning(true)}>
              Sign in
            </button>
          ) : null}
          {kind === 'wait' && retried ? (
            <span className="agnote-done" data-testid="agent-recovery-retried">
              Continuing below
            </span>
          ) : null}
          {kind === 'wait' && declined && !retried ? (
            <span className="agnote-done" data-testid="agent-recovery-declined">
              Won't continue by itself
            </span>
          ) : null}
          {auto ? (
            <>
              <span className="agnote-done" data-testid="agent-recovery-auto">
                Continues then
              </span>
              <button type="button" className="agnote-act" data-testid="agent-recovery-auto-cancel" onClick={() => {
                  setDeclined(true);
                  void onRetry?.(run, { declineAuto: true });
                }}
              >
                Don't
              </button>
            </>
          ) : null}
          {canRetry ? (
            retried ? (
              <span className="agnote-done" data-testid="agent-recovery-retried">
                {run.interrupted ? 'Continuing below' : 'Retrying below'}
              </span>
            ) : (
              <button
                type="button"
                className={`agnote-act${kind !== 'signIn' || signedIn || signedSince ? ' is-primary' : ''}`}
                data-testid={run.interrupted ? 'agent-recovery-continue' : 'agent-recovery-retry'}
                onClick={() => {
                  setRetried(true);
                  onRetry!(run);
                }}
              >
                {run.interrupted ? 'Continue' : 'Retry'}
              </button>
            )
          ) : null}
          {setup && store ? (
            <>
              <button type="button" className="agnote-act is-primary" data-testid="agent-recovery-connect" onClick={() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'agents' } })}>
                Connect an agent
              </button>
              {nothingCanAnswer(0, store.getState().composer.model) ? (
                <>
                  <CopyPromptButton text={agentSetupPrompt({ need: 'none' })} className="agnote-act" testid="agent-recovery-copy" />
                  <button type="button" className="agnote-act" data-testid="agent-recovery-model" onClick={() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'models' } })}>
                    Connect a model
                  </button>
                </>
              ) : (
                <button type="button" className="agnote-act" data-testid="agent-recovery-chat" onClick={() => draftIntoComposer(store, agentSetupPrompt({ need: 'none' }))}>
                  Set up in chat
                </button>
              )}
            </>
          ) : null}
          {detail && detail !== 'Stopped.' ? (
            <details className="agnote-details">
              <summary data-testid="agent-recovery-details">Details</summary>
              <pre className="agnote-pre" data-testid="agent-run-error">{detail}</pre>
            </details>
          ) : null}
        </span>
      </div>
      {signing && provider ? (
        <div className="agrecover-term" data-testid="agent-recovery-terminal">
          <TerminalPane
            signIn={provider}
            onExit={({ ended }) => {
              setSignedIn(true);
              /* The vendor's status can lag its own sign-in: ask with backoff before anyone says signed-out again. */
              if (ended) void settleSignIn(provider, onboarding ?? createOnboardingClient(), undefined, { afterSignIn: true });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
