import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import { AskPopover } from './AskPopover';
import { buildReference } from './askReference';

const REF = buildReference('whiteboard', [
  { id: 'r1', kind: 'rect', label: 'Model' },
  { id: 'r2', kind: 'rect', label: 'Tool call' },
  { id: 'a2', kind: 'arrow', label: 'loop' },
])!;

function open(extra: Partial<Parameters<typeof AskPopover>[0]> = {}) {
  const onSend = vi.fn();
  const onClose = vi.fn();
  render(
    <AskPopover
      reference={REF}
      target={{ left: 100, top: 100, width: 80, height: 40 }}
      bounds={{ width: 1000, height: 600 }}
      onSend={onSend}
      onClose={onClose}
      {...extra}
    />,
  );
  return { onSend, onClose, input: screen.getByTestId('ask-pop-input') as HTMLTextAreaElement };
}

describe('the ask popover', () => {
  it('shows what is referenced as one chip', () => {
    open();
    expect(screen.getByTestId('ask-pop-chip').textContent).toBe('3 items: Model, Tool call, loop');
  });

  it('opens on its field', () => {
    const { input } = open();
    expect(document.activeElement).toBe(input);
  });

  it('Enter sends the words, trimmed', () => {
    const { input, onSend } = open();
    fireEvent.change(input, { target: { value: '  fix the arrow into Tool call  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('fix the arrow into Tool call');
  });

  it('Shift+Enter adds a line and sends nothing', () => {
    const { input, onSend } = open();
    fireEvent.change(input, { target: { value: 'one' } });
    const notPrevented = fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    // the browser's own newline is left to happen
    expect(notPrevented).toBe(true);
  });

  it('Enter with nothing typed sends nothing, and Send is disabled', () => {
    const { input, onSend } = open();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByTestId('ask-pop-send') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not send while an IME composition is open', () => {
    const { input, onSend } = open();
    fireEvent.change(input, { target: { value: 'nihao' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('nihao');
  });

  it('the Send button sends', () => {
    const { input, onSend } = open();
    fireEvent.change(input, { target: { value: 'why a loop?' } });
    fireEvent.click(screen.getByTestId('ask-pop-send'));
    expect(onSend).toHaveBeenCalledWith('why a loop?');
  });

  it('Escape closes, and is not also the board\'s Escape', () => {
    const { input, onClose } = open();
    const seenByBoard = vi.fn();
    window.addEventListener('keydown', seenByBoard);
    fireEvent.keyDown(input, { key: 'Escape' });
    window.removeEventListener('keydown', seenByBoard);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(seenByBoard).not.toHaveBeenCalled();
  });

  it('the close button closes', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByTestId('ask-pop-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('gives focus back where it was when it goes', () => {
    const before = document.createElement('button');
    document.body.append(before);
    const { unmount } = render(
      <AskPopover
        reference={REF}
        target={{ left: 0, top: 0, width: 10, height: 10 }}
        bounds={{ width: 500, height: 500 }}
        returnFocus={before}
        onSend={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(document.activeElement).toBe(screen.getAllByTestId('ask-pop-input').at(-1));
    unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('is placed beside the target, inside the board', () => {
    open();
    const pop = screen.getByTestId('ask-pop');
    expect(pop.getAttribute('data-side')).toBe('right');
    expect(pop.style.left).toBe('192px');
  });

  it('is minimal: a text box, Send and the X, and no instruction text', () => {
    open();
    const pop = screen.getByTestId('ask-pop');
    expect([...pop.querySelectorAll('button, textarea, input')].map((e) => e.getAttribute('data-testid'))).toEqual([
      'ask-pop-input',
      'ask-pop-close',
      'ask-pop-send',
    ]);
    expect(pop.textContent).toBe('3 items: Model, Tool call, loop');
    expect(pop.textContent).not.toMatch(/enter|shift/i);
    // the chip sits inside the text box
    expect(screen.getByTestId('ask-pop-chip').closest('.ask-pop-field')).toBe(screen.getByTestId('ask-pop-input').closest('.ask-pop-field'));
  });

  it('is a SOLID panel, not glass', () => {
    const css = readFileSync(path.resolve(__dirname, 'askInPlace.css'), 'utf8');
    const rule = (sel: string) => css.slice(css.lastIndexOf(`${sel} {`), css.indexOf("}", css.lastIndexOf(`${sel} {`)));
    for (const sel of ['.ask-pop', '.ask-menu', '.ask-aff']) {
      expect(rule(sel), sel).toMatch(/background:\s*var\(--bg-base\)/);
      expect(rule(sel), sel).not.toMatch(/color-mix|transparent|backdrop|rgba/);
    }
  });

  it('is sized by the board, not the window', () => {
    const css = readFileSync(path.resolve(__dirname, 'askInPlace.css'), 'utf8');
    expect(css).toMatch(/\.ask-pop\s*\{[^}]*width:\s*min\(340px,\s*calc\(100cqw - 2 \* var\(--sp-12\)\)\)/s);
    // the same radius and lift as the whiteboard's Ask panel
    expect(css).toMatch(/\.ask-pop\s*\{[^}]*border-radius:\s*var\(--r-14\)/s);
    expect(css).toMatch(/\.ask-pop\s*\{[^}]*box-shadow:\s*var\(--e3\)/s);
    expect(css).toMatch(/\.ask-btn-solid\s*\{[^}]*background:\s*var\(--accent-solid\)/s);
  });

  it('shows a clear focus indicator on the words box: accent border and a soft glow, none on the bare textarea', () => {
    const css = readFileSync(path.resolve(__dirname, 'askInPlace.css'), 'utf8');
    const at = css.indexOf('.ask-pop-field:focus-within {');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toMatch(/border-color:\s*var\(--accent\)/);
    expect(rule).toMatch(/box-shadow:\s*0 0 0 3px color-mix\(in srgb, var\(--accent\) 22%, transparent\)/);
    expect(css.slice(css.indexOf('.ask-pop-input {'), css.indexOf('}', css.indexOf('.ask-pop-input {')))).toMatch(/outline:\s*none/);
    // the field really is the focused element's wrapper
    open();
    expect(document.activeElement!.closest('.ask-pop-field')).not.toBeNull();
  });
});
