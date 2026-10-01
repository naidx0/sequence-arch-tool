import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { EditApprovalCard, applySentence, settledSentence } from './EditApprovalCard';
import type { EditApprovalFile } from './EditApprovalCard';

/*
 * THE DECISION COULD ONLY BE MADE SOMEWHERE ELSE.
 *
 * `edit:proposal` puts a `FileEditProposal` in the store and
 * `proposal/file-decide` settles one file of it, and the only surface that ever
 * dispatched that action was the review overlay. These tests lock the four
 * things that make a transcript card an honest second door to it: it shows the
 * files and the real diff, it reports the decision with the path the store
 * keys on, it keeps saying what was decided after the buttons are gone, and it
 * says so in words when there is no diff to show.
 *
 * THE DIFF BELOW IS A REAL `git diff --no-color` BODY, not a convenient
 * approximation: the `diff --git`/`index` preamble, an `@@` header carrying
 * git's own enclosing-context guess, and counts that actually add up. A fixture
 * shaped for the assertion proves nothing about the shape that arrives.
 */
const STORE_DIFF = [
  'diff --git a/packages/web2/src/state/store.ts b/packages/web2/src/state/store.ts',
  'index 9f2c41a..b73de08 100644',
  '--- a/packages/web2/src/state/store.ts',
  '+++ b/packages/web2/src/state/store.ts',
  "@@ -12,3 +12,4 @@ case 'proposal/file-decide': {",
  '   const existing = state.session.proposals[action.proposalId];',
  '-  if (!existing) return state;',
  '+  if (existing === undefined) return state;',
  '+  const index = existing.files.findIndex((f) => f.path === action.path);',
  '   const files = existing.files.slice();',
  '',
].join('\n');

const TYPES_DIFF = [
  'diff --git a/packages/web2/src/state/types.ts b/packages/web2/src/state/types.ts',
  'index 1104aa2..5528bb1 100644',
  '--- a/packages/web2/src/state/types.ts',
  '+++ b/packages/web2/src/state/types.ts',
  '@@ -1203,2 +1203,3 @@ export interface FileEditProposal {',
  '   id: ProposalId;',
  '+  decidedInTranscript: boolean;',
  '   turnId: TurnId;',
  '',
].join('\n');

const STORE_PATH = 'packages/web2/src/state/store.ts';
const TYPES_PATH = 'packages/web2/src/state/types.ts';

function file(path: string, over: Partial<EditApprovalFile> = {}): EditApprovalFile {
  return { path, diff: path === TYPES_PATH ? TYPES_DIFF : STORE_DIFF, decision: 'pending', ...over };
}

function mount(over: Partial<Parameters<typeof EditApprovalCard>[0]> = {}) {
  const onDecideFile = vi.fn();
  const props = {
    proposalId: 'p1',
    title: 'Decide an edit without leaving the transcript',
    files: [file(STORE_PATH), file(TYPES_PATH)],
    onDecideFile,
    ...over,
  };
  const view = render(<EditApprovalCard {...props} />);
  return { ...view, onDecideFile, props };
}

