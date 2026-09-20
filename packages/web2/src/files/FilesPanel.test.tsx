import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './files.css';

import { FILES } from './anchors';
import { FilesPanel } from './FilesPanel';
import type { FileLoad, FilesPanelProps, FilesView } from './FilesPanel';
import type { FileStatus } from './filesModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL — item 2.1
   packages/web2/src/files/FilesPanel.test.tsx

   The panel is FULLY CONTROLLED, so these assertions are of the form "given
   this state it draws this, and this gesture emits that". There is no internal
   selection to drive and nothing to wait for — which is the point: the same
   code path serves a fixture here and the locked chat in the product, so a
   green render test is evidence about the shipped surface rather than about a
   test-only mode.

   THE THREE THINGS THIS FILE IS ACTUALLY ABOUT:
     - the toggle between the source and the diff is VISIBLE and it works;
     - the header always says which file you are looking at;
     - a control the caller did not enable is not drawn at all, rather than
       drawn and inert.

   jsdom has no layout, so nothing here claims anything about overflow,
   truncation or scrolling. Those belong to the legibility gate against a real
   browser and the real repository.
   ══════════════════════════════════════════════════════════════════════════ */

const PATHS = [
  'packages/analyzer/src/auth.ts',
  'packages/analyzer/src/scan.ts',
  'README.md',
];

const DIFF = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1,1 +1,2 @@',
  ' # Sequence',
  '+Keeps your architecture honest.',
  '',
].join('\n');

const ready = (text: string): FileLoad => ({ state: 'ready', text });

type Overrides = Partial<FilesPanelProps>;

function mount(overrides: Overrides = {}) {
  const spies = {
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onOpen: vi.fn(),
    onQuery: vi.fn(),
    onView: vi.fn(),
    onDraft: vi.fn(),
    onAction: vi.fn(),
  };

  const props: FilesPanelProps = {
    paths: PATHS,
    selected: 'README.md',
    expanded: new Set<string>(['packages/analyzer/src']),
    query: '',
    view: 'code',
    content: ready('# Sequence\nKeeps your architecture honest.'),
    diff: ready(DIFF),
    onSelect: spies.onSelect,
    onToggle: spies.onToggle,
    onOpen: spies.onOpen,
    onQuery: spies.onQuery,
    onView: spies.onView,
    ...overrides,
  };

  const view = render(<FilesPanel {...props} />);
  return { ...spies, ...view, props };
}

describe('the two halves', () => {
  it('draws a tree on the left and the file on the right', () => {
    mount();
    expect(screen.getByTestId(FILES.panel)).toBeTruthy();
    expect(screen.getByTestId(FILES.tree)).toBeTruthy();
    expect(screen.getByTestId(FILES.code)).toBeTruthy();
  });

  it('THE HEADER ALWAYS SAYS WHICH FILE YOU ARE LOOKING AT', () => {
    /* Two files called index.ts are told apart by their directories and by
       nothing else, so the name and the whole path are both present. */
    mount({ selected: 'packages/analyzer/src/auth.ts' });
    const header = screen.getByTestId(FILES.header);
    expect(header.textContent).toContain('auth.ts');
    expect(screen.getByTestId(FILES.headerPath).textContent).toBe(
      'packages/analyzer/src/auth.ts',
    );
  });

  it('says what to do when nothing is selected, rather than showing a blank', () => {
    mount({ selected: null });
    expect(screen.getByTestId(FILES.note).textContent).toContain('Pick a file');
    expect(screen.queryByTestId(FILES.code)).toBeNull();
  });
});

