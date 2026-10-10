import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { V3App } from './V3App';

/* Round 13 re-review: the slash menu's outside-press dismissal belongs to one draft; any change to the draft clears it. */
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});

const type = (field: HTMLElement, text: string) => act(() => void fireEvent.change(field, { target: { value: text } }));
const menuOpen = () => screen.queryByTestId('v3-slash') !== null;

describe('slash menu dismissal', () => {
  it('retyping the dismissed text reopens the menu; /pl then Backspace to /p reopens it', () => {
    render(<V3App appStore={createStore({})} />);
    const field = screen.getByTestId('composer-field');
    type(field, '/p');
    const opened = menuOpen();
    expect(opened).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(menuOpen()).toBe(false);
    type(field, '');
    type(field, '/p');
    expect(menuOpen()).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(menuOpen()).toBe(false);
    type(field, '/pl');
    type(field, '/p');
    expect(menuOpen()).toBe(true);
  });
});
