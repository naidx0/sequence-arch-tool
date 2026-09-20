import { afterEach, describe, expect, it } from 'vitest';

import { focusFirst, tabbable, trapFocus, wrapTab } from './focusTrap';

/**
 * MODALITY, ACTUALLY DELIVERED.
 *
 * Four of five overlays declare `role="dialog"` and none manages focus. That
 * role is a PROMISE — it tells a screen reader, and a keyboard user, that what
 * is behind the scrim is unreachable. It was not: Tab from Settings walked
 * straight out into the board.
 */

let host: HTMLElement;

function mount(html: string): HTMLElement {
  host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  host?.remove();
});

const DIALOG = `
  <button id="outside">behind the scrim</button>
  <div id="dlg" role="dialog" tabindex="-1">
    <button id="a">one</button>
    <input id="b" />
    <button id="c">three</button>
  </div>
`;

function tab(shift = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
}

describe('what counts as tabbable', () => {
  it('finds buttons, inputs and links in document order', () => {
    const root = mount('<div id="d"><a href="#x">l</a><button>b</button><input /></div>');
    expect(tabbable(root.querySelector('#d')!).map((e) => e.tagName)).toEqual([
      'A',
      'BUTTON',
      'INPUT',
    ]);
  });

  it('EXCLUDES tabindex="-1" — focusable by script, not by Tab', () => {
    /* Putting one in the ring strands a reader on an element the key cannot
       leave. */
    const root = mount('<div id="d"><button tabindex="-1">no</button><button>yes</button></div>');
    const ring = tabbable(root.querySelector('#d')!);
    expect(ring).toHaveLength(1);
    expect(ring[0]!.textContent).toBe('yes');
  });

  it('excludes disabled controls', () => {
    const root = mount('<div id="d"><button disabled>no</button><button>yes</button></div>');
    expect(tabbable(root.querySelector('#d')!)).toHaveLength(1);
  });

  it('excludes anything aria-hidden or inert', () => {
    /* Trapping focus onto something that cannot receive it is the same bug in
       a different place. */
    const root = mount(
      '<div id="d"><button aria-hidden="true">no</button><button inert>no</button><button>yes</button></div>',
    );
    expect(tabbable(root.querySelector('#d')!)).toHaveLength(1);
  });
});

describe('containment', () => {
  it('TAB FROM THE LAST CONTROL RETURNS TO THE FIRST', () => {
    const root = mount(DIALOG);
    const dlg = root.querySelector<HTMLElement>('#dlg')!;
    root.querySelector<HTMLElement>('#c')!.focus();

    expect(wrapTab(dlg, tab())).toBe(true);
    expect(document.activeElement?.id).toBe('a');
  });

  it('SHIFT+TAB FROM THE FIRST REACHES THE LAST', () => {
    const root = mount(DIALOG);
    const dlg = root.querySelector<HTMLElement>('#dlg')!;
    root.querySelector<HTMLElement>('#a')!.focus();

    expect(wrapTab(dlg, tab(true))).toBe(true);
    expect(document.activeElement?.id).toBe('c');
  });

  it('leaves the middle of the ring to the browser', () => {
    /* The platform already does the right thing between the ends; intercepting
       every Tab would reimplement focus order badly. */
    const root = mount(DIALOG);
    const dlg = root.querySelector<HTMLElement>('#dlg')!;
    root.querySelector<HTMLElement>('#b')!.focus();
    expect(wrapTab(dlg, tab())).toBe(false);
  });

  it('PULLS FOCUS BACK IN when it is outside the dialog', () => {
    /* Which is what has happened if focus escaped before the trap installed —
       the case that makes the whole thing worth having. */
    const root = mount(DIALOG);
    const dlg = root.querySelector<HTMLElement>('#dlg')!;
    root.querySelector<HTMLElement>('#outside')!.focus();

    expect(wrapTab(dlg, tab())).toBe(true);
    expect(dlg.contains(document.activeElement)).toBe(true);
  });

  it('a dialog with nothing focusable does NOT swallow the key', () => {
    /*
     * Swallowing Tab there would strand the reader with no way out but the
     * mouse. Doing nothing is the honest answer.
     */
    const root = mount('<div id="dlg" role="dialog"><p>nothing here</p></div>');
    expect(wrapTab(root.querySelector('#dlg')!, tab())).toBe(false);
  });
});

describe('initial focus and restore', () => {
  it('moves focus to the first control on open', () => {
    const root = mount(DIALOG);
    focusFirst(root.querySelector<HTMLElement>('#dlg')!);
    expect(document.activeElement?.id).toBe('a');
  });

  it('falls back to the dialog itself when it holds no controls', () => {
    /* A dialog with nothing to focus still has to take focus, or the reader
       stays behind the scrim. */
    const root = mount('<div id="dlg" role="dialog" tabindex="-1"><p>words</p></div>');
    focusFirst(root.querySelector<HTMLElement>('#dlg')!);
    expect(document.activeElement?.id).toBe('dlg');
  });

  it('RESTORES FOCUS TO THE OPENER on teardown', () => {
    /*
     * Without this, a reader who opens and closes Settings from the app bar is
     * dumped at the top of the document and has to walk all the way back.
     */
    const root = mount(DIALOG);
    const opener = root.querySelector<HTMLElement>('#outside')!;
    opener.focus();

    const release = trapFocus(root.querySelector<HTMLElement>('#dlg')!);
    expect(document.activeElement?.id).toBe('a');

    release();
    expect(document.activeElement?.id).toBe('outside');
  });

  it('does not throw when the opener has left the document', () => {
    /* A dialog opened from a row that the same action removed. Focusing a
       detached node does nothing useful and throws in some browsers. */
    const root = mount(DIALOG);
    const opener = root.querySelector<HTMLElement>('#outside')!;
    opener.focus();
    const release = trapFocus(root.querySelector<HTMLElement>('#dlg')!);
    opener.remove();
    expect(() => release()).not.toThrow();
  });

  it('stops intercepting Tab after teardown', () => {
    const root = mount(DIALOG);
    const release = trapFocus(root.querySelector<HTMLElement>('#dlg')!);
    release();

    root.querySelector<HTMLElement>('#outside')!.focus();
    document.dispatchEvent(tab());
    /* The listener is gone, so focus stays where the platform put it. */
    expect(document.activeElement?.id).toBe('outside');
  });
});
