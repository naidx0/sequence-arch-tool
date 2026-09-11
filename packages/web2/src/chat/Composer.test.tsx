import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolvedStyle, substituteVars } from '../../test/support/css';
import '../tokens/graphite.css';
import '../styles/base.css';
import './chat.css';
import { Composer } from './Composer';
import { composerHandlers, composerSlice } from './fixtures';

/**
 * ITEM 2.7 — THE COMPOSER, RENDERED.
 *
 * Sheet 12.4 draws three zones inside one container: the field, the control
 * row, and — outside the border — the under-composer strip. The circular filled
 * send button is named on the sheet as THE SIGNATURE ELEMENT, and it is the one
 * object on this surface allowed to be saturated.
 *
 * The behaviours asserted here are the ones the owner named ml-harness as
 * better at (docs/research/ml-harness-adoption.md §1.12): Enter vs Shift+Enter,
 * what happens mid-stream when the user types, and a disabled send that reads
 * as absence rather than as a faded promise.
 *
 * Cited: docs/brand/graphite/pages/12-the-agentic-surfaces.html §12.4.
 */

function token(name: string): string {
  return substituteVars(`var(${name})`, document.documentElement);
}

describe('item 2.7 — Enter sends, Shift+Enter newlines', () => {
  it('sends on Enter and stops the textarea inserting a line', () => {
    const onSend = vi.fn();
    render(<Composer {...composerHandlers({ onSend })} composer={composerSlice({ draft: 'what breaks' })} />);

    const field = screen.getByTestId('composer-field');
    const sent = fireEvent.keyDown(field, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledTimes(1);
    // fireEvent returns false when preventDefault() was called. Without it the
    // textarea keeps the newline it was about to insert and the next turn opens
    // with a blank line.
    expect(sent).toBe(false);
  });

  it('lets Shift+Enter through so the user can write a second paragraph', () => {
    const onSend = vi.fn();
    render(<Composer {...composerHandlers({ onSend })} composer={composerSlice({ draft: 'what breaks' })} />);

    const field = screen.getByTestId('composer-field');
    const sent = fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(sent).toBe(true);
  });

  it('does not send the IME candidate an East Asian user just accepted', () => {
    /*
     * MLH/frontend/src/components/Composer.tsx:182-192, ported. v1 has no such
     * check and the adoption study marks it a CONFIRMED BUG: pressing Enter to
     * accept a composition sends a half-composed message.
     */
    const onSend = vi.fn();
    render(<Composer {...composerHandlers({ onSend })} composer={composerSlice({ draft: 'auth' })} />);

    const field = screen.getByTestId('composer-field');
    fireEvent.compositionStart(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(field);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('stays fully usable mid-stream, and Enter HANDS THE FOLLOW-UP ON rather than dropping it', () => {
    /*
     * The composer is never disabled while a run is in flight — the user must
     * be able to draft the follow-up.
     *
     * THIS ROW USED TO ASSERT THAT ENTER REACHED NOTHING, and its comment said
     * why: "Enter cannot queue a second ask against a stream that has not
     * landed, so it does nothing". That was a description of a missing
     * capability, not a ruling that the capability was wrong — and the
     * consequence was that a question typed mid-stream vanished in silence.
     *
     * THE INVARIANT IT PROTECTED STILL HOLDS AND IS ASSERTED BELOW: Enter
     * starts no second TURN. The composer now hands the words to its caller,
     * which holds them until the current turn settles; the button still says
     * stop, and nothing is sent.
     */
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(
      <Composer
        {...composerHandlers({ onSend, onStop })}
        composer={composerSlice({ draft: 'and then?', send: 'running' })}
      />,
    );

    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    expect(field.disabled).toBe(false);

    fireEvent.keyDown(field, { key: 'Enter' });
    /* Handed on, not dropped. What the caller does with it — send now, or
       queue — is the caller's decision and is tested in the store. */
    expect(onSend).toHaveBeenCalledTimes(1);
    /* And it did NOT stop the running turn, which is the other thing Enter
       must never do while the button says stop. */
    expect(onStop).not.toHaveBeenCalled();

    /* The button is Stop while running, and clicking it stops — unchanged. */
    fireEvent.click(screen.getByTestId('composer-send'));
    expect(onStop).toHaveBeenCalledTimes(1);
    /* Still exactly the one call Enter made. Clicking Stop must not also
       send. */
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe('item 2.7 — the send button is round', () => {
  it('is a 28px circle, not a square with soft corners', () => {
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: 'x' })} />);

    const send = screen.getByTestId('composer-send');
    expect(resolvedStyle(send, 'width')).toBe('28px');
    expect(resolvedStyle(send, 'height')).toBe('28px');

    /*
     * GRAPHITE-DECISIONS.md records the rendering rule the hard way: CSS scales
     * every corner radius by min(side / sum of radii on that side), so a radius
     * only paints as a circle when it is at least half the side. Asserting the
     * token alone would pass for --r-14 on a 28px box, which paints as a
     * rounded square. Both halves are asserted.
     */
    expect(resolvedStyle(send, 'border-radius')).toBe(token('--r-full'));
    expect(parseFloat(resolvedStyle(send, 'border-radius'))).toBeGreaterThanOrEqual(14);

    // The one saturated object on the surface.
    expect(resolvedStyle(send, 'background-color')).toBe(token('--accent-solid'));
  });

  it('becomes stop while a run is in flight, on the same circle', () => {
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: 'x', send: 'running' })} />);

    const send = screen.getByTestId('composer-send');
    expect(send.getAttribute('aria-label')).toBe('Stop');
    expect(resolvedStyle(send, 'border-radius')).toBe(token('--r-full'));
  });

  it('draws disabled as a different object, never as a dimmed accent', () => {
    /*
     * Sheet 12.4: "--surface-3 with an --ink-4 glyph. Never a dimmed accent — a
     * translucent brand colour reads as 'this is nearly available', and an
     * empty composer is not nearly anything." v1 uses opacity: 0.45.
     */
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: '' })} />);

    const send = screen.getByTestId('composer-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(resolvedStyle(send, 'background-color')).toBe(token('--surface-3'));
    expect(resolvedStyle(send, 'color')).toBe(token('--ink-4'));
    // Not a faded accent: nothing on this button is translucent.
    expect(['', '1']).toContain(resolvedStyle(send, 'opacity'));
  });
});

