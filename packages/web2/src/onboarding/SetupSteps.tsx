/* ══════════════════════════════════════════════════════════════════════════
   THE GUIDED SETUP LINE (0.1.8.4)
   packages/web2/src/onboarding/SetupSteps.tsx

   Install, Sign in, Connect as one sequence, not three screens: a single
   quiet line says where the person is in it. Words only, the current step
   in ink-1 and the finished ones struck by a "done" word, never a colour
   alone. Pure `setupSteps` decides the marks, the component only prints them.
   ══════════════════════════════════════════════════════════════════════════ */

export type StepMark = 'done' | 'now' | 'next';
export interface SetupStep {
  label: string;
  mark: StepMark;
}

/** The two agent CLIs the server's guarded installer knows (cliInstall.ts). */
export const CLI_INSTALLABLE: readonly string[] = ['claude', 'codex'];
export const canRunCli = (id: string): boolean => CLI_INSTALLABLE.includes(id);

/** The documented manual update command when the probe did not carry one (the hard-floor `update` state). */
export function updateCommandOf(id: string, given?: string): string {
  if (given) return given;
  return id === 'claude' ? 'claude update' : id === 'codex' ? 'npm install -g @openai/codex@latest' : '';
}

/** Where a provider's probe state sits in Install, Sign in, Connect. `ready` is one click from the last step. */
export function setupSteps(state: 'install' | 'signIn' | 'adapter' | 'ready' | 'connected'): SetupStep[] {
  const at = state === 'install' ? 0 : state === 'signIn' || state === 'adapter' ? 1 : 2;
  const marks = (i: number): StepMark => (state === 'connected' || i < at ? 'done' : i === at ? 'now' : 'next');
  return ['Install', 'Sign in', 'Connect'].map((label, i) => ({ label, mark: marks(i) }));
}

export function SetupSteps({ state, className = 'bridge-line', testid }: { state: Parameters<typeof setupSteps>[0]; className?: string; testid?: string }) {
  const steps = setupSteps(state);
  return (
    <span className={className} data-testid={testid ?? 'setup-steps'} aria-label="Setup steps">
      {steps.map((s, i) => (
        <span key={s.label} data-mark={s.mark} aria-current={s.mark === 'now' ? 'step' : undefined} style={s.mark === 'now' ? { color: 'var(--ink-1)' } : undefined}>
          {i > 0 ? ' → ' : ''}
          {s.label}
          {s.mark === 'done' ? ' (done)' : ''}
        </span>
      ))}
    </span>
  );
}
