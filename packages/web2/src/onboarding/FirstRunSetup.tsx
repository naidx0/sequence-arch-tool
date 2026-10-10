/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN, PART TWO: THE SWIPE-STYLE SETUP
   packages/web2/src/onboarding/FirstRunSetup.tsx

   Three cards on a sliding track: connect a project (optional), trust and
   auto mode, done. Each card is one tap (Yes or No) or Skip; nothing else is
   asked and nobody should need to search Settings afterwards. Left arrow or
   a swipe to the right goes back one card.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { Icon } from '../chat/Icon';
import { writeAutoEditEnabled } from '../settings/autonomyPreference';

export interface SetupResult {
  /** The person asked for the project picker. */
  openProject: boolean;
  /** The person turned auto mode on. */
  autoMode: boolean;
}

export interface FirstRunSetupProps {
  onFinish: (r: SetupResult) => void;
}

type Answer = 'yes' | 'no' | 'skip' | null;

const CARDS = [
  {
    id: 'project',
    title: 'Open a project?',
    sub: 'Optional. Pick the folder you want to work in, or add one any time from the sidebar.',
    yes: 'Choose a project',
    no: 'Not now',
  },
  {
    id: 'trust',
    title: 'Let the agent work on its own?',
    sub: 'Auto mode lets it edit files and run approved commands without asking each time. Each project keeps its own permissions, and you can change this in Settings, Safety.',
    yes: 'Turn on auto mode',
    no: 'Keep asking me',
  },
] as const;

export function FirstRunSetup({ onFinish }: FirstRunSetupProps) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([null, null]);
  const rootRef = useRef<HTMLDivElement>(null);
  const downX = useRef<number | null>(null);
  const last = at === CARDS.length;

  /* Focus follows the card: the first button of the one on screen; the others are inert. */
  useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => {
      if (el.getAttribute('data-card') === String(at)) el.removeAttribute('inert');
      else el.setAttribute('inert', '');
    });
    /* preventScroll: focusing a card still sliding in must not scroll the clipped viewport out of step with the track. */
    rootRef.current?.querySelector<HTMLElement>(`[data-card="${at}"] button`)?.focus({ preventScroll: true });
  }, [at]);

  const answer = (a: Answer) => {
    setAnswers((cur) => cur.map((v, i) => (i === at ? a : v)));
    if (a === 'yes' && CARDS[at]?.id === 'trust') writeAutoEditEnabled(true);
    setAt((n) => Math.min(CARDS.length, n + 1));
  };

  const finish = () => onFinish({ openProject: answers[0] === 'yes', autoMode: answers[1] === 'yes' });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' && at > 0) {
      e.preventDefault();
      setAt(at - 1);
    }
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    downX.current = e.clientX;
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    const from = downX.current;
    downX.current = null;
    if (from !== null && e.clientX - from > 48 && at > 0) setAt(at - 1);
  };

  return (
    <div ref={rootRef} className="fr-setup" data-testid="first-run-setup" data-step={at} onKeyDown={onKeyDown}>
      <div className="fr-viewport" onPointerDown={onDown} onPointerUp={onUp}>
        <div className="fr-track" style={{ transform: `translateX(${-at * 100}%)` }}>
          {CARDS.map((c, i) => (
            <section key={c.id} className="fr-card" data-card={i} data-testid={`first-run-setup-${c.id}`} aria-hidden={at !== i}>
              <h2 className="fr-card-t">{c.title}</h2>
              <p className="fr-card-sub">{c.sub}</p>
              <div className="fr-card-acts">
                <button type="button" className="fr-btn fr-primary" data-testid={`first-run-setup-${c.id}-yes`} onClick={() => answer('yes')}>
                  {c.yes}
                </button>
                <button type="button" className="fr-btn" data-testid={`first-run-setup-${c.id}-no`} onClick={() => answer('no')}>
                  {c.no}
                </button>
                <button type="button" className="fr-ghost" data-testid={`first-run-setup-${c.id}-skip`} onClick={() => answer('skip')}>
                  Skip
                </button>
              </div>
            </section>
          ))}
          <section className="fr-card" data-card={CARDS.length} data-testid="first-run-setup-done" aria-hidden={!last}>
            <h2 className="fr-card-t">You are set</h2>
            <p className="fr-card-sub">
              {answers[0] === 'yes' ? 'The project picker opens next. ' : ''}
              {answers[1] === 'yes' ? 'Auto mode is on. ' : ''}
              Everything else lives in Settings.
            </p>
            <div className="fr-card-acts">
              <button type="button" className="fr-btn fr-primary" data-testid="first-run-setup-done-go" onClick={finish}>
                <Icon name="check" size={12} /> Done
              </button>
            </div>
          </section>
        </div>
      </div>
      <div className="fr-dots" role="group" aria-label="Setup progress">
        {[0, 1, 2].map((i) => (
          <span key={i} className="fr-dot" data-on={i === at ? 'true' : undefined} aria-current={i === at ? 'step' : undefined} />
        ))}
        {at > 0 ? (
          <button type="button" className="fr-ghost" data-testid="first-run-setup-back" onClick={() => setAt(at - 1)}>
            Back
          </button>
        ) : null}
      </div>
    </div>
  );
}