describe('item 2.7 — the control ladder and the placeholder', () => {
  it('keeps every control on Graphite law 3, and none of them is airy', () => {
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: 'x' })} />);

    expect(resolvedStyle(screen.getByTestId('composer-plus'), 'height')).toBe('24px');
    expect(resolvedStyle(screen.getByTestId('composer-terminal'), 'height')).toBe(token('--icon-btn'));
    expect(resolvedStyle(screen.getByTestId('composer-terminal'), 'height')).toBe('26px');
    expect(resolvedStyle(screen.getByTestId('composer-model'), 'height')).toBe('24px');
    expect(resolvedStyle(screen.getByTestId('composer-model'), 'white-space')).toBe('nowrap');
    const modelLabel = screen.getByTestId('composer-model').querySelector('.mono') as HTMLElement;
    expect(resolvedStyle(modelLabel, 'text-overflow')).toBe('ellipsis');
  });

  it('names @ in the placeholder, in the one line everybody reads', () => {
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: '' })} />);

    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    expect(field.placeholder).toContain('@');
    expect(field.placeholder).toContain('Ask about this repo');
  });

  it('rings the container, not the field inset inside it', () => {
    /*
     * MLH/frontend/src/styles/shell.css:1092-1103 — a ring on a box inset 10px
     * inside another rounded rectangle "read as a rendering defect rather than
     * as focus". v1 removes the textarea outline and rings only the buttons, so
     * keyboard focus on the input is invisible.
     */
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: '' })} />);

    const field = screen.getByTestId('composer-field');
    expect(resolvedStyle(field, 'outline-style')).toBe('none');

    fireEvent.focus(field);
    expect(screen.getByTestId('composer').className).toContain('focused');
  });
});

