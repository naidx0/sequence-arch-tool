import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SHELL_TOKENS, createShellState, toPersisted, withPaneWidth } from './shellModel';
import { SHELL_STORAGE_KEY, readShellPersisted, writeShellPersisted } from './shellStorage';

/**
 * ITEM 2.3 — THE PERSISTENCE HALF.
 *
 * Sheet 11 states the rule this file implements, and states it as a product
 * requirement rather than a nicety: "The width is the user's. It is dragged
 * within the clamps and remembered, because re-sizing a panel on every launch
 * is the definition of not customisable."
 *
 * Everything below is about the read path rather than the write path, because
 * the write path cannot really fail and the read path is where a persisted
 * layout turns into a broken one. localStorage is a string keyed by a name any
 * other tab, any older build and any hand-edited devtools session can write.
 * A reader that trusts it hands a NaN to a grid template and paints a zero-width
 * pane that no drag can recover, which is worse than the default it replaced.
 * So the contract is: parse, validate every field independently, and fall back
 * to the default for anything that does not survive — never to a partial record.
 */

const T = DEFAULT_SHELL_TOKENS;

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('the read path', () => {
  it('returns null when nothing has been stored', () => {
    expect(readShellPersisted()).toBeNull();
  });

  it('round-trips a record it wrote itself', () => {
    let state = createShellState({ width: 1280, height: 800 }, T, null);
    state = withPaneWidth(state, 'rail', 320, T);

    writeShellPersisted(toPersisted(state.shell));

    expect(readShellPersisted()).toEqual(toPersisted(state.shell));
  });

  it('rejects a payload that is not an object', () => {
    window.localStorage.setItem(SHELL_STORAGE_KEY, '"wide"');
    expect(readShellPersisted()).toBeNull();
  });

  it('rejects text that is not JSON at all, without throwing', () => {
    window.localStorage.setItem(SHELL_STORAGE_KEY, '{not json');
    expect(readShellPersisted()).toBeNull();
  });

  it('rejects a record written by a different version of this shape', () => {
    const state = createShellState({ width: 1280, height: 800 }, T, null);
    window.localStorage.setItem(
      SHELL_STORAGE_KEY,
      JSON.stringify({ ...toPersisted(state.shell), version: 99 }),
    );
    expect(readShellPersisted()).toBeNull();
  });

  it('discards a v1 record — finding F11', () => {
    /*
     * The slice keys changed MEANING when Decision 5 rearranged the frame:
     * 'rail' stopped being the right-hand index rail and became the LEFT
     * sessions sidebar. A v1 record with railOpen:false would boot the new
     * shell with the sidebar hidden — and with it the settings gear, the only
     * door to settings before a repo is attached. The mechanism for exactly
     * this is the version field: an older shape is discarded whole.
     */
    const state = createShellState({ width: 1280, height: 800 }, T, null);
    window.localStorage.setItem(
      SHELL_STORAGE_KEY,
      JSON.stringify({ ...toPersisted(state.shell), version: 1 }),
    );
    expect(readShellPersisted()).toBeNull();
  });

  it('drops a single unusable field rather than the whole record', () => {
    const state = createShellState({ width: 1280, height: 800 }, T, null);
    window.localStorage.setItem(
      SHELL_STORAGE_KEY,
      JSON.stringify({ ...toPersisted(state.shell), railWidth: 'wide' }),
    );

    const read = readShellPersisted();
    expect(read).not.toBeNull();
    expect(read?.railWidth).toBe(T.rail.base);
    expect(read?.chatWidth).toBe(T.chat.base);
  });

  it('drops a width that is not a finite number', () => {
    const state = createShellState({ width: 1280, height: 800 }, T, null);
    window.localStorage.setItem(
      SHELL_STORAGE_KEY,
      JSON.stringify({ ...toPersisted(state.shell), chatWidth: null }),
    );
    expect(readShellPersisted()?.chatWidth).toBe(T.chat.base);
  });

  it('drops a theme or a priority it does not recognise', () => {
    const state = createShellState({ width: 1280, height: 800 }, T, null);
    window.localStorage.setItem(
      SHELL_STORAGE_KEY,
      JSON.stringify({ ...toPersisted(state.shell), theme: 'sepia', priority: 'canvas' }),
    );

    const read = readShellPersisted();
    expect(read?.theme).toBe('dark');
    expect(read?.priority).toBe('chat');
  });
});

describe('the write path', () => {
  /*
   * Safari in private mode throws QuotaExceededError from setItem, and a
   * remembered pane width is not worth an unhandled rejection on boot. The
   * failure mode of "we could not remember your layout" is the default layout,
   * which is the same thing a first-time visitor gets.
   */
  it('survives a storage that throws', () => {
    const state = createShellState({ width: 1280, height: 800 }, T, null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => writeShellPersisted(toPersisted(state.shell))).not.toThrow();
  });

  it('reads back nothing rather than throwing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(readShellPersisted()).toBeNull();
  });
});
