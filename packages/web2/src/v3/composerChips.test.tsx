/* ══════════════════════════════════════════════════════════════════════════
   A REFERENCE THE READER CANNOT SEE IS A HIDDEN ARGUMENT
   packages/web2/src/v3/composerChips.test.tsx

   A context chip is not decoration. `composerPropsFrom`'s `onSend` reads
   `composer.chips` and puts every one of them in the next message's scope, so
   a chip changes the question and changes the answer.

   V3 drew none of them. Two doors produce chips — a click on a board card
   (`ConnectedBoard`'s `onGround`, "the same one the `@` picker uses") and the
   `@` picker itself — and both landed in the store silently. So a reference
   could be attached to a question, sent with it, and never appear on screen;
   a stray chip from a card clicked ten minutes ago rode along with everything
   after it, and there was no way to notice and no way to take it off.

   THE TWO PROPERTIES, AND THE SECOND IS THE ONE THAT MATTERS:

     1. A chip that is in the scope is ON SCREEN.
     2. A chip that is on screen CAN BE TAKEN OFF, and taking it off takes it
        out of the scope — not merely out of the row.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createStore, type Store } from '../state';
import { V3App } from './V3App';

function storeWithChips(): Store {
  const store = createStore({});
  store.dispatch({
    type: 'composer/chip-add',
    chip: {
      id: 'node:svc:gateway',
      kind: 'node',
      ref: 'svc:gateway',
      label: 'gateway',
      nodeKind: 'service',
    },
  });
  store.dispatch({
    type: 'composer/chip-add',
    chip: {
      id: 'file:src/scan.ts',
      kind: 'file',
      ref: 'src/scan.ts',
      label: 'scan.ts',
      nodeKind: null,
    },
  });
  return store;
}

describe('the composer draws the references it is about to send', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('draws one chip per chip in the scope, labelled', () => {
    render(<V3App appStore={storeWithChips()} />);

    const chips = screen.getAllByTestId('composer-chip');
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('gateway')]),
    );
    /* The KIND travels on the element: a file reference and a node reference
       mean different things to the engine, and the row should be able to say
       which without the reader opening the title. */
    expect(chips.map((c) => c.getAttribute('data-kind')).sort()).toEqual(['file', 'node']);
  });

  it('says what a chip IS, in words, not only by its shape', () => {
    /* "Grounded ask context" — the chip is not a tool call and not a filter;
       it is text added to the next message's scope, and a reader who is about
       to be billed for that turn is owed the sentence. */
    render(<V3App appStore={storeWithChips()} />);
    const title = screen.getAllByTestId('composer-chip')[0]!.getAttribute('title') ?? '';
    expect(title).toMatch(/grounded ask context/i);
    expect(title).toMatch(/svc:gateway|src\/scan\.ts/);
  });

  it('removing a chip removes it from the SCOPE, not just from the row', () => {
    /*
     * THE ASSERTION THAT COSTS SOMETHING. A × that only hid the pill would
     * pass a DOM check and go on sending the reference — the same defect this
     * file exists for, wearing a remove button.
     */
    const store = storeWithChips();
    render(<V3App appStore={store} />);

    fireEvent.click(screen.getAllByTestId('composer-chip-remove')[0]!);

    expect(screen.getAllByTestId('composer-chip')).toHaveLength(1);
    expect(store.getState().composer.chips.map((c) => c.id)).toEqual(['file:src/scan.ts']);
  });

  it('draws no row at all when there is nothing to reference', () => {
    /* An empty row is a strip of furniture on the most-looked-at surface in
       the product, charged for on every thread that never grounds anything. */
    render(<V3App appStore={createStore({})} />);
    expect(screen.queryByTestId('composer-chips')).toBeNull();
    expect(screen.queryAllByTestId('composer-chip')).toHaveLength(0);
  });
});