describe('item 2.7 — context chips and the ONE keeper list', () => {
  it('renders a chip per attachment, each with a remove that names it', () => {
    const onRemoveChip = vi.fn();
    render(
      <Composer
        {...composerHandlers({ onRemoveChip })}
        composer={composerSlice({
          draft: 'x',
          chips: [
            { id: 'c1', kind: 'node', ref: 'svc:auth', label: 'auth', nodeKind: 'service' },
            { id: 'c2', kind: 'file', ref: 'src/mw.ts', label: 'mw.ts', nodeKind: null },
          ],
        })}
      />,
    );

    expect(screen.getAllByTestId('composer-chip').length).toBe(2);

    fireEvent.click(screen.getAllByTestId('composer-chip-remove')[1]);
    expect(onRemoveChip).toHaveBeenCalledWith('c2');
  });

  it('labels grounded node chips as ask context, not a tool call', () => {
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({
          draft: 'x',
          chips: [{ id: 'c1', kind: 'node', ref: 'svc:auth', label: 'auth', nodeKind: 'service' }],
        })}
      />,
    );
    const chip = screen.getByTestId('composer-chip');
    expect(chip.querySelector('.chip-ctx')?.textContent).toBe('context');
    expect(chip.getAttribute('title')).toMatch(/Grounded ask context \(not a tool call\)/);
    expect(chip.getAttribute('title')).toMatch(/node:svc:auth/);
  });

  it('opens exactly one toolbelt, with the sheet 12.4 items', () => {
    // v1 shipped three competing lists. One control, one menu.
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: '', toolbeltOpen: true })} />);

    const menus = screen.getAllByTestId('composer-toolbelt');
    expect(menus.length).toBe(1);

    const items = screen.getAllByTestId('toolbelt-item').map((el) => el.textContent);
    expect(items.length).toBe(4);
    expect(items[0]).toContain('Break it down');
    expect(items[3]).toContain('Reasoning');
  });

  it('closes the toolbelt when the pointer lands outside', () => {
    const onCloseToolbelt = vi.fn();
    render(
      <Composer
        {...composerHandlers({ onCloseToolbelt })}
        composer={composerSlice({ draft: '', toolbeltOpen: true })}
      />,
    );
    expect(screen.getByTestId('composer-toolbelt')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(onCloseToolbelt).toHaveBeenCalled();
  });
});

describe('item 2.7 — a failed ask is a strip, never a message in the thread', () => {
  it('renders above the composer with Retry and Dismiss, and leaves the field usable', () => {
    /*
     * Graphite page 20.4 makes this a law and the adoption study records v1
     * violating it twice: ProductChat.tsx:646-651 turns a failed ask into an
     * ASSISTANT MESSAGE — an error permanently in the artifact you hand to
     * someone else. MLH ships the strip but wires no Retry; §3.6 says build
     * both from the start.
     */
    const onRetry = vi.fn();
    const onDismissFailure = vi.fn();
    render(
      <Composer
        {...composerHandlers({ onRetry, onDismissFailure })}
        composer={composerSlice({ draft: 'what breaks' })}
        failure={{ message: 'The provider did not answer.', retryable: true }}
      />,
    );

    const strip = screen.getByTestId('composer-strip');
    expect(strip.textContent).toContain('The provider did not answer.');
    expect((screen.getByTestId('composer-field') as HTMLTextAreaElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId('composer-strip-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('composer-strip-dismiss'));
    expect(onDismissFailure).toHaveBeenCalledTimes(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE HELD FOLLOW-UP, SHOWN.

   A question typed mid-stream used to vanish in silence. It is now held — and
   held VISIBLY, because a question that fires itself two minutes after it was
   typed, with no sign it was pending, is worse than one that was dropped.
   ══════════════════════════════════════════════════════════════════════════ */
describe('a queued follow-up', () => {
  it('says what is waiting, and quotes it', () => {
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '', send: 'running' })}
        queued="and the callers?"
      />,
    );
    const strip = screen.getByTestId('composer-queued');
    expect(strip.textContent).toMatch(/and the callers\?/);
    /* Says WHEN, so the reader is not left wondering whether it is stuck. */
    expect(strip.textContent).toMatch(/when this finishes/i);
  });

  it('CAN BE TAKEN BACK', () => {
    const onUnqueue = vi.fn();
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '', send: 'running' })}
        queued="never mind"
        onUnqueue={onUnqueue}
      />,
    );
    fireEvent.click(screen.getByTestId('composer-unqueue'));
    expect(onUnqueue).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when nothing is queued', () => {
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: 'x' })} />);
    expect(screen.queryByTestId('composer-queued')).toBeNull();
  });
});

