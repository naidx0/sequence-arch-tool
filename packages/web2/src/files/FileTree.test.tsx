import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  progress?: ReadonlySet<string> | null;
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
        progress={harness.progress ?? null}
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

describe('the open file is brought into view', () => {
  it('scrolls the selected row into view when the selection arrives, and highlights it (owner, 2026-10-09)', () => {
    const spy = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      mount({ selected: 'packages/analyzer/src/auth.ts' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.instances[0] as HTMLElement).id).toBe('files-row-packages/analyzer/src/auth.ts');
      expect(row('packages/analyzer/src/auth.ts').getAttribute('data-selected')).toBe('true');
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });

  it('does nothing with no selection', () => {
    const spy = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = spy;
    try {
      mount({ selected: null });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe('the changed mark', () => {
  const status = new Map<string, FileStatus>([['packages/analyzer/src/auth.ts', 'modified']]);

  it('MARKS A CHANGED FILE WITH A LETTER AND WITH ITS STATUS COLOUR (owner, 2026-10-09)', () => {
    /* The letter survives greyscale; the tone is the VS Code-style colour the
       owner asked for: the name and the letter both take it. */
    mount({ status });
    const changed = row('packages/analyzer/src/auth.ts');
    expect(changed.getAttribute('data-dirty')).toBe('true');
    expect(changed.querySelector('.files-mark')?.textContent).toBe('M');
    expect(changed.classList.contains('files-tone-modified')).toBe(true);
    expect(changed.getAttribute('data-tone')).toBe('modified');
  });

  it('each status wears its own tone, painted with the existing verdict tokens on the NAME and the LETTER', () => {
    const all = new Map<string, FileStatus>([
      ['packages/analyzer/src/auth.ts', 'modified'],
      ['packages/analyzer/src/scan.ts', 'conflicted'],
      ['README.md', 'untracked'],
    ]);
    mount({ status: all });
    expect(row('packages/analyzer/src/scan.ts').getAttribute('data-tone')).toBe('conflict');
    expect(row('README.md').getAttribute('data-tone')).toBe('added');
    const css = readFileSync(join(__dirname, 'files.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [tone, token] of [
      ['modified', '--spills'],
      ['progress', '--spills'],
      ['added', '--fits'],
      ['conflict', '--wont'],
    ] as const) {
      expect(css, tone).toMatch(new RegExp(`files-row-file\\.files-tone-${tone} \\.files-name[^{]*\\{[^}]*color:\\s*var\\(${token}\\)`));
      expect(css, tone).toMatch(new RegExp(`files-row-file\\.files-tone-${tone} \\.files-mark[^{]*\\{[^}]*color:\\s*var\\(${token}\\)`));
    }
    /* A folder wears only its DOT: no selector may colour a row (folders carry the tone class too) without saying it is a file row or the header. */
    expect(css).not.toMatch(/\.files-scope \.files-tone-/);
    expect(css).not.toMatch(/\.files-row\.files-tone-\w+ \.files-(name|mark)\b(?!-)/);
    expect(css).toMatch(/files-tone-deleted \.files-name[^{]*\{[^}]*text-decoration:\s*line-through/);
    expect(css).toMatch(/files-tone-progress[^{]*\{[^}]*animation:\s*files-progress-pulse/);
  });

  it('a file being edited (progress) is yellow with a dot even though git calls it clean', () => {
    mount({ progress: new Set(['README.md']) });
    const r = row('README.md');
    expect(r.getAttribute('data-tone')).toBe('progress');
    expect(r.querySelector('.files-mark-dot')).not.toBeNull();
    expect(r.getAttribute('aria-label')).toContain('being edited');
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
    /* It says HOW MANY (a count), never WHICH (a letter). */
    expect(parent.querySelector('.files-mark-count')?.textContent).toMatch(/^\d+$/);
    expect(parent.querySelector('.files-mark-dot')).toBeNull();
    /* The dot wears the strongest tone beneath it. */
    expect(parent.getAttribute('data-tone')).toBe('modified');
    /* The whole row, as before: no status letter anywhere on a directory. */
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