describe('it shows the files, and the diff it was handed', () => {
  it('names every file and counts them in the header', () => {
    mount();

    expect(screen.getByTestId('chat-edit-approval-count').textContent).toBe('2 files');
    const blocks = screen.getAllByTestId('chat-edit-approval-file');
    expect(blocks.map((b) => b.getAttribute('data-path'))).toEqual([STORE_PATH, TYPES_PATH]);
  });

  it('elides the path from the LEFT, so the filename survives', () => {
    // Longer than the header can hold, which is the only case elision is about.
    const LONG = 'packages/web2/src/chat/transcript/EditApprovalCard.tsx';
    mount({ files: [file(LONG, { diff: STORE_DIFF })] });

    const path = screen.getByTestId('chat-edit-approval-path');
    // The tail is the informative half and is never cut.
    expect(path.textContent).toContain('EditApprovalCard.tsx');
    // The leading segments went; the mark that says so is there instead.
    expect(path.textContent).toContain('…/');
    expect(path.textContent).not.toBe(LONG);
    // The whole path is still recoverable, which is what makes the cut safe.
    expect(path.getAttribute('title')).toBe(LONG);

    // AND A PATH THAT FITS IS NOT MADE TO PAY FOR A MARK IT DOES NOT CARRY.
    expect(STORE_PATH.length).toBeLessThanOrEqual(40);
  });

  it('leaves a path that fits exactly as it was written', () => {
    mount({ files: [file(STORE_PATH)] });
    expect(screen.getByTestId('chat-edit-approval-path').textContent).toBe(STORE_PATH);
  });

  it('draws the lines with the numbers the shared parser computed', () => {
    mount({ files: [file(STORE_PATH)] });

    const rows = screen.getAllByTestId('chat-edit-approval-line');
    expect(rows).toHaveLength(5);

    const kinds = rows.map((r) => r.getAttribute('data-kind'));
    expect(kinds).toEqual(['context', 'del', 'add', 'add', 'context']);

    /*
     * A REMOVED LINE HAS NO NEW NUMBER, AND THIS IS THE ASSERTION THAT MATTERS.
     * It occupies no line in the file anything will edit next; numbering it
     * would point a reader — or an agent they steer — at the wrong line, and it
     * would do so silently.
     */
    const removed = rows[1]!;
    expect(removed.getAttribute('data-old')).toBe('13');
    expect(removed.getAttribute('data-new')).toBeNull();

    const added = rows[2]!;
    expect(added.getAttribute('data-old')).toBeNull();
    expect(added.getAttribute('data-new')).toBe('13');
    expect(added.textContent).toContain('if (existing === undefined) return state;');
  });

  it('reports the arithmetic per file, because the file is the unit of decision', () => {
    mount();

    const [store, types] = screen.getAllByTestId('chat-edit-approval-file');
    expect(within(store!).getByTestId('chat-edit-approval-stat').textContent).toBe('+2−1');
    expect(within(types!).getByTestId('chat-edit-approval-stat').textContent).toBe('+1−0');
  });

  it('keeps the diff inside its own scroller', () => {
    // The gate's rule is that nothing overflows its box. A diff is unbounded in
    // both axes, so the box it is given has to be the one that scrolls.
    mount({ files: [file(STORE_PATH)] });
    const diff = screen.getByTestId('chat-edit-approval-diff');
    expect(getComputedStyle(diff).overflow).toBe('auto');
  });
});

