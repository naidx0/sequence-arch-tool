import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACCENT_KEY,
  applyAccent,
  chooseAccent,
  DEFAULT_ACCENT,
  readAccent,
  writeAccent,
} from './accentPreference';

/**
 * THE SWITCH, checked without a panel and without a browser.
 *
 * The one property that matters is the one a reader cannot see by looking at
 * the screen: which way an UNANSWERED question falls. Decision 30 turned that
 * answer over — everything which is not an explicit "gold" is now white — and
 * the cases that decide it are the ones nobody renders: a corrupt key, an older
 * build's value, a storage that throws. Each has to land on the thing that
 * ships, because the alternative is a person opening the app into a look they
 * never chose.
 *
 * THE DOM'S DEFAULT AND THE PRODUCT'S DEFAULT NOW DISAGREE, deliberately: no
 * attribute is gold, and the product is white, so the boot path has to SAY
 * white rather than merely leave it alone. That is why `applyAccent` is
 * asserted here for both directions rather than only for the one that sets it.
 */

function store(initial?: string): Pick<Storage, 'getItem' | 'setItem'> & { value?: string } {
  return {
    value: initial,
    getItem(key: string) {
      return key === ACCENT_KEY ? (this.value ?? null) : null;
    },
    setItem(key: string, value: string) {
      if (key === ACCENT_KEY) this.value = value;
    },
  };
}

const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem() {
    throw new Error('site data blocked');
  },
  setItem() {
    throw new Error('site data blocked');
  },
};

describe('the accent preference', () => {
  it('ships blue (Decision 32 — the Lovable look)', () => {
    expect(DEFAULT_ACCENT).toBe('blue');
    expect(readAccent(store())).toBe('blue');
  });

  it('KEEPS a stored gold — the first look is still reachable', () => {
    /* Gold was the default until 2026-09-18. Everyone who chose it, and
       everyone who was simply on it when the default moved, opens into what
       they chose rather than into the new look. */
    expect(readAccent(store('gold'))).toBe('gold');
  });

  it('KEEPS a stored white — the afternoon look is still reachable', () => {
    expect(readAccent(store('white'))).toBe('white');
  });

  it('round-trips a choice', () => {
    const s = store();
    writeAccent('gold', s);
    expect(s.value).toBe('gold');
    expect(readAccent(s)).toBe('gold');
    writeAccent('white', s);
    expect(readAccent(s)).toBe('white');
    writeAccent('blue', s);
    expect(readAccent(s)).toBe('blue');
  });

  it('falls back to blue on a value it does not recognise', () => {
    for (const junk of ['Gold', 'purple', '', '{"accent":"gold"}']) {
      expect(readAccent(store(junk))).toBe('blue');
    }
  });

  it('falls back to blue when storage throws, and never rethrows', () => {
    expect(readAccent(throwing)).toBe('blue');
    expect(() => writeAccent('gold', throwing)).not.toThrow();
  });

  it('survives having no storage at all', () => {
    expect(readAccent(undefined)).toBe('blue');
    expect(() => writeAccent('gold', undefined)).not.toThrow();
  });
});

describe('applying the accent to the root element', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('html');
  });

  it('sets the attribute the token sheet selects', () => {
    applyAccent('white', root);
    expect(root.getAttribute('data-accent')).toBe('white');
  });

  it('PAINTS THE DEFAULT rather than assuming the DOM already is it', () => {
    /* The first paint is white only because somebody sets the attribute. A boot
       path that skipped this call for the default would open every fresh
       machine into gold while `readAccent` said white — the two-surfaces-
       disagreeing defect, with the screen as the one that is wrong. */
    applyAccent(DEFAULT_ACCENT, root);
    expect(root.getAttribute('data-accent')).toBe('blue');
  });

  it('REMOVES the attribute for gold — the default has exactly one spelling', () => {
    applyAccent('white', root);
    applyAccent('gold', root);
    expect(root.hasAttribute('data-accent')).toBe(false);
  });

  it('chooseAccent stores and paints in one move', () => {
    const s = store();
    chooseAccent('white', s, root);
    expect(s.value).toBe('white');
    expect(root.getAttribute('data-accent')).toBe('white');

    chooseAccent('gold', s, root);
    expect(s.value).toBe('gold');
    expect(root.hasAttribute('data-accent')).toBe(false);
  });

  it('is a no-op without an element rather than a crash', () => {
    expect(() => applyAccent('white', undefined)).not.toThrow();
  });
});