/**
 * ATTACHMENTS — what the user brings that is not in the repository.
 *
 * The `@` picker resolves against the scan and offers no free-text fallback by
 * design, so before this a stack trace or a log had no way in at all.
 */
describe('pasting something that is a document, not a phrase', () => {
  function pasteInto(field: HTMLElement, text: string): boolean {
    /* jsdom has no clipboard on the synthetic event, so the payload is
       supplied directly — what is under test is the DECISION and the
       preventDefault, not the browser's clipboard plumbing. */
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: () => text },
    });
    fireEvent(field, event);
    return event.defaultPrevented;
  }

  it('leaves an ordinary paste completely alone', () => {
    /* Almost every paste is a path or a phrase. A chip appearing for those is
       the tool getting in the way, and preventDefault would additionally stop
       the text arriving at all. */
    const onAttach = vi.fn();
    render(<Composer {...composerHandlers({})} onAttach={onAttach} composer={composerSlice({})} />);
    const prevented = pasteInto(screen.getByTestId('composer-field'), 'packages/web2/src/chat/Composer.tsx');
    expect(onAttach).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });

  it('turns a long paste into an attachment, named from its own first line', () => {
    const onAttach = vi.fn();
    render(<Composer {...composerHandlers({})} onAttach={onAttach} composer={composerSlice({})} />);
    const log = ['Traceback (most recent call last):', ...Array.from({ length: 40 }, (_, i) => `  at frame ${i}`)].join(
      '\n',
    );
    const prevented = pasteInto(screen.getByTestId('composer-field'), log);
    expect(onAttach).toHaveBeenCalledWith('Traceback (most recent call last):', log);
    /* Prevented, or the log lands in the field as well as in the chip. */
    expect(prevented).toBe(true);
  });

  it('does NOT swallow the clipboard when the host wired no handler', () => {
    /* A host that has not adopted attachments must keep the paste it always
       had; losing the user's clipboard would be a strictly worse product than
       before this feature existed. */
    render(<Composer {...composerHandlers({})} composer={composerSlice({})} />);
    const long = Array.from({ length: 60 }, () => 'a line of a log').join('\n');
    expect(pasteInto(screen.getByTestId('composer-field'), long)).toBe(false);
  });
});

describe('the attachment row', () => {
  const one = [{ id: 'a1', name: 'crash.log', bytes: 80 }];

  it('is not drawn when nothing is attached', () => {
    render(<Composer {...composerHandlers({})} composer={composerSlice({})} />);
    expect(screen.queryByTestId('composer-attachments')).toBeNull();
  });

  it('shows the name and size, and can remove one', () => {
    const onRemoveAttachment = vi.fn();
    render(
      <Composer
        {...composerHandlers({})}
        composer={composerSlice({})}
        attachments={one}
        onRemoveAttachment={onRemoveAttachment}
      />,
    );
    expect(screen.getByTestId('composer-attachment').textContent).toContain('crash.log');
    expect(screen.getByTestId('composer-attachment').textContent).toContain('80 B');
    fireEvent.click(screen.getByTestId('composer-attachment-remove'));
    expect(onRemoveAttachment).toHaveBeenCalledWith('a1');
  });

  it('SAYS ON THE CHIP when the content was cut short', () => {
    render(
      <Composer
        {...composerHandlers({})}
        composer={composerSlice({})}
        attachments={[{ id: 'a1', name: 'huge.log', bytes: 128000, truncated: true }]}
      />,
    );
    expect(screen.getByTestId('composer-attachment').textContent).toContain('cut short');
  });

  it('is a SEPARATE row from the grounded chips', () => {
    /* The whole ruling this feature had to respect: a chip is a claim about
       the repository, an attachment is evidence the user supplied, and one row
       holding both would let a pasted log borrow the scan's authority. */
    render(
      <Composer
        {...composerHandlers({})}
        composer={composerSlice({
          chips: [{ id: 'c1', kind: 'file', ref: 'src/a.ts', label: 'a.ts', nodeKind: null }],
        })}
        attachments={one}
      />,
    );
    const chips = screen.getByTestId('composer-chips');
    const attachments = screen.getByTestId('composer-attachments');
    expect(chips).not.toBe(attachments);
    expect(chips.contains(attachments)).toBe(false);
    expect(attachments.contains(chips)).toBe(false);
  });
});

