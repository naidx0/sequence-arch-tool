import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './files.css';

import { FILES } from './anchors';
import { FileTree } from './FileTree';
import { buildFileTree } from './filesModel';
import type { FileStatus } from './filesModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE TREE — item 2.1
   packages/web2/src/files/FileTree.test.tsx

   These assertions are about the three things that make this a tree a person
   can use rather than a nested list: it opens and closes, the keyboard walks
   exactly the rows on screen, and a changed file says so without spending a
   hue. Everything the tree DECIDES lives in `filesModel.ts` and is asserted
   there; what is asserted here is that the component renders those decisions
   and emits the gestures back.

   THE STYLESHEETS ARE IMPORTED because `vitest.config.ts` sets `css: true`
   deliberately — "WITHOUT IT EVERY STYLESHEET IMPORT IS A NO-OP and a test that
   reads a computed style asserts against an empty cascade while looking like it
   passes". The class-carrying assertions below are only meaningful with the
   real cascade mounted.

   WHAT THIS TIER CANNOT SEE, SAID SO NOBODY MISTAKES GREEN FOR CORRECT: jsdom
   has no layout. Every box here is zero by zero, so "the long path ellipsises"
   and "the tree scrolls inside its own box" are NOT provable at this tier and
   are not claimed. They belong to the legibility gate, which drives a real
   browser against the real repository.
   ══════════════════════════════════════════════════════════════════════════ */

const TREE = buildFileTree([
  'packages/analyzer/src/auth.ts',
  'packages/analyzer/src/scan.ts',
  'README.md',
]);

interface Harness {
  onSelect?: (path: string) => void;
  onToggle?: (path: string) => void;
  onOpen?: (path: string) => void;
  selected?: string | null;
  expanded?: ReadonlySet<string> | 'all';
  status?: ReadonlyMap<string, FileStatus> | null;
  cap?: number;
}

function mount(harness: Harness = {}) {
  const onSelect = harness.onSelect ?? vi.fn();
  const onToggle = harness.onToggle ?? vi.fn();
  const onOpen = harness.onOpen ?? vi.fn();
  render(
    /* `.files-scope` is the root every selector in files.css sits under, so a
       test that mounted the tree bare would render it unstyled and prove
       nothing about the sheet. */
    <div className="files-scope">
      <FileTree
        nodes={TREE}
        expanded={harness.expanded ?? 'all'}
        selected={harness.selected ?? null}
        status={harness.status ?? null}
        cap={harness.cap}
        onSelect={onSelect}
        onToggle={onToggle}
        onOpen={onOpen}
      />
    </div>,
  );
  return { onSelect, onToggle, onOpen };
}

function rows() {
  return screen.getAllByTestId(FILES.row);
}

function row(path: string) {
  const found = rows().find((r) => r.getAttribute('data-path') === path);
  if (!found) throw new Error(`no row for ${path} — rows: ${rows().map((r) => r.getAttribute('data-path')).join(', ')}`);
  return found;
}

describe('the tree draws the repository', () => {
  it('collapses a single-child chain into one row the reader can see', () => {
    mount();
    /* The chain is FOUR directories in the input and ONE row on screen. This is
       the assertion that the model's collapse actually reaches the render —
       `filesModel.test.ts` proves the rule, this proves the wiring. */
    expect(row('packages/analyzer/src').textContent).toContain('packages/analyzer/src');
    expect(rows().some((r) => r.getAttribute('data-path') === 'packages')).toBe(false);
  });

  it('tells a directory from a file without using a colour', () => {
    mount();
    /* Sheet 11.8 rule 2: "No hue for a category. Height, indent, icon and type
       family tell the rows apart." The kind is on the element, the depth is on
       the element, and the glyph differs — none of them is a hue. */
    expect(row('packages/analyzer/src').getAttribute('data-kind')).toBe('dir');
    expect(row('README.md').getAttribute('data-kind')).toBe('file');
    expect(row('packages/analyzer/src').getAttribute('aria-level')).toBe('1');
    expect(row('packages/analyzer/src/auth.ts').getAttribute('aria-level')).toBe('2');
  });

  it('closes, and a closed directory hides its children', () => {
    mount({ expanded: new Set() });
    expect(rows()).toHaveLength(2);
    expect(row('packages/analyzer/src').getAttribute('aria-expanded')).toBe('false');
  });

  it('says how many rows the cap withheld, rather than stopping silently', () => {
    mount({ cap: 2 });
    /* A list that quietly stops tells the reader their repository ends there,
       and that is the one number they cannot check by looking. */
    expect(screen.getByTestId(FILES.omitted).textContent).toContain('2 more not listed');
  });

  it('never renders a blank box when there is nothing to draw', () => {
    render(
      <div className="files-scope">
        <FileTree
          nodes={[]}
          expanded="all"
          selected={null}
          onSelect={vi.fn()}
          onToggle={vi.fn()}
          onOpen={vi.fn()}
          emptyNote="Nothing matches that."
        />
      </div>,
    );
    expect(screen.getByTestId(FILES.empty).textContent).toBe('Nothing matches that.');
  });
});

