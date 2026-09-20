import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { CodeCard, elidePath } from './CodeCard';
import type { CodeCardItem, CodeCardProps } from './CodeCard';

/*
 * THE ONE MARK ON THE WHITEBOARD THAT CLAIMS TO BE REAL.
 *
 * Everything else on this surface is a sketch and is allowed to say anything
 * (`whiteboardModel.ts`'s header). A code card says "this is that file, at
 * those lines" — so the things worth testing are the ones that would make that
 * claim quietly false or unreadable: a path truncated until it names nothing,
 * an excerpt that bursts the card, a selection nobody can see, an affordance
 * only a mouse can reach.
 */

const ITEM: CodeCardItem = {
  id: 'wb-card-1',
  label: 'whiteboardEdit',
  path: 'packages/web2/src/whiteboard/whiteboardModel.ts',
  nodeId: 'file:packages/web2/src/whiteboard/whiteboardModel.ts',
  lines: { from: 144, to: 181 },
  kind: 'function',
};

function card(
  item: Partial<CodeCardItem> = {},
  props: Omit<Partial<CodeCardProps>, 'item'> = {},
) {
  return render(<CodeCard item={{ ...ITEM, ...item }} {...props} />);
}

describe('a code card shows the code it stands for', () => {
  it('names the symbol, its path and its lines', () => {
    card();
    expect(screen.getByTestId('code-card-name').textContent).toBe('whiteboardEdit');
    expect(screen.getByTestId('code-card-file').textContent).toBe('whiteboardModel.ts');
    expect(screen.getByTestId('code-card-lines').textContent).toBe('L144–181');
  });

  it('carries the KIND as a word and an attribute, not as a colour', () => {
    // Decision 2: a kind is a category and a category is not a claim, so it
    // gets no hue. The word is beside the glyph because a glyph that stands
    // alone has to invent a second name for the same fact.
    card();
    expect(screen.getByTestId('code-card-kind').textContent).toBe('Function');
    expect(screen.getByTestId('code-card').getAttribute('data-kind')).toBe('function');
  });

  it('defaults to a file when no kind is supplied', () => {
    card({ kind: undefined });
    expect(screen.getByTestId('code-card').getAttribute('data-kind')).toBe('file');
  });

  it('keeps the pointer back to the graph node on the element', () => {
    // The card is a POINTER, not a copy — `WbNodeRef`'s own rule. Without the
    // node id on the DOM, "click it and go to the node" has nothing to read.
    card();
    expect(screen.getByTestId('code-card').getAttribute('data-node')).toBe(ITEM.nodeId);
  });

  it('prints a single line as one number, not as a range of one', () => {
    card({ lines: { from: 7, to: 7 } });
    expect(screen.getByTestId('code-card-lines').textContent).toBe('L7');
  });

  it('draws NOTHING where there is no line range', () => {
    // An empty span still takes a gap in a flex row, which is how a card ends
    // up with a hole nobody can explain.
    card({ lines: undefined });
    expect(screen.queryByTestId('code-card-lines')).toBeNull();
  });
});

describe('the path is elided from the LEFT, because the filename is the answer', () => {
  it('drops directories and keeps the filename whole', () => {
    card();
    const path = screen.getByTestId('code-card-path');
    expect(path.textContent?.startsWith('…/')).toBe(true);
    expect(path.textContent?.endsWith('whiteboardModel.ts')).toBe(true);
    // The half that was cut is the half that can be cut.
    expect(path.textContent).not.toContain('packages');
  });

  it('NEVER truncates the filename away — the failure this exists to prevent', () => {
    // `text-overflow: ellipsis` would have produced "packages/web2/src/whiteb…",
    // which answers nothing while looking like it answered.
    card();
    expect(screen.getByTestId('code-card-file').textContent).toBe('whiteboardModel.ts');
  });

  it('keeps a filename that is longer than the whole budget', () => {
    card({ path: 'a/reallyLongFileNameThatGoesOnAndOnAndOnForever.tsx' });
    expect(screen.getByTestId('code-card-file').textContent).toBe(
      'reallyLongFileNameThatGoesOnAndOnAndOnForever.tsx',
    );
  });

  it('leaves a short path exactly as it is', () => {
    // Nothing is elided that fits: an ellipsis on a path that did not need one
    // says "there is more here" about a path there is no more of.
    card({ path: 'src/app.ts' });
    expect(screen.getByTestId('code-card-path').textContent).toBe('src/app.ts');
  });

  it('normalises a Windows path rather than showing backslashes', () => {
    // This repo is developed on Windows and a path that arrives with \ is the
    // same path. `whiteboardKey` normalises for the same reason.
    card({ path: 'packages\\web2\\src\\x.ts' });
    expect(screen.getByTestId('code-card-path').textContent).toContain('/x.ts');
    expect(screen.getByTestId('code-card-path').textContent).not.toContain('\\');
  });

  it('hands the WHOLE path to the tooltip, so nothing elided is lost', () => {
    card();
    expect(screen.getByTestId('code-card-path').getAttribute('title')).toBe(ITEM.path);
  });

  it('elidePath keeps whole segments, never half a directory name', () => {
    // Half a directory name reads as a typo; a missing one reads as elision,
    // which is what the leading ellipsis is there to say.
    const { head, tail } = elidePath('packages/web2/src/whiteboard/whiteboardModel.ts');
    expect(tail).toBe('whiteboardModel.ts');
    expect(head).toBe('…/whiteboard/');
    expect(elidePath('README.md')).toEqual({ head: '', tail: 'README.md' });
  });
});

