import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Composer } from './Composer';
import { modelLabel } from './modelSelection';
import { composerHandlers, composerSlice } from './fixtures';

/**
 * FIRST RUN: NO MODEL CONNECTED.
 *
 * The owner's ask for the desktop build, in his words: "just download this
 * thing. You can connect your own model from one click." This is what a
 * stranger met before it was looked at, and it was two clicks through nothing:
 *
 *   the chip said "Choose reasoning in Sett…" — cut where it named the place —
 *   and clicking it opened a menu with no rows in it.
 *
 * ── THE LABEL: MEASURED, NOT ESTIMATED, AND THE FIRST DIAGNOSIS WAS WRONG ──
 *
 * `.modelsel` declares `max-width: min(100%, 220px)` and ellipsizes. The
 * obvious reading is that the sentence exceeded 220px. IT DOES NOT. Measured in
 * a real browser at the real face — 11px JetBrains Mono, 6.6px per character —
 * "Choose reasoning in Settings" is 184.8px in a 202.8px button: comfortably
 * inside the cap, `scrollWidth === clientWidth`, NOT CLIPPED.
 *
 * The constraint is the other half of the same rule. `min(100%, …)` means the
 * label yields to its flex row, and `.modelsel`'s own comment says that is
 * deliberate: "THE MODEL LABEL ABSORBS THE SQUEEZE, NEVER THE SEND CLUSTER." In
 * a narrow chat pane the label is the thing that gives, so a 184.8px sentence
 * loses its last word while a 99px one survives.
 *
 * THE CAP IS RIGHT AND IS NOT TOUCHED. `qwen2.5-coder:32b-instruct-q4_K_M`
 * measures 217.8px and clips at 220 — correct, because a model id is a NAME and
 * shortening a name on screen beats shoving the send button off the row. This
 * label is not a name. It is an instruction, and an instruction cut before its
 * object says nothing at all.
 */

/** Measured in-browser on the rendered `.modelsel .mono`, not assumed. */
const MONO_ADVANCE_T12 = 6.6;

/**
 * What the label must survive.
 *
 * Not the 220px cap — the SQUEEZE. On the owner's own screen the chat pane sat
 * beside the board and the chip shared its row with the attach, link, image and
 * send controls; the room left for a label there is a fraction of 220. 120px is
 * the budget this asserts against: generous enough not to be a guess dressed as
 * a measurement, tight enough that the sentence which actually clipped fails it.
 */
const SQUEEZED_BUDGET_PX = 120;

const px = (text: string) => text.length * MONO_ADVANCE_T12;

describe('the chip tells a stranger what to do, in words that survive the squeeze', () => {
  it('names the action, and the whole label fits a squeezed row', () => {
    const label = modelLabel({ model: '', origin: 'unconfigured' });
    expect(label).toBe('Connect a model');
    expect(px(label), `"${label}" measures ${px(label).toFixed(1)}px`).toBeLessThanOrEqual(
      SQUEEZED_BUDGET_PX,
    );
  });

  it('THE OLD SENTENCE FAILS THE SAME BUDGET — the fault was real', () => {
    /*
     * The control. A budget loose enough to admit anything proves nothing, so
     * the string that actually shipped and actually clipped must fail it. It
     * measures 184.8px against 120: it loses its last word first, which is the
     * word that named where to go.
     */
    expect(px('Choose reasoning in Settings')).toBeGreaterThan(SQUEEZED_BUDGET_PX);
  });

  it('a model id is a NAME and still ellipsizes — the cap is untouched', () => {
    /* The limit of the change. Renaming someone's model to fit a box would be
       worse than shortening it on screen. */
    const long = 'qwen2.5-coder:32b-instruct-q4_K_M';
    expect(modelLabel({ model: long, origin: 'local' })).toBe(long);
    expect(px(long)).toBeGreaterThan(SQUEEZED_BUDGET_PX);
  });

  it('READS THE DOM: an empty menu says why it is empty and goes where the fix is', async () => {
    /*
     * `profilesFromConfig` returns [] for any config that is not
     * `configured: true`, so first run opened this menu with no rows at all.
     * One row now says why, and reaches Settings in one gesture.
     */
    const onToolbeltPick = vi.fn();
    render(
      <Composer
        {...composerHandlers({ onToolbeltPick })}
        composer={composerSlice({ draft: '' })}
        modelPicker={{
          list: async () => ({ outcome: 'ok' as const, profiles: [] }),
          select: async () => ({ outcome: 'ok' as const, model: '' }),
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));
    const row = await screen.findByTestId('composer-model-none');
    expect(row.textContent).toContain('No model connected');

    fireEvent.click(row);
    expect(onToolbeltPick).toHaveBeenCalledWith('models');
  });

  it('THE LOCK HOLDS: with models to choose between, no such row appears', async () => {
    /*
     * `modelPicker.test.tsx` locks "opens a MENU rather than the whole Settings
     * dialog", with the note "THE DEFECT, locked: this used to be the ONLY
     * behaviour of the chip" — the chip once always jumped to Settings and that
     * WAS the bug. Nothing here reverses it: the click is unchanged, the menu
     * still opens, and the empty row exists only when the list came back empty.
     */
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '' })}
        modelPicker={{
          list: async () => ({
            outcome: 'ok' as const,
            profiles: [{ id: 'local', name: 'Local', model: 'granite4', provider: 'openai-compatible', active: true }],
          }),
          select: async () => ({ outcome: 'ok' as const, model: 'granite4' }),
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));
    await screen.findAllByTestId('composer-model-option');
    expect(screen.queryByTestId('composer-model-none')).toBeNull();
  });
});