describe('the visible toggle between the source and the diff', () => {
  it('draws both modes, and marks the one in force', () => {
    mount({ view: 'code' });
    const modes = screen.getAllByTestId(FILES.viewOption);
    expect(modes.map((m) => m.getAttribute('data-mode'))).toEqual(['code', 'diff']);
    expect(modes[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(modes[1]!.getAttribute('aria-pressed')).toBe('false');
  });

  it('asks the caller to change the mode, and never changes it itself', () => {
    /* Wave 3 puts a LOCKED CHAT in charge of what each surface is showing. A
       panel that owned this would be a second authority for one fact, and
       whichever rendered second would win. */
    const { onView } = mount({ view: 'code' });
    fireEvent.click(screen.getAllByTestId(FILES.viewOption)[1]!);
    expect(onView).toHaveBeenCalledWith('diff');
    /* Still the source, because the prop did not move. */
    expect(screen.getByTestId(FILES.code)).toBeTruthy();
  });

  it('shows the diff when the mode says diff', () => {
    mount({ view: 'diff' });
    expect(screen.getByTestId(FILES.diff).getAttribute('data-state')).toBe('ready');
    expect(screen.getAllByTestId(FILES.line)).toHaveLength(2);
    expect(screen.queryByTestId(FILES.code)).toBeNull();
  });

  it('A FILE WITH NO DIFF STILL SAYS WHY, INSTEAD OF SHOWING NOTHING', () => {
    /* An EMPTY diff body is a valid, expected answer from the route — the
       wiring must pass it as `ready` and this must render the sentence. */
    mount({ view: 'diff', diff: ready('') });
    expect(screen.getByTestId(FILES.diff).getAttribute('data-state')).toBe('empty');
    expect(screen.getByTestId(FILES.diffNote).textContent).toContain('README.md');
  });
});

describe('the source view', () => {
  it('numbers every line, because evidence here is file:line', () => {
    /* A viewer without a gutter makes the reader count, which is exactly the
       work the citation was supposed to save. */
    mount();
    const lines = screen.getAllByTestId(FILES.codeLine);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toMatch(/^1/);
    expect(lines[1]!.textContent).toMatch(/^2/);
  });

  it('PASSES THE SERVER’S OWN SENTENCE THROUGH UNCHANGED', () => {
    /* /api/file answers differently for "too large", "outside the repo" and
       "unreadable"; each is a different fix, and a panel that rewrote all three
       as "could not load" would delete the one line the reader can act on. */
    mount({ content: { state: 'failed', message: 'file is larger than MAX_FILE_BYTES' } });
    const note = screen.getByTestId(FILES.note);
    expect(note.getAttribute('role')).toBe('alert');
    expect(note.textContent).toBe('file is larger than MAX_FILE_BYTES');
  });

  it('says it is reading, and names the file it is reading', () => {
    mount({ content: { state: 'loading' } });
    expect(screen.getByTestId(FILES.note).textContent).toContain('Reading README.md');
  });

  it('TELLS NOTHING-ASKED-FOR APART FROM STILL-LOADING', () => {
    /* "A dead engine and a rejected folder looked the same on screen" is the
       defect the boot ladder records by name; absence must never be the only
       signal a surface has. */
    mount({ content: { state: 'idle' } });
    expect(screen.getByTestId(FILES.note).textContent).toContain('Nothing loaded');
  });
});

describe('editing', () => {
  it('THERE IS NO EDIT MODE UNTIL A CALLER CAN ACCEPT AN EDIT', () => {
    /* Passing `onDraft` is what makes the panel writable. A caller with no
       write endpoint gets a read-only panel rather than a tab that silently
       discards typing. */
    mount();
    expect(
      screen.getAllByTestId(FILES.viewOption).map((m) => m.getAttribute('data-mode')),
    ).not.toContain('edit');
  });

  it('offers the field once one can, and hands every keystroke back', () => {
    const onDraft = vi.fn();
    mount({ view: 'edit', onDraft });
    const field = screen.getByTestId(FILES.editor) as HTMLTextAreaElement;
    /* A null draft means the reader has not typed yet, so the field shows the
       FILE — not an empty box that would look like a file with no content. */
    expect(field.value).toBe('# Sequence\nKeeps your architecture honest.');

    fireEvent.change(field, { target: { value: '# Sequence\nedited' } });
    expect(onDraft).toHaveBeenCalledWith('# Sequence\nedited');
  });

  it('once there is a draft it is the truth, and the header says it is unsaved', () => {
    mount({ view: 'edit', onDraft: vi.fn(), draft: 'typed over it' });
    expect((screen.getByTestId(FILES.editor) as HTMLTextAreaElement).value).toBe('typed over it');
    expect(screen.getByTestId(FILES.header).textContent).toContain('unsaved');
  });

  it('FALLS BACK TO THE SOURCE RATHER THAN DRAWING NOTHING', () => {
    /* A caller that drops `onDraft` while the mode is still 'edit' shows the
       file. An unavailable mode cannot be the mode. */
    mount({ view: 'edit' });
    expect(screen.queryByTestId(FILES.editor)).toBeNull();
    expect(screen.getByTestId(FILES.code)).toBeTruthy();
  });
});

describe('the filter', () => {
  it('hands the query back and counts HITS, not scaffolding', () => {
    const { onQuery } = mount({ query: 'auth' });
    /* One file is named auth.ts; two directory rows are drawn to reach it. The
       count is 1 — sheet 11.5, and the "6 matches for two files" defect. */
    expect(screen.getByTestId(FILES.matches).textContent).toBe('1 match');

    fireEvent.change(screen.getByTestId(FILES.filter), { target: { value: 'scan' } });
    expect(onQuery).toHaveBeenCalledWith('scan');
  });

  it('a filtered tree comes up open, so the hits are on screen', () => {
    mount({ query: 'auth', expanded: new Set() });
    const paths = screen
      .getAllByTestId(FILES.row)
      .map((r) => r.getAttribute('data-path'));
    expect(paths).toContain('packages/analyzer/src/auth.ts');
    expect(paths).not.toContain('packages/analyzer/src/scan.ts');
  });

  it('says so when nothing matches, in the reader’s own words', () => {
    mount({ query: 'zzzz' });
    expect(screen.getByTestId(FILES.matches).textContent).toBe('0 matches');
    expect(screen.getByTestId(FILES.empty).textContent).toContain('zzzz');
  });

  it('names the branch when there is no query, because a diff is against something', () => {
    mount({ branch: 'main' });
    expect(screen.getByTestId(FILES.matches).textContent).toBe('on main');
  });
});

describe('the tree drives the panel', () => {
  it('a click selects and opens, and both leave as callbacks', () => {
    const { onSelect, onOpen } = mount({ selected: null });
    const target = screen
      .getAllByTestId(FILES.row)
      .find((r) => r.getAttribute('data-path') === 'README.md')!;
    fireEvent.click(target);
    expect(onSelect).toHaveBeenCalledWith('README.md');
    expect(onOpen).toHaveBeenCalledWith('README.md');
  });

  it('shows the git mark for a changed file', () => {
    const status = new Map<string, FileStatus>([['README.md', 'modified']]);
    mount({ status });
    const target = screen
      .getAllByTestId(FILES.row)
      .find((r) => r.getAttribute('data-path') === 'README.md')!;
    expect(target.getAttribute('data-dirty')).toBe('true');
    /* And the header repeats it in the WORD, because the letter is a glyph. */
    expect(screen.getByTestId(FILES.header).textContent).toContain('modified');
  });
});

describe('the action row — "multiple editing options"', () => {
  it('DRAWS ONLY WHAT THE CALLER PASSED, and never invents a control', () => {
    /* A surface that draws a control it cannot make good on is lying about the
       product, and the reader finds out by pressing it. */
    mount();
    expect(screen.queryAllByTestId(FILES.action)).toHaveLength(0);
  });

  it('runs an action against the selected path', () => {
    const onAction = vi.fn();
    mount({
      actions: [{ id: 'save', label: 'Save' }],
      onAction,
    });
    fireEvent.click(screen.getByTestId(FILES.action));
    expect(onAction).toHaveBeenCalledWith('save', 'README.md');
  });

  it('A REFUSAL CARRIES ITS REASON, never a bare grey button', () => {
    /* The defect `reviewScopes` records by name: a disabled Revert behind a
       tooltip that had stopped being true. */
    mount({
      actions: [{ id: 'revert', label: 'Revert', disabled: true, note: 'no route discards this yet' }],
      onAction: vi.fn(),
    });
    const button = screen.getByTestId(FILES.action) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('no route discards this yet');
  });

  it('cannot act when there is nothing selected to act on', () => {
    mount({ selected: null, actions: [{ id: 'save', label: 'Save' }], onAction: vi.fn() });
    expect((screen.getByTestId(FILES.action) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the modes are exactly the modes', () => {
  it('every mode in the control renders something', () => {
    /* A control with a dead option is worse than a missing option: the reader
       presses it once, sees nothing, and stops trusting the rest of the row. */
    const modes: FilesView[] = ['code', 'diff', 'edit'];
    for (const view of modes) {
      const { unmount } = render(
        <FilesPanel
          paths={PATHS}
          selected="README.md"
          expanded={new Set()}
          query=""
          view={view}
          content={ready('one\ntwo')}
          diff={ready(DIFF)}
          onSelect={vi.fn()}
          onToggle={vi.fn()}
          onQuery={vi.fn()}
          onView={vi.fn()}
          onDraft={vi.fn()}
        />,
      );
      const body = screen.getByTestId(FILES.panel).querySelector('.files-body');
      expect(body?.children.length).toBeGreaterThan(0);
      unmount();
    }
  });
});
