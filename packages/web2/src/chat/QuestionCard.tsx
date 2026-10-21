/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT ASKS — a clarifying question, answered in the chat
   packages/web2/src/chat/QuestionCard.tsx

   Codex's plan mode stops to ask (item/tool/requestUserInput): one or more
   questions, each with options and, where codex allows, the person's own
   words. Live 2026-10-06 the question was refused and codex guessed; now the
   server holds the turn (`acp:question`) and this card is where it is
   answered (`POST /api/acp/question`).

   THE APPROVAL GATE'S SHAPE (ApprovalGate.tsx, EditApprovalCardAgent.tsx):
   the question in the head weight, the options as answers with their keys,
   the scope line quiet, Send / Cancel with theirs. Answered, it folds to ONE
   ROW saying what went back and who settled it; the record never vanishes.

   KEYS, while the card has focus and never inside a text field:
     1-9   pick that option for the next question still unanswered
     y     send (once every question has an answer)
     n     cancel: the agent goes on without an answer
   Enter in the text field sends; Escape there cancels.

   Pure presentation: the question arrives in props, the answer leaves
   through `onAnswer` (answers, or null to cancel).
   ══════════════════════════════════════════════════════════════════════════ */

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { AgentQuestion, QuestionAnswers, QuestionItem } from '../agents/runNodeStream';
import { isTextEntry } from './ApprovalGate';

import { S2Icon } from '../shell2/icons';

interface Choice {
  option: string | null;
  text: string;
}

const EMPTY: Choice = { option: null, text: '' };

/** What one question's choice sends: the person's own words win over an option. */
function answerOf(c: Choice | undefined): string[] {
  if (!c) return [];
  const words = c.text.trim();
  if (words) return [words];
  return c.option ? [c.option] : [];
}

/** Every question's answer, or null while one is still unanswered. */
export function answersFor(questions: readonly QuestionItem[], choices: Readonly<Record<string, Choice>>): QuestionAnswers | null {
  const out: QuestionAnswers = {};
  for (const q of questions) {
    const a = answerOf(choices[q.id]);
    if (a.length === 0) return null;
    out[q.id] = a;
  }
  return out;
}

/** The status word and card status the header shows. */
export function questionStatus(q: AgentQuestion): { status: string; word: string } {
  if (!q.settled) return { status: 'waiting', word: q.sending ? 'sending' : 'needs you' };
  switch (q.answeredBy) {
    case 'cancel':
      return { status: 'denied', word: 'cancelled' };
    case 'ended':
      return { status: 'denied', word: 'turn ended' };
    case 'timeout':
      return { status: 'denied', word: 'timed out' };
    case 'disconnect':
      return { status: 'denied', word: 'run ended' };
    default:
      return { status: 'allowed', word: 'answered' };
  }
}

/** The card's title: what is being asked about. */
export function questionTitle(q: AgentQuestion): string {
  const heads = q.questions.map((x) => x.header || x.question).filter(Boolean);
  return heads.length ? `Question: ${heads.join(', ')}` : 'Question';
}

/** The folded row's sentence. */
export function questionSentence(q: AgentQuestion): string {
  switch (q.answeredBy) {
    case 'cancel':
      return 'Cancelled: the agent went on without an answer';
    case 'ended':
      return 'The turn ended before anyone answered';
    case 'timeout':
      return 'No answer in time: the agent went on without one';
    case 'disconnect':
      return 'The run ended before anyone answered';
    default:
      return 'Answered by you';
  }
}

function Folded({ question }: { question: AgentQuestion }) {
  const given = question.answers ?? {};
  const parts = question.questions
    .filter((x) => given[x.id]?.length)
    .map((x) => `${x.header || x.question}: ${x.isSecret ? '(hidden)' : given[x.id]!.join(', ')}`);
  return (
    <section className="s2-q-folded" data-testid="agent-question-folded" data-answered-by={question.answeredBy ?? ''} aria-label={questionSentence(question)}>
      <S2Icon name={question.answeredBy === 'person' ? 'check' : 'x'} small className={question.answeredBy === 'person' ? 's2-ok' : 's2-del'} />
      <span data-testid="agent-question-answer" data-decision={question.answeredBy === 'person' ? 'accepted' : 'rejected'}>
        {questionSentence(question)}
      </span>
      {parts.map((p) => (
        <span key={p} className="s2-meta s2-q-what" title={p}>
          {p}
        </span>
      ))}
    </section>
  );
}

/** An option the agent marked as its recommendation ("… (Recommended)"), preselected. */
export function recommendedOf(q: QuestionItem): string | null {
  return q.options.find((o) => /\(recommended\)/i.test(o.label))?.label ?? null;
}

/**
 * Decision 49 (DeepSeek's logic, uiarc.dev's look): one question at a time
 * with a pager, the agent's recommendation preselected, compact one-line rows
 * (the description muted and cut, whole on hover), one line of own words, and
 * Skip / Send always in the footer.
 */
