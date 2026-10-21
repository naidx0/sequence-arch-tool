import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComponentsPicker } from './ComponentsPicker';
import type { ComponentsListing } from './componentsClient';

/*
 * The picker opens upward from the composer, so its bottom edge is fixed and its height is the room above.
 * It must size itself to that room (not to the window), and a long blurb is clamped to two lines.
 */

const LISTING: ComponentsListing = {
  enabled: true,
  mode: 'auto',
  groups: [{ id: 'g', name: 'Design elements', blurb: '', components: [{ id: 'g/a', name: 'Better Accessibility', blurb: 'x '.repeat(200), installed: true, inWorkspace: true }] }],
};
const css = (name: string) => readFileSync(resolve(__dirname, '../shell2', name), 'utf8').replace(/\r\n/g, '\n');

afterEach(() => vi.restoreAllMocks());

describe('the Components picker fits the room above the composer', () => {
  it('sets --s2-menu-max from the measured bottom edge, leaving room for the top bar', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ bottom: 738, top: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    render(<ComponentsPicker listing={LISTING} onPick={() => {}} onClose={() => {}} />);
    const menu = screen.getByTestId('components-picker');
    const max = parseInt(menu.style.getPropertyValue('--s2-menu-max'), 10);
    expect(max).toBeGreaterThan(0);
    expect(738 - max).toBeGreaterThanOrEqual(44);
    expect(738 - max).toBeLessThanOrEqual(80);
  });

  it('clamps each blurb to two lines and carries the full text as a title', () => {
    render(<ComponentsPicker listing={LISTING} onPick={() => {}} onClose={() => {}} />);
    const blurb = screen.getByTestId('components-item').querySelector('.s2-mi-blurb');
    expect(blurb).toBeTruthy();
    expect(blurb!.getAttribute('title')).toBe(LISTING.groups[0]!.components[0]!.blurb);
    const rule = css('modelMenu.css').match(/\.s2-mi-blurb\s*\{([^}]*)\}/);
    expect(rule, 'a .s2-mi-blurb rule').toBeTruthy();
    expect(rule![1]).toMatch(/-webkit-line-clamp:\s*2/);
    expect(rule![1]).toMatch(/overflow:\s*hidden/);
  });
});
