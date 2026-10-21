import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FILES } from './anchors';
import { elideName, splitName } from './FileTree';
import { FilesPanel } from './FilesPanel';
import type { FilesPanelProps } from './FilesPanel';

/*
 * ROUND 7 (coordinator, from the checkpoint shots: "docker-comp",
 * "ground-trut", "status.html" touching the edge): the tree keeps ~30 % of
 * the card with a file open, a name gives way in the middle keeping its end,
 * the full path is the title, and a width the reader drags is remembered.
 * Layout itself is measured in the built app (scratchpad r7-shell-shots).
 */

beforeEach(() => localStorage.clear());

function mount(extra: Partial<FilesPanelProps> = {}) {
  const props: FilesPanelProps = {
    paths: ['docker-compose.yml', 'ground-truth.json', 'status.html'],
    selected: 'status.html',
    expanded: new Set<string>(),
    query: '',
    view: 'code',
    content: { state: 'ready', text: '<p>x</p>' },
    diff: { state: 'ready', text: '' },
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onQuery: vi.fn(),
    onView: vi.fn(),
    ...extra,
  };
  return render(<FilesPanel {...props} />);
}

describe('names give way in the middle', () => {
  it('splitName keeps the extension and three characters before it', () => {
    expect(splitName('docker-compose.yml')).toEqual({ head: 'docker-comp', tail: 'ose.yml' });
    expect(splitName('ground-truth.json')).toEqual({ head: 'ground-tr', tail: 'uth.json' });
    expect(splitName('Makefile')).toEqual({ head: 'Ma', tail: 'kefile' });
    expect(splitName('.env')).toEqual({ head: '', tail: '.env' });
    expect(splitName('a.ts')).toEqual({ head: '', tail: 'a.ts' });
  });

  it('a row reads the whole name, in two parts, with the full path as its title', () => {
    mount();
    const row = screen.getAllByTestId(FILES.row).find((r) => r.getAttribute('data-path') === 'docker-compose.yml')!;
    expect(row.querySelector('.files-name')?.textContent).toBe('docker-compose.yml');
    expect(row.querySelector('.files-name-end')?.textContent).toBe('ose.yml');
    expect(row.getAttribute('title')).toBe('docker-compose.yml');
  });
});

describe('a name is never cut from the front (owner, 2026-10-09: "dex.ts", "new.t")', () => {
  /* 7 px a character stands in for the row's font; the real width is measured in the browser. */
  const m = (s: string) => s.length * 7;
  const shown = (name: string, avail: number) => {
    const { head, tail } = elideName(name, avail, m);
    return head + tail;
  };

  it('shows the whole name when it fits', () => {
    expect(shown('index.ts', 60)).toBe('index.ts');
    expect(shown('new.ts', 60)).toBe('new.ts');
    expect(shown('app.ts', 42)).toBe('app.ts');
  });

  it('when it does not fit, keeps the start and the extension and drops the middle', () => {
    expect(shown('Dockerfile', 60)).toBe('Doc…file');
    expect(shown('untracked.ts', 60)).toBe('untr….ts');
    expect(shown('very-long-name.ts', 80)).toBe('very-lo….ts');
    /* At the 34 px the stale 150 px column left, it is a short start plus the extension, never "dex.ts". */
    expect(shown('index.ts', 34)).toBe('i….ts');
    expect(shown('merge.ts', 34)).toBe('m….ts');
    for (const name of ['index.ts', 'merge.ts', 'new.ts', 'untracked.ts', 'Dockerfile', 'docker-compose.yml']) {
      for (const avail of [20, 34, 48, 60, 90]) {
        const out = shown(name, avail);
        expect(out[0], `${name}@${avail}`).toBe(name[0]);
        if (out !== name) expect(out).toContain('…');
        if (name.includes('.') && out !== name) expect(out.endsWith(name.slice(name.lastIndexOf('.')))).toBe(true);
      }
    }
  });

  it('the fitted result is as wide as the room allows (the largest start that fits)', () => {
    const { head, tail } = elideName('untracked.ts', 60, m);
    expect(m(head + tail)).toBeLessThanOrEqual(60);
    expect(m(`${head}x${tail}`)).toBeGreaterThan(60);
  });
});

describe('the width the reader drags is remembered', () => {
  it('opening a file uses the ~30 % column until the reader drags; after a drag (and a reload) their width holds', () => {
    const first = mount();
    const panel = () => screen.getByTestId(FILES.panel);
    expect(panel().classList.contains('is-tree-rail')).toBe(true);
    fireEvent.pointerDown(screen.getByTestId(FILES.resizer), { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 200, pointerId: 1 });
    expect(panel().classList.contains('is-tree-wide')).toBe(true);
    expect(localStorage.getItem('files.treeDragged')).toBe('1');
    first.unmount();
    mount();
    expect(panel().classList.contains('is-tree-wide')).toBe(true);
    expect(panel().classList.contains('is-tree-rail')).toBe(false);
  });

  it('the seam stays lit while it is held, and says how to use it', () => {
    mount();
    const seam = screen.getByTestId(FILES.resizer);
    expect(seam.getAttribute('title')).toContain('double-click');
    fireEvent.pointerDown(seam, { clientX: 200, pointerId: 1 });
    expect(seam.classList.contains('is-dragging')).toBe(true);
    fireEvent.pointerUp(document, { clientX: 260, pointerId: 1 });
    expect(seam.classList.contains('is-dragging')).toBe(false);
  });

  it('the header toggle collapses the whole tree and brings it back', () => {
    mount();
    const panel = screen.getByTestId(FILES.panel);
    fireEvent.click(screen.getByTestId(FILES.treeToggle));
    expect(panel.classList.contains('is-tree-shut')).toBe(true);
    fireEvent.click(screen.getByTestId(FILES.treeToggle));
    expect(panel.classList.contains('is-tree-shut')).toBe(false);
  });

  it('the seam works from the keyboard: focusable, Left/Right resize, Enter hides and shows', () => {
    mount();
    const seam = screen.getByTestId(FILES.resizer);
    const panel = screen.getByTestId(FILES.panel);
    expect(seam.getAttribute('role')).toBe('separator');
    expect(seam.getAttribute('tabindex')).toBe('0');
    const before = Number(seam.getAttribute('aria-valuenow'));
    expect(before).toBeGreaterThan(0);
    fireEvent.keyDown(seam, { key: 'ArrowRight' });
    expect(Number(seam.getAttribute('aria-valuenow'))).toBe(before + 16);
    fireEvent.keyDown(seam, { key: 'ArrowLeft' });
    fireEvent.keyDown(seam, { key: 'ArrowLeft' });
    expect(Number(seam.getAttribute('aria-valuenow'))).toBe(before - 16);
    expect(panel.classList.contains('is-tree-wide')).toBe(true);
    fireEvent.keyDown(seam, { key: 'Enter' });
    expect(panel.classList.contains('is-tree-shut')).toBe(true);
    expect(seam.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.keyDown(seam, { key: 'Enter' });
    expect(panel.classList.contains('is-tree-shut')).toBe(false);
  });
});