export function QuestionCard({ question, onAnswer }: { question: AgentQuestion; onAnswer: (answers: QuestionAnswers | null) => void }) {
  const [choices, setChoices] = useState<Record<string, Choice>>(() => {
    const init: Record<string, Choice> = {};
    for (const q of question.questions) {
      const rec = recommendedOf(q);
      if (rec) init[q.id] = { option: rec, text: '' };
    }
    return init;
  });
  const [at, setAt] = useState(0);
  if (question.settled) return <Folded question={question} />;
  const busy = question.sending;
  const ready = answersFor(question.questions, choices);
  const total = question.questions.length;
  const page = Math.min(at, total - 1);
  const pick = (id: string, option: string): void => setChoices((c) => ({ ...c, [id]: { option, text: '' } }));
  const type = (id: string, text: string): void => setChoices((c) => ({ ...c, [id]: { option: text.trim() ? null : (c[id]?.option ?? null), text } }));
  const send = (): void => {
    if (ready && !busy) onAnswer(ready);
  };
  const cancel = (): void => {
    if (!busy) onAnswer(null);
  };
  const go = (d: number): void => setAt((i) => Math.max(0, Math.min(total - 1, Math.min(i, total - 1) + d)));
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (busy || e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTextEntry(e.target)) {
      if (e.key === 'Enter' && !e.shiftKey && ready) {
        e.preventDefault();
        send();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'y') {
      if (!ready) return;
      e.preventDefault();
      send();
      return;
    }
    if (key === 'n') {
      e.preventDefault();
      cancel();
      return;
    }
    if (key === 'arrowright' || key === 'arrowleft') {
      e.preventDefault();
      go(key === 'arrowright' ? 1 : -1);
      return;
    }
    const n = /^[1-9]$/.test(key) ? Number(key) : 0;
    if (!n) return;
    const q = question.questions[page];
    const option = q?.options[n - 1];
    if (!q || !option) return;
    e.preventDefault();
    pick(q.id, option.label);
  };
  return (
    <section className="s2-q" data-testid="agent-question" aria-label="The agent asks" aria-busy={busy || undefined} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="s2-q-body">
        {question.questions.map((q, qi) => {
          const c = choices[q.id] ?? EMPTY;
          return (
            <fieldset key={q.id} className="s2-q-item" data-testid="agent-question-item" disabled={busy} hidden={qi !== page}>
              <legend className="s2-q-title">
                {q.header ? <span className="s2-q-head">{q.header}</span> : null}
                {q.question}
              </legend>
              {q.options.length ? (
                <div className="s2-q-opts" role="radiogroup" aria-label={q.header || q.question}>
                  {q.options.map((o, oi) => {
                    const on = c.option === o.label && !c.text.trim();
                    return (
                      <button
                        key={o.label}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`s2-opt${on ? ' is-on' : ''}`}
                        data-testid="agent-question-option"
                        title={o.description ? `${o.label}: ${o.description}` : o.label}
                        onClick={() => pick(q.id, o.label)}
                      >
                        <span className="s2-num" aria-hidden={oi >= 9}>
                          {oi < 9 ? oi + 1 : ''}
                        </span>
                        <span className="s2-opt-l">{o.label}</span>
                        {o.description ? <span className="s2-opt-d">{o.description}</span> : <span className="s2-grow" />}
                        {on ? <S2Icon name="check" small /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {q.isOther || q.options.length === 0 ? (
                <input
                  className="s2-q-text"
                  data-testid="agent-question-text"
                  type={q.isSecret ? 'password' : 'text'}
                  autoComplete="off"
                  placeholder={q.options.length ? 'Or answer in your own words' : 'Your answer'}
                  aria-label={`${q.header || `Question ${qi + 1}`}: your own answer`}
                  value={c.text}
                  onChange={(e) => type(q.id, e.target.value)}
                />
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <div className="s2-q-foot" data-testid="agent-question-acts">
        {total > 1 ? (
          <span className="s2-pager" data-testid="agent-question-pager">
            <button type="button" className="s2-ibtn s2-ibtn-xs" aria-label="Previous question" disabled={page === 0} onClick={() => go(-1)}>
              <S2Icon name="chevr" small className="s2-flip" />
            </button>
            <span className="s2-mono s2-meta">
              {page + 1} of {total}
            </span>
            <button type="button" className="s2-ibtn s2-ibtn-xs" aria-label="Next question" disabled={page >= total - 1} onClick={() => go(1)}>
              <S2Icon name="chevr" small />
            </button>
          </span>
        ) : null}
        <span className="s2-grow" />
        <button type="button" className="s2-btn" disabled={busy} data-testid="agent-question-cancel" title="The agent goes on without an answer" onClick={cancel}>
          Skip <span className="s2-kbd">N</span>
        </button>
        <button type="button" className="s2-btn s2-blue" disabled={!ready || busy} data-testid="agent-question-send" onClick={send}>
          {busy ? 'Sending' : 'Send'} <span className="s2-kbd s2-kbd-on">Y</span>
        </button>
      </div>
    </section>
  );
}