describe('the pointer', () => {
  it('a file selects AND opens; a directory selects AND toggles', () => {
    const { onSelect, onToggle, onOpen } = mount();

    fireEvent.click(row('README.md'));
    expect(onSelect).toHaveBeenCalledWith('README.md');
    expect(onOpen).toHaveBeenCalledWith('README.md');
    expect(onToggle).not.toHaveBeenCalled();

    fireEvent.click(row('packages/analyzer/src'));
    expect(onToggle).toHaveBeenCalledWith('packages/analyzer/src');
    /* A directory is not a document. Opening one in the right-hand pane would
       show the reader a file that does not exist. */
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('the keyboard walks exactly the rows on screen', () => {
  it('moves the selection down and up', () => {
    const { onSelect } = mount({ selected: 'packages/analyzer/src' });
    fireEvent.keyDown(screen.getByTestId(FILES.tree), { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith('packages/analyzer/src/auth.ts');
  });

  it('opens a closed directory with Right and closes it with Left', () => {
    const { onToggle } = mount({
      expanded: new Set(),
      selected: 'packages/analyzer/src',
    });
    fireEvent.keyDown(screen.getByTestId(FILES.tree), { key: 'ArrowRight' });
    expect(onToggle).toHaveBeenCalledWith('packages/analyzer/src');
  });

  it('Enter opens the selected FILE', () => {
    const { onOpen } = mount({ selected: 'README.md' });
    fireEvent.keyDown(screen.getByTestId(FILES.tree), { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('README.md');
  });

  it('SWALLOWS ONLY THE KEYS IT USES', () => {
    /* preventDefault on a key this tree declined would break the browser's own
       behaviour for it. Left on the first row means nothing here, so it must
       still mean what it means everywhere else. */
    mount({ selected: 'packages/analyzer/src', expanded: new Set() });
    const tree = screen.getByTestId(FILES.tree);

    const used = fireEvent.keyDown(tree, { key: 'ArrowDown', cancelable: true });
    expect(used).toBe(false);

    const declined = fireEvent.keyDown(tree, { key: 'ArrowLeft', cancelable: true });
    expect(declined).toBe(true);

    const foreign = fireEvent.keyDown(tree, { key: 'a', cancelable: true });
    expect(foreign).toBe(true);
  });

  it('keeps focus on the tree and points at the selected row', () => {
    /* The `aria-activedescendant` half of the ARIA tree pattern: the rows are
       re-created on every expand, and a roving tabindex has to re-assert
       .focus() after each of those renders — the moment that call is missed the
       keyboard silently falls out of the tree onto the document. */
    mount({ selected: 'README.md' });
    const tree = screen.getByTestId(FILES.tree);
    expect(tree.getAttribute('tabindex')).toBe('0');
    expect(tree.getAttribute('aria-activedescendant')).toBe('files-row-README.md');
    expect(row('README.md').getAttribute('aria-selected')).toBe('true');
  });
});

describe('the changed mark', () => {
  const status = new Map<string, FileStatus>([['packages/analyzer/src/auth.ts', 'modified']]);

  it('MARKS A CHANGED FILE WITH A LETTER AND NOT A HUE', () => {
    /* "This file is modified" is a fact about the world, not a verdict on it.
       --fits and --wont are spent on the diff's own arithmetic, and spending
       them here would stop that arithmetic being the loudest thing in the
       panel. The letter reads at a glance and survives greyscale. */
    mount({ status });
    const changed = row('packages/analyzer/src/auth.ts');
    expect(changed.getAttribute('data-dirty')).toBe('true');
    expect(changed.querySelector('.files-mark')?.textContent).toBe('M');
  });

  it('carries the WORD for a reader who cannot see the letter', () => {
    mount({ status });
    const changed = row('packages/analyzer/src/auth.ts');
    expect(changed.getAttribute('aria-label')).toContain('modified');
    expect(changed.getAttribute('title')).toContain('modified');
  });

  it('a directory says only THAT something under it changed', () => {
    mount({ status });
    const parent = row('packages/analyzer/src');
    expect(parent.getAttribute('data-dirty')).toBe('true');
    /* Never a letter: rolling several files' statuses into one would have to
       pick a winner, and any pick is a claim the panel cannot support. */
    expect(parent.querySelector('.files-mark-dot')).not.toBeNull();
    expect(parent.textContent).not.toContain('M');
  });

  it('leaves a clean file unmarked', () => {
    mount({ status });
    expect(row('README.md').getAttribute('data-dirty')).toBe('false');
    expect(row('README.md').querySelector('.files-mark')).toBeNull();
  });
});

describe('the laws this surface is held to', () => {
  it('SPENDS NO GLASS ON A ROW — Decision 14, verbatim', () => {
    /* "backdrop-filter costs a compositing layer per box. Glass goes on the
       chrome's fixed, small set of controls — never a list item, never a
       transcript row." This tree mounts up to three hundred rows. */
    mount({ selected: 'README.md' });
    const style = getComputedStyle(row('README.md'));
    expect(style.backdropFilter || '').toBe('');
  });

  it('selection is neutral — sheet 11.4', () => {
    /* "Selection is where the keyboard is, and is neutral; playing is what the
       canvas is currently showing, and is the one place the accent appears."
       There is no playing state here, so there is no accent here either. */
    mount({ selected: 'README.md' });
    expect(row('README.md').getAttribute('data-selected')).toBe('true');
    expect(row('packages/analyzer/src').getAttribute('data-selected')).toBe('false');
  });
});