describe('the excerpt is real source, in a box of its own', () => {
  it('shows the excerpt, dedented to win back the card width', () => {
    card({ excerpt: '      if (edit.dx === 0) return doc;\n      return next;' });
    const excerpt = screen.getByTestId('code-card-excerpt');
    expect(excerpt.textContent).toBe('if (edit.dx === 0) return doc;\nreturn next;');
  });

  it('keeps the RELATIVE indentation, which is the code’s shape', () => {
    card({ excerpt: '  if (a) {\n    return b;\n  }' });
    expect(screen.getByTestId('code-card-excerpt').textContent).toBe('if (a) {\n  return b;\n}');
  });

  it('renders NO empty scroller when there is no excerpt', () => {
    // A bordered void on the card reads as a failed load, which is worse than
    // the honest absence of a thing that was never supplied.
    card();
    expect(screen.queryByTestId('code-card-excerpt')).toBeNull();
  });

  it('treats a whitespace-only excerpt as no excerpt', () => {
    card({ excerpt: '   \n\n ' });
    expect(screen.queryByTestId('code-card-excerpt')).toBeNull();
  });

  it('makes the scroll region reachable by keyboard', () => {
    // A scroll box only a mouse can reach is a box a keyboard user cannot
    // read, and the usability standard scores that as not done.
    card({ excerpt: 'const a = 1;' });
    expect(screen.getByTestId('code-card-excerpt').getAttribute('tabindex')).toBe('0');
  });
});

describe('selection, and the ways a card can be picked', () => {
  it('reports selection BOTH WAYS, so a reader outside can tell', () => {
    // `WbItemView`'s discipline: an attribute that only appears when true
    // cannot be read without first asking whether it is missing or false.
    const view = card({}, { selected: false, onSelect: () => {} });
    expect(screen.getByTestId('code-card').getAttribute('data-selected')).toBe('false');

    view.rerender(<CodeCard item={ITEM} selected onSelect={() => {}} />);
    expect(screen.getByTestId('code-card').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('code-card').getAttribute('aria-pressed')).toBe('true');
  });

  it('fires onSelect on a click', () => {
    const onSelect = vi.fn();
    card({}, { onSelect });
    fireEvent.click(screen.getByTestId('code-card'));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('fires onSelect on Enter AND on Space', () => {
    // Keyboard reachability is required, and a role="button" that only answers
    // a mouse is a lie told to assistive technology.
    const onSelect = vi.fn();
    card({}, { onSelect });
    const element = screen.getByTestId('code-card');
    expect(element.getAttribute('role')).toBe('button');
    expect(element.getAttribute('tabindex')).toBe('0');

    fireEvent.keyDown(element, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(element, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('ignores keys that belong to the excerpt', () => {
    // Space scrolls the focused excerpt. If it also selected the card, reading
    // the code would keep changing what the next question is about.
    const onSelect = vi.fn();
    card({ excerpt: 'const a = 1;' }, { onSelect });
    fireEvent.keyDown(screen.getByTestId('code-card-excerpt'), { key: ' ' });
    fireEvent.keyDown(screen.getByTestId('code-card-excerpt'), { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('is NOT a control when nothing can be selected', () => {
    // A control that is drawn but dead is worse than one never drawn: the
    // reader spends a click finding out. `Whiteboard.tsx` takes the same
    // stance on an absent `onAsk`.
    card();
    const element = screen.getByTestId('code-card');
    expect(element.getAttribute('role')).toBeNull();
    expect(element.getAttribute('tabindex')).toBeNull();
    expect(element.getAttribute('aria-pressed')).toBeNull();
    expect(element.getAttribute('data-interactive')).toBe('false');
  });
});
