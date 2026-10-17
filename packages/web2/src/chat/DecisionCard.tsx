/* ══════════════════════════════════════════════════════════════════════════
   THE DECISION CARD — a plan and its questions, answerable in one click
   packages/web2/src/chat/DecisionCard.tsx

   Owner, 2026-10-10: "when it generates a plan or finishes something but has
   questions for the user, like decisions, add pop-ups to make it easier to
   read and follow along". When a chat's last finished answer ends with
   questions or options (decisionModel.ts), this card sits under it: the plan
   steps as a checklist, each question with its options as kit chips.

     a click picks an option (a second click un-picks); Send sends the
     picks as one message. One question or several, a pick alone never
     sends: a stray click on a card the reader meant to ignore costs nothing
     (0.1.5 review, H2).
   Dismiss (the x, or Escape) hides it for good; the answer text above stays.
   Keys while the card has focus: 1-9 pick that option when there is one
   question; Escape dismisses. The chips are buttons, so Tab and Enter work.

   The permission and question REQUESTS an agent holds open are not here:
   ApprovalGate and QuestionCard answer those on the request itself.

   No layout jump: the card appears once, when the turn is done, below the
   answer; nothing above it moves, and it is gone the moment a message is sent.
   Pure presentation: the source arrives in props, the answer leaves by onSend.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { S2Icon } from '../shell2/icons';
import { composeAnswer } from './decisionModel';
import type { DecisionSource } from './decisionSource';
import { keptOpen } from './keptOpen';

import './decision.css';

const MARK = { pending: '○', active: '◆', done: '✓' } as const;

export const dismissedKey = (id: string): string => `decision-dismissed:${id}`;

export function DecisionCard({ source, onSend }: { source: DecisionSource; onSend: (text: string) => void }) {
  const [gone, setGone] = useState(() => keptOpen.get(dismissedKey(source.id)) === true);
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);
  const { set, plan } = source;
  const asked = set.questions.filter((q) => q.options.length > 0);
  if (gone || asked.length === 0) return null;
  const single = set.questions.length === 1;

  const dismiss = (): void => {
    keptOpen.set(dismissedKey(source.id), true);
    setGone(true);
  };
  const send = (text: string | null): void => {
    if (!text || sent) return;
    setSent(true);
    onSend(text);
  };
  /* A pick never sends: a stray click on a card the reader did not mean to answer costs nothing. Send does. */
  const pick = (n: number, text: string): void => {
    if (sent) return;
    setChosen((c) => {
      const next = { ...c };
      if (next[n] === text) delete next[n];
      else next[n] = text;
      return next;
    });
  };
  const count = Object.keys(chosen).length;
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
      return;
    }
    if (!single || !/^[1-9]$/.test(e.key)) return;
    const o = set.questions[0]!.options[Number(e.key) - 1];
    if (!o) return;
    e.preventDefault();
    pick(set.questions[0]!.n, o.send);
  };

  return (
    <section className="s2-dec" data-testid="decision-card" aria-label="Decisions for you" aria-busy={sent || undefined} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="s2-dec-head">
        <span className="s2-dec-title">{set.questions.length > 1 ? 'Decisions for you' : 'Your decision'}</span>
        <span className="s2-grow" />
        <button type="button" className="s2-ibtn s2-ibtn-xs" data-testid="decision-dismiss" aria-label="Dismiss" title="Dismiss (Esc)" onClick={dismiss}>
          <S2Icon name="x" small />
        </button>
      </header>
      {plan.length > 0 ? (
        <ol className="s2-dec-plan" data-testid="decision-plan" aria-label="Plan">
          {plan.map((p, i) => (
            <li key={i} className="s2-dec-step" data-status={p.status}>
              <span className="s2-dec-mark" aria-hidden="true">
                {MARK[p.status]}
              </span>
              <span className="s2-dec-text">{p.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="s2-dec-qs">
        {set.questions.map((q) => (
          <fieldset key={q.n} className="s2-dec-q" data-testid="decision-question" disabled={sent}>
            <legend className="s2-dec-qtext">
              {single ? null : <span className="s2-dec-n">{q.n}</span>}
              {q.text}
            </legend>
            {q.options.length ? (
              <div className="s2-dec-opts" role="radiogroup" aria-label={q.text}>
                {q.options.map((o, i) => {
                  const on = chosen[q.n] === o.send;
                  return (
                    <button
                      key={`${q.n}:${i}`}
                      type="button"
                      className={`s2-chipbtn s2-dec-opt${on ? ' is-on' : ''}`}
                      data-testid="decision-option"
                      role="radio"
                      aria-checked={on}
                      title={o.detail ? `${o.label}: ${o.detail}` : o.label}
                      onClick={() => pick(q.n, o.send)}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </fieldset>
        ))}
      </div>
      <footer className="s2-dec-foot">
        {single ? null : (
          <span className="s2-meta s2-mono">
            {count} of {asked.length}
          </span>
        )}
        <span className="s2-grow" />
        <button type="button" className="s2-btn s2-btn-sm s2-blue" data-testid="decision-send" disabled={count === 0 || sent} onClick={() => send(composeAnswer(set, chosen))}>
          {single ? 'Send answer' : 'Send answers'}
        </button>
      </footer>
    </section>
  );
}
