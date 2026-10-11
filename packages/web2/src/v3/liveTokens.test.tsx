/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE TURN IS SPENDING, WHILE IT IS SPENDING IT
   packages/web2/src/v3/liveTokens.test.tsx

   Owner, 2026-09-21: "I just want to see how many tokens it's taking in the
   moment ... which will either show in the context ring or it can show during
   the actual process. But otherwise, I see it shows after the process, which
   is also cool."

   ── THIS REVERSES A RULING, AND KEEPS THE ONE UNDER IT ────────────────────

   Two days earlier the thinking strip was cut back to "Working · time · N
   running" with the note "Round / token bill stay in the store; they are not
   default HUD chrome". That answered a real complaint — the strip jittered,
   because nothing reserved a width — but it was not a finding that the number
   is uninteresting. He has now asked for it outright.

   The ruling that must survive is the OTHER one from that walk, which
   `V3App.test.tsx` holds as "One right-hand column, and it is always the
   clock". A count appearing to the right of the timer would change the
   identity of the far-right element the moment the first usage event landed —
   exactly the jitter that ruling exists to stop. So the count opens the
   right-hand group and the clock stays last.

   `V3App.test.tsx`'s HUD case cannot see any of this: its store has no usage,
   so it renders the no-count layout and would pass either way. This file is
   the case that produces only this.
   ══════════════════════════════════════════════════════════════════════════ */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createStore, StoreProvider, type Store } from '../state';
import { V3Chat } from './V3Chat';

/** A turn in flight, with or without the provider having accounted anything. */
function runningStore(usage?: { inputTokens: number; outputTokens: number }): Store {
  const store = createStore({});
  store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
  store.dispatch({ type: 'turn/send', at: 1 });
  if (usage) {
    /* The same action the live stream dispatches — `turn/event` carrying an
       `AskEvent`, discriminated on `type`, not `kind`. */
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'usage',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimated: false,
      },
      at: 2,
    } as never);
  }
  return store;
}

function mount(store: Store) {
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat />
      </div>
    </StoreProvider>,
  );
}

describe('the live token count', () => {
  it('is absent until the provider has accounted something', () => {
    mount(runningStore());

    /*
     * NOT A ZERO. A zero here is a claim that nothing has been spent, which is
     * the one thing it certainly is not — the request went out. Same rule the
     * context ring keeps: never invent usage.
     */
    expect(screen.queryByTestId('v3-thinking-tokens')).toBeNull();
    expect(screen.getByTestId('v3-thinking-elapsed')).toBeTruthy();
  });

  it('shows input and output as soon as a usage event lands', () => {
    mount(runningStore({ inputTokens: 138_000, outputTokens: 4_100 }));

    const tokens = screen.getByTestId('v3-thinking-tokens');
    /* Compacted the same way every other token figure in the product is, so
       138000 and 4100 do not read as two different kinds of number. */
    expect(tokens.textContent).toMatch(/138k\s*in/);
    expect(tokens.textContent).toMatch(/4\.1k\s*out/);
  });

  it('does not take the far-right column away from the clock', () => {
    mount(runningStore({ inputTokens: 9_100, outputTokens: 200 }));

    const bar = screen.getByTestId('v3-thinking-bar');
    const order = [...bar.children]
      .map((el) => el.getAttribute('data-testid'))
      .filter((id): id is string => id !== null);

    /*
     * THE 2026-09-19 RULING, TESTED IN THE CASE THAT CAN BREAK IT. The
     * existing HUD case asserts the same thing against a store with no usage,
     * where the count is not rendered at all — so it holds while this is
     * false.
     */
    expect(order[order.length - 1]).toBe('v3-thinking-elapsed');
    expect(order).toContain('v3-thinking-tokens');
    expect(
      order.indexOf('v3-thinking-tokens'),
      'the count opens the right-hand group; the clock closes it',
    ).toBeLessThan(order.indexOf('v3-thinking-elapsed'));
  });
});
