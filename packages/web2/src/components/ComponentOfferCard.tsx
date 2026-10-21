/*
 * THE COMPONENT OFFER: "Use <name>?" with the reason, and two answers.
 *
 * A `component:offer` turn event in `approve` mode. It is the DecisionCard's
 * shell (s2-dec) with the approval gate's buttons (s2-gate, s2-btn): the same
 * parts the permission and decision cards are made of, no new button type.
 * Pure presentation: the answer leaves by `onAnswer(accept)`.
 */
import type { ComponentOffer } from '../state/types';

import '../chat/decision.css';

export function ComponentOfferCard({ offer, onAnswer }: { offer: ComponentOffer; onAnswer: (accept: boolean) => void }) {
  const busy = offer.status === 'sending';
  return (
    <section className="s2-dec" data-testid="component-offer" data-offer={offer.offerId} aria-label={`Use ${offer.name}?`} aria-busy={busy || undefined}>
      <header className="s2-dec-head">
        <span className="s2-dec-title">Component</span>
      </header>
      <p className="s2-dec-qtext" data-testid="component-offer-title">
        Use {offer.name}?
      </p>
      {offer.reason ? (
        <p className="s2-dec-text" data-testid="component-offer-reason">
          {offer.reason}
        </p>
      ) : null}
      <footer className="s2-dec-foot">
        <span className="s2-grow" />
        <span className="s2-gate">
          <button type="button" className="s2-btn s2-btn-sm" disabled={busy} data-testid="component-offer-decline" onClick={() => onAnswer(false)}>
            Keep the regular workflow
          </button>
          <button type="button" className="s2-btn s2-btn-sm s2-blue" disabled={busy} data-testid="component-offer-accept" onClick={() => onAnswer(true)}>
            Use it
          </button>
        </span>
      </footer>
    </section>
  );
}