describe('accept and reject, with the argument the store keys on', () => {
  it('reports one file by its verbatim path', () => {
    const { onDecideFile } = mount();

    fireEvent.click(screen.getByLabelText(`Accept ${STORE_PATH}`));
    expect(onDecideFile).toHaveBeenCalledWith('p1', STORE_PATH, 'accepted');

    fireEvent.click(screen.getByLabelText(`Reject ${TYPES_PATH}`));
    expect(onDecideFile).toHaveBeenCalledWith('p1', TYPES_PATH, 'rejected');
    expect(onDecideFile).toHaveBeenCalledTimes(2);
  });

  it('fans the whole-proposal control out over the files, one call each', () => {
    // `proposal/file-decide` is per path and there is no whole-proposal decide
    // action, so this IS the decision vocabulary — not a convenience.
    const { onDecideFile } = mount();

    fireEvent.click(screen.getByTestId('chat-edit-approval-accept-all'));
    expect(onDecideFile.mock.calls).toEqual([
      ['p1', STORE_PATH, 'accepted'],
      ['p1', TYPES_PATH, 'accepted'],
    ]);
  });

  it('leaves a file the reader already answered alone', () => {
    /*
     * The store would take the overwrite without complaint — `file-decide` has
     * no notion of "already settled". So a bulk press that re-decided every
     * file would silently replace an answer the reader gave deliberately.
     */
    const { onDecideFile } = mount({
      files: [file(STORE_PATH, { decision: 'rejected' }), file(TYPES_PATH)],
    });

    fireEvent.click(screen.getByTestId('chat-edit-approval-accept-all'));
    expect(onDecideFile.mock.calls).toEqual([['p1', TYPES_PATH, 'accepted']]);
  });

  it('hands the whole proposal to onDecideAll when the parent supplies one', () => {
    const onDecideAll = vi.fn();
    const { onDecideFile } = mount({ onDecideAll });

    fireEvent.click(screen.getByTestId('chat-edit-approval-reject-all'));
    expect(onDecideAll).toHaveBeenCalledWith('p1', 'rejected');
    expect(onDecideFile).not.toHaveBeenCalled();
  });

  it('gives every control an accessible name and a real button', () => {
    mount({ files: [file(STORE_PATH)] });

    for (const id of [
      'chat-edit-approval-accept',
      'chat-edit-approval-reject',
      'chat-edit-approval-accept-all',
      'chat-edit-approval-reject-all',
    ]) {
      const control = screen.getByTestId(id);
      expect(control.tagName).toBe('BUTTON');
      // A <button> is in the tab order by construction; what a test can still
      // get wrong is shipping one with no name for anything but a mouse.
      expect((control.getAttribute('aria-label') ?? control.textContent ?? '').trim()).not.toBe('');
    }
  });
});

describe('the confirm state — the card stops asking and starts recording', () => {
  const decided: EditApprovalFile[] = [
    file(STORE_PATH, { decision: 'accepted' }),
    file(TYPES_PATH, { decision: 'rejected' }),
  ];

  it('replaces every button with what was decided', () => {
    mount({ files: decided });

    expect(screen.queryByTestId('chat-edit-approval-accept')).toBeNull();
    expect(screen.queryByTestId('chat-edit-approval-reject')).toBeNull();
    expect(screen.queryByTestId('chat-edit-approval-accept-all')).toBeNull();
    expect(screen.queryByTestId('chat-edit-approval-reject-all')).toBeNull();

    const verdicts = screen.getAllByTestId('chat-edit-approval-verdict');
    expect(verdicts.map((v) => v.textContent)).toEqual(['Accepted', 'Rejected']);
    expect(screen.getByTestId('chat-edit-approval-settled').textContent).toContain(
      'Accepted 1 file, rejected 1 file.',
    );
  });

  it('DOES NOT VANISH — the files and their diffs are still on the card', () => {
    /*
     * The single most important assertion in this file. A transcript is a
     * record, and an approval that erased itself would leave the reader unable
     * to answer the one question the card exists to make answerable: what did
     * I agree to?
     */
    mount({ files: decided });

    expect(screen.getAllByTestId('chat-edit-approval-file')).toHaveLength(2);
    expect(screen.getAllByTestId('chat-edit-approval-line').length).toBeGreaterThan(0);
    expect(screen.getByTestId('chat-edit-approval').textContent).toContain('store.ts');
    expect(screen.getAllByTestId('chat-edit-approval-stat')).toHaveLength(2);
  });

  it('marks the settled card in the DOM, off the FILES and not off the status', () => {
    /*
     * `deriveProposalStatusFromFiles` returns 'pending' when every file is
     * accepted but nothing has been written yet. A card that read the status
     * would go on offering Accept for a proposal already fully accepted, which
     * is the defect this assertion locks out.
     */
    mount({ files: [file(STORE_PATH, { decision: 'accepted' })], status: 'pending' });

    expect(screen.getByTestId('chat-edit-approval').getAttribute('data-settled')).toBe('yes');
    expect(screen.queryByTestId('chat-edit-approval-accept-all')).toBeNull();
    expect(screen.getByTestId('chat-edit-approval-settled').textContent).toContain(
      'Accepted 1 file.',
    );
  });

  it('adds the write-progress clause only when there is one to add', () => {
    expect(applySentence('applying')).toBe('Writing the accepted files now.');
    expect(applySentence('applied')).toBe('The accepted files were written.');
    expect(applySentence('denied')).toBe('Nothing was written.');
    // Both of these describe the decisions, which the sentence already reports.
    expect(applySentence('pending')).toBeNull();
    expect(applySentence('partial')).toBeNull();

    mount({ files: decided, status: 'applied' });
    expect(screen.getByTestId('chat-edit-approval-settled').textContent).toContain(
      'The accepted files were written.',
    );
  });

  it('says what happened in one sentence, in every shape', () => {
    expect(settledSentence(2, 0)).toBe('Accepted 2 files.');
    expect(settledSentence(0, 3)).toBe('Rejected 3 files.');
    expect(settledSentence(1, 2)).toBe('Accepted 1 file, rejected 2 files.');
  });

  it('still offers the controls while ONE file is undecided', () => {
    mount({ files: [file(STORE_PATH, { decision: 'accepted' }), file(TYPES_PATH)] });

    expect(screen.getByTestId('chat-edit-approval-accept-all')).toBeTruthy();
    expect(screen.getAllByTestId('chat-edit-approval-accept')).toHaveLength(1);
    expect(screen.getAllByTestId('chat-edit-approval-verdict')).toHaveLength(1);
  });
});