/**
 * A FAILURE THAT NAMES A FIX MUST OFFER IT.
 *
 * With no model configured a turn ends "the free assistant is not live yet —
 * add your own API key in Settings to chat", on a strip whose only controls
 * were Retry (which fails identically) and Dismiss (which hides it). The
 * product told the reader exactly what to do and gave them no way to do it —
 * the same dead end the owner walk opened on.
 */
describe('the way out of a configuration failure', () => {
  const CONFIG_FAILURE = {
    message: 'the free assistant is not live yet — add your own API key in Settings to chat',
    retryable: true,
    fix: 'provider' as const,
  };

  it('offers Open Settings', () => {
    const onOpenSettings = vi.fn();
    render(
      <Composer
        {...composerHandlers({})}
        composer={composerSlice({})}
        failure={CONFIG_FAILURE}
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(screen.getByTestId('composer-strip-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('still shows the SERVER’S OWN sentence, unrewritten', () => {
    render(
      <Composer
        {...composerHandlers({})}
        composer={composerSlice({})}
        failure={CONFIG_FAILURE}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByTestId('composer-strip').textContent).toContain('add your own API key');
  });

  it('does NOT offer it for a failure with no route out', () => {
    /* An outage is not fixed by opening Settings. Offering that route sends
       the reader somewhere useless and teaches them the control is noise. */
    render(
      <Composer
        {...composerHandlers({})}
        composer={composerSlice({})}
        failure={{ message: 'the engine did not answer', retryable: true }}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('composer-strip-settings')).toBeNull();
    /* Retry is still there — that IS the right move for an outage. */
    expect(screen.getByTestId('composer-strip-retry')).toBeTruthy();
  });

  it('renders on the FIX, never on the wording', () => {
    /* A surface that matched the sentence would break the moment the sentence
       improved. Same message, no `fix` — no button. */
    render(
      <Composer
        {...composerHandlers({})}
        composer={composerSlice({})}
        failure={{ message: CONFIG_FAILURE.message, retryable: true }}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('composer-strip-settings')).toBeNull();
  });

  it('draws no dead control when the host wired no handler', () => {
    render(
      <Composer {...composerHandlers({})} composer={composerSlice({})} failure={CONFIG_FAILURE} />,
    );
    expect(screen.queryByTestId('composer-strip-settings')).toBeNull();
  });
});

describe('Decision 4 — / opens the skills menu', () => {
  it('opens on a leading slash and lists commands', () => {
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: '/' })} />);
    const rows = screen.getAllByTestId('composer-slash-item');
    expect(rows.length).toBeGreaterThan(0);
    /* Derived from the keeper lists, so a mode and a toolbelt item are both here. */
    const names = rows.map((r) => r.getAttribute('data-command'));
    expect(names).toContain('plan');
    expect(names).toContain('breakdown');
  });

  it('DOES NOT OPEN ON A PATH', () => {
    /*
     * The reason the query is anchored to the start of the line. This product's
     * questions are full of paths, and a menu that opened on every one of them
     * would fight the reader continuously.
     */
    render(
      <Composer {...composerHandlers()} composer={composerSlice({ draft: 'what is in packages/web2/src' })} />,
    );
    expect(screen.queryByTestId('composer-slash')).toBeNull();
  });

  it('filters as the reader types', () => {
    render(<Composer {...composerHandlers()} composer={composerSlice({ draft: '/pl' })} />);
    const names = screen.getAllByTestId('composer-slash-item').map((r) => r.getAttribute('data-command'));
    expect(names[0]).toBe('plan');
  });

  it('ENTER RUNS THE COMMAND INSTEAD OF SENDING IT AS PROSE', () => {
    /*
     * The whole point. Without this the product advertises `/` in its most-read
     * line and then posts "/plan" to the model as a question.
     */
    const onSend = vi.fn();
    const onPermissionChange = vi.fn();
    const onDraftChange = vi.fn();
    render(
      <Composer
        {...composerHandlers({ onSend, onPermissionChange, onDraftChange })}
        composer={composerSlice({ draft: '/plan' })}
      />,
    );

    const handled = fireEvent.keyDown(screen.getByTestId('composer-field'), { key: 'Enter' });

    expect(onPermissionChange).toHaveBeenCalledWith('plan');
    expect(onSend).not.toHaveBeenCalled();
    expect(onDraftChange).toHaveBeenCalledWith('');
    expect(handled).toBe(false);
  });

  it('a toolbelt command reaches the SAME handler the + menu calls', () => {
    /* Not a parallel implementation: one registry, one handler, two ways in. */
    const onToolbeltPick = vi.fn();
    render(
      <Composer
        {...composerHandlers({ onToolbeltPick })}
        composer={composerSlice({ draft: '/breakdown' })}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('composer-field'), { key: 'Enter' });
    expect(onToolbeltPick).toHaveBeenCalledWith('break-down');
  });

  it('Escape closes it without sending', () => {
    const onSend = vi.fn();
    const onDraftChange = vi.fn();
    render(
      <Composer {...composerHandlers({ onSend, onDraftChange })} composer={composerSlice({ draft: '/pl' })} />,
    );
    fireEvent.keyDown(screen.getByTestId('composer-field'), { key: 'Escape' });
    expect(onDraftChange).toHaveBeenCalledWith('');
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('teach mode lives in the mode menu (owner, 2026-09-02)', () => {
  /*
   * "The teach mode should be part of the same thing as a proposed plan …
   * teaching and teach are a little bit confusing modes, and we tell the user
   * too much about which is which." There is no second chip any more: Teach is
   * a row of the one mode control, and the trigger says one word.
   */
  it('renders no separate teach chip; Teach is a row of the mode menu that turns it on', () => {
    const onTeachToggle = vi.fn();
    render(
      <Composer
        composer={composerSlice({ teach: false })}
        {...composerHandlers({ onTeachToggle })}
      />,
    );
    expect(screen.queryByTestId('teach-toggle')).toBeNull();
    fireEvent.click(screen.getByTestId('permission-control'));
    const teachRow = screen
      .getAllByTestId('permission-option')
      .find((row) => row.getAttribute('data-mode') === 'teach');
    expect(teachRow, 'the Teach row is in the same menu as the permission modes').toBeTruthy();
    expect(teachRow!.textContent).toContain('Teach');
    expect(teachRow!.textContent).not.toContain('Teaching');
    fireEvent.click(teachRow!);
    expect(onTeachToggle).toHaveBeenCalledWith(true);
  });

  it('when on, the trigger says "Teach" — one word, never "Teaching"', () => {
    render(
      <Composer
        composer={composerSlice({ teach: true })}
        {...composerHandlers({ onTeachToggle: vi.fn() })}
      />,
    );
    const trigger = screen.getByTestId('permission-control');
    expect(trigger.textContent).toContain('Teach');
    expect(trigger.textContent).not.toContain('Teaching');
    expect(screen.queryByText(/Teach mode is ON/)).toBeNull();
  });

  it('picking a permission row while teaching leaves Teach', () => {
    const onTeachToggle = vi.fn();
    const onPermissionChange = vi.fn();
    render(
      <Composer
        composer={composerSlice({ teach: true })}
        {...composerHandlers({ onTeachToggle, onPermissionChange })}
      />,
    );
    fireEvent.click(screen.getByTestId('permission-control'));
    const propose = screen
      .getAllByTestId('permission-option')
      .find((row) => row.textContent?.includes('Propose'));
    fireEvent.click(propose!);
    expect(onTeachToggle).toHaveBeenCalledWith(false);
    expect(onPermissionChange).toHaveBeenCalledWith('propose');
  });
});
