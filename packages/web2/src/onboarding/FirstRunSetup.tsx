/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN, PART TWO: THE SWIPE-STYLE SETUP
   packages/web2/src/onboarding/FirstRunSetup.tsx

   Five cards on a sliding track: connect a project (optional), trust and
   auto mode, the architecture map (with an On / Off example), bring skills (optional, FirstRunSkills), done. Each card is one tap (Yes or No) or Skip; nothing else is
   asked and nobody should need to search Settings afterwards. Left arrow or
   a swipe to the right goes back one card; a swipe to the left goes on (Decision 52,
   the same distance and flick as a sheet's swipe, and the track follows the finger).
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { Icon } from '../chat/Icon';
import { writeAutoEditEnabled } from '../settings/autonomyPreference';
import { FirstRunMapExample } from './FirstRunMapExample';
import { FirstRunSkills } from './FirstRunSkills';
import { SWIPE_SLOP, swipeReleases } from '../shell2/useSwipeDismiss';
import type { OnboardingClient } from './onboardingClient';

export interface SetupResult {
  /** The person asked for the project picker. */
  openProject: boolean;
  /** The person turned auto mode on. */
  autoMode: boolean;
}

export interface FirstRunSetupProps {
  /** Where the skills step looks and imports; without one the step still shows and Skip works. */
  client?: OnboardingClient;
  onFinish: (r: SetupResult) => void;
  /** An agent was connected on this screen; "Ask my agent" in the skills step hands its prompt to onAskAgent and finishes. */
  agentConnected?: boolean;
  onAskAgent?: (prompt: string) => void;
  /** For the map step's token count and its answer; defaults to the page's fetch. */
  fetchImpl?: typeof fetch;
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
  {
    id: 'map',
    title: 'Give agents the architecture map?',
    sub: 'A compact text map of your services and how they connect, added to the agent’s context on every turn (one message from you and the reply). Here is what it takes of a 500k window.',
    yes: 'Yes, include the map',
    no: 'No, leave it out',
  },
] as const;

export function FirstRunSetup({ client, onFinish, agentConnected, onAskAgent, fetchImpl }: FirstRunSetupProps) {
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>(CARDS.map(() => null));
  /* The server's own count of the map block, when it has one for this project; else the example uses the default map budget. */
  const [mapTokens, setMapTokens] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /* The swipe: where the finger went down, the last two samples (for a flick), and how far the track is dragged. */
  const swipe = useRef<{ id: number; x: number; y: number; on: boolean; t0: number; m0: number; t1: number; m1: number } | null>(null);
  const swallowClick = useRef(false);
  const [drag, setDrag] = useState(0);
  /* After the two questions comes the skills step, then done. */
  const SKILLS_AT = CARDS.length;
  const DONE_AT = CARDS.length + 1;
  const last = at === DONE_AT;

  /* Focus follows the card: the first button of the one on screen; the others are inert. */
  useEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>('[data-card]').forEach((el) => {
      if (el.getAttribute('data-card') === String(at)) el.removeAttribute('inert');
      else el.setAttribute('inert', '');
    });
    /* preventScroll: focusing a card still sliding in must not scroll the clipped viewport out of step with the track. */
    rootRef.current?.querySelector<HTMLElement>(`[data-card="${at}"] input, [data-card="${at}"] button`)?.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    const f = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!f) return undefined;
    let live = true;
    void (async () => {
      try {
        const r = await f('/api/agent-settings', { headers: { accept: 'application/json' } });
        if (!r.ok) return;
        const v = (await r.json()) as { map?: { tokens?: number } | null };
        if (live && typeof v?.map?.tokens === 'number') setMapTokens(v.map.tokens);
      } catch {
        /* no server answer: the example says it is an example */
      }
    })();
    return () => {
      live = false;
    };
  }, [fetchImpl]);

  const [mapSaveFailed, setMapSaveFailed] = useState(false);
  const saveMap = (on: boolean) => {
    const f = fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!f) return;
    setMapSaveFailed(false);
    void Promise.resolve(f('/api/agent-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ includeArchitectureMap: on }) })).then(
      (r) => {
        if (!r.ok) setMapSaveFailed(true);
      },
      () => setMapSaveFailed(true),
    );
  };

  const answer = (a: Answer) => {
    setAnswers((cur) => cur.map((v, i) => (i === at ? a : v)));
    if (a === 'yes' && CARDS[at]?.id === 'trust') writeAutoEditEnabled(true);
    if (CARDS[at]?.id === 'map' && (a === 'yes' || a === 'no')) saveMap(a === 'yes');
    setAt((n) => Math.min(SKILLS_AT, n + 1));
  };

  const finish = () => onFinish({ openProject: answers[0] === 'yes', autoMode: answers[1] === 'yes' });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' && at > 0) {
      e.preventDefault();
      setAt(at - 1);
    }
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
    const t = performance.now();
    swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, t0: t, m0: 0, t1: t, m1: 0 };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    if (!s.on) {
      if (Math.abs(dx) < SWIPE_SLOP) return;
      if (Math.abs(e.clientY - s.y) > Math.abs(dx)) {
        swipe.current = null;
        return;
      }
      s.on = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    }
    s.t0 = s.t1;
    s.m0 = s.m1;
    s.t1 = performance.now();
    s.m1 = dx;
    /* Past either end the track gives way a third as far, then comes back. */
    const blocked = (dx > 0 && at === 0) || (dx < 0 && at === SKILLS_AT);
    setDrag(blocked ? dx / 3 : dx);
  };
  const endSwipe = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId || !s.on) return;
    setDrag(0);
    swallowClick.current = true;
    window.setTimeout(() => { swallowClick.current = false; }, 0);
    if (cancelled) return;
    const dx = e.clientX - s.x;
    const v = Math.abs(s.m1 - s.m0) / Math.max(1, s.t1 - s.t0);
    if (!swipeReleases(Math.abs(dx), v)) return;
    if (dx > 0 && at > 0) setAt(at - 1);
    else if (dx < 0 && at < SKILLS_AT) setAt(at + 1);
  };

  return (
    <div ref={rootRef} className="fr-setup" data-testid="first-run-setup" data-step={at} onKeyDown={onKeyDown}>
      <div
        className="fr-viewport"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => endSwipe(e, false)}
        onPointerCancel={(e) => endSwipe(e, true)}
        onClickCapture={(e) => {
          /* The tap that ends a drag is not a press on whatever the finger lifted over. */
          if (!swallowClick.current) return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div
          className="fr-track"
          data-dragging={drag !== 0 ? 'true' : undefined}
          style={{ transform: `translateX(calc(${-at * 100}% + ${drag}px))` }}
        >
          {CARDS.map((c, i) => (
            <section key={c.id} className="fr-card" data-card={i} data-testid={`first-run-setup-${c.id}`} aria-hidden={at !== i}>
              <h2 className="fr-card-t">{c.title}</h2>
              <p className="fr-card-sub">{c.sub}</p>
              {c.id === 'map' ? <FirstRunMapExample tokens={mapTokens} /> : null}
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
          <FirstRunSkills
            client={client}
            card={SKILLS_AT}
            active={at === SKILLS_AT}
            agentConnected={agentConnected === true}
            {...(onAskAgent
              ? {
                  onAskAgent: (prompt: string) => {
                    onAskAgent(prompt);
                    finish();
                  },
                }
              : {})}
            onNext={() => setAt(DONE_AT)}
          />
          <section className="fr-card" data-card={DONE_AT} data-testid="first-run-setup-done" aria-hidden={!last}>
            <h2 className="fr-card-t">You are set</h2>
            <p className="fr-card-sub">
              {answers[0] === 'yes' ? 'The project picker opens next. ' : ''}
              {answers[1] === 'yes' ? 'Auto mode is on. ' : ''}
              {mapSaveFailed ? 'The map choice could not be saved; change it in Settings, Workspace. ' : answers[2] === 'yes' ? 'The architecture map is on. ' : answers[2] === 'no' ? 'The architecture map is off. ' : ''}
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
        {Array.from({ length: DONE_AT + 1 }, (_, i) => i).map((i) => (
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