describe('no diff to show, said out loud rather than drawn as a clean tree', () => {
  const noteText = () =>
    screen
      .getAllByTestId('chat-edit-approval-note')
      .map((n) => n.textContent ?? '')
      .join(' ');

  it('distinguishes a diff that was never fetched from one that was empty', () => {
    const { unmount } = mount({ files: [file(STORE_PATH, { diff: null })] });
    expect(noteText()).toContain('has not been fetched yet');
    expect(screen.queryByTestId('chat-edit-approval-line')).toBeNull();
    /* AND NO `+0 −0`. Nothing was measured, so printing zeros would claim
       the file changes nothing — the opposite of what the note says. */
    expect(screen.queryByTestId('chat-edit-approval-stat')).toBeNull();
    unmount();

    mount({ files: [file(STORE_PATH, { diff: '' })] });
    expect(noteText()).toContain('matches what is already on disk');
    // Here the zeros ARE the measured answer.
    expect(screen.getByTestId('chat-edit-approval-stat').textContent).toBe('+0−0');
  });

  it('refuses to draw anything from text that is not a unified diff', () => {
    mount({ files: [file(STORE_PATH, { diff: 'I rewrote the reducer. Trust me.' })] });

    expect(noteText()).toContain('not a unified diff');
    expect(screen.queryByTestId('chat-edit-approval-line')).toBeNull();
    expect(screen.queryByTestId('chat-edit-approval-stat')).toBeNull();
    // Loud, not quiet: a failed parse looks exactly like a clean tree, and the
    // reader would ship believing they had reviewed the change.
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('still offers the decision when there is no diff — the edit is real either way', () => {
    const { onDecideFile } = mount({ files: [file(STORE_PATH, { diff: null })] });

    fireEvent.click(screen.getByLabelText(`Accept ${STORE_PATH}`));
    expect(onDecideFile).toHaveBeenCalledWith('p1', STORE_PATH, 'accepted');
  });

  it('renders a proposal with no files at all as a sentence, not a void', () => {
    mount({ files: [] });

    expect(screen.getByTestId('chat-edit-approval-count').textContent).toBe('0 files');
    expect(noteText()).toContain('names no files yet');
    // Nothing to accept, so nothing offers to.
    expect(screen.queryByTestId('chat-edit-approval-accept-all')).toBeNull();
    expect(screen.queryByTestId('chat-edit-approval-settled')).toBeNull();
  });

  it('says how many lines it withheld instead of capping in silence', () => {
    // A silent cap is worse than a wall: the reader approves a change believing
    // they have seen all of it.
    mount({ files: [file(STORE_PATH)], lineCap: 2 });

    expect(screen.getAllByTestId('chat-edit-approval-line')).toHaveLength(2);
    expect(noteText()).toContain('3 more lines not drawn');

    fireEvent.click(screen.getByTestId('chat-edit-approval-more'));
    expect(screen.getAllByTestId('chat-edit-approval-line')).toHaveLength(5);
  });
});

describe('motion, and its absence under prefers-reduced-motion', () => {
  it('wipes an added line in and unfolds a removed one', () => {
    /*
     * jsdom runs no animation, but it parses the sheet this component ships, so
     * both halves are assertable where they are written: the base rules (the
     * non-vacuity half — a reduce block that stills nothing would pass a test
     * that only looked for the media query), and the block that stills them.
     */
    mount({ files: [file(STORE_PATH)] });
    const rules = walkRules(document.styleSheets);

    const add = rules.find(
      (r) =>
        r.selectorText?.includes('.editapproval-line-add') && /editapproval-wipe/.test(r.cssText),
    );
    expect(add, 'the added-line wipe is missing').toBeTruthy();

    const del = rules.find(
      (r) =>
        r.selectorText?.includes('.editapproval-line-del') && /editapproval-unfold/.test(r.cssText),
    );
    expect(del, 'the removed-line unfold is missing').toBeTruthy();
  });

  it('stills every one of them, and the control hover with them', () => {
    mount({ files: [file(STORE_PATH)] });
    const blocks = findReduceBlocks(document.styleSheets);

    const lines = blocks.find((m) => m.cssText.includes('.editapproval-line-add'));
    expect(lines, 'no reduced-motion block covers the diff lines').toBeTruthy();
    expect(lines!.cssText).toContain('animation: none');
    expect(lines!.cssText).toContain('.editapproval-line-del');

    const control = blocks.find((m) => m.cssText.includes('.editapproval-act'));
    expect(control, 'the control lift keeps moving under reduced motion').toBeTruthy();
    expect(control!.cssText).toContain('transition: none');
  });

  it('leaves the rows visible when it stills them', () => {
    /*
     * THE FAILURE THIS BLOCKS. The wipe fills `both`, so it holds its FROM frame
     * — `inset(0 100% 0 0)`, a row clipped to zero width. Killing only the
     * animation on a browser that still applied the fill would leave a reader
     * with reduced motion on looking at a diff with its additions missing. The
     * reduce block therefore resets the properties too.
     */
    mount({ files: [file(STORE_PATH)] });
    const lines = findReduceBlocks(document.styleSheets).find((m) =>
      m.cssText.includes('.editapproval-line-add'),
    );

    expect(lines!.cssText).toContain('opacity: 1');
    expect(lines!.cssText).toMatch(/clip-path: none|transform: none/);
  });
});

/* -- helpers --------------------------------------------------------------- */

interface StyleRuleLike {
  selectorText?: string;
  cssText: string;
}

/** Every style rule in the document, media blocks walked into. */
function walkRules(sheets: StyleSheetList | StyleSheet[]): StyleRuleLike[] {
  const out: StyleRuleLike[] = [];
  for (const sheet of Array.from(sheets)) {
    const list = (sheet as CSSStyleSheet).cssRules;
    if (!list) continue;
    for (const rule of Array.from(list)) {
      if ('selectorText' in rule) out.push(rule as unknown as StyleRuleLike);
      if ('cssRules' in rule) out.push(...walkRules([rule as unknown as CSSStyleSheet]));
    }
  }
  return out;
}

function findReduceBlocks(sheets: StyleSheetList | StyleSheet[]): CSSMediaRule[] {
  const out: CSSMediaRule[] = [];
  for (const sheet of Array.from(sheets)) {
    const list = (sheet as CSSStyleSheet).cssRules;
    if (!list) continue;
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion')) {
        out.push(rule);
      }
    }
  }
  return out;
}
