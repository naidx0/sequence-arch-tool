/* Round 11 look: the stage holds two surfaces below 1200px (at 1024 three
   panes are ~193px and their chips and toolbars are cut), three above. */
import { describe, expect, it } from 'vitest';

import { isVisible } from '../app/chromeTabModel';
import type { ChromeTabState } from '../app/chromeTabModel';
import { STAGE_MAX, STAGE_NARROW_W, fitStage, openOnStage, stageMaxFor } from './Shell2';

const START: ChromeTabState = {
  tabs: [
    { id: 'chat', minimized: false },
    { id: 'architecture', minimized: false },
  ],
  active: 'architecture',
};

const visible = (s: ChromeTabState) => s.tabs.filter((t) => !t.minimized && t.id !== 'chat').map((t) => t.id);

describe('the stage cap follows the window width', () => {
  it('is three at 1200px and up, two below', () => {
    expect(STAGE_NARROW_W).toBe(1200);
    expect(stageMaxFor(1440)).toBe(STAGE_MAX);
    expect(stageMaxFor(1200)).toBe(3);
    expect(stageMaxFor(1199)).toBe(2);
    expect(stageMaxFor(1024)).toBe(2);
  });

  it('at 1024 a third surface retires the oldest, and the stage holds two', () => {
    let s = openOnStage(START, 'terminal', stageMaxFor(1024));
    s = openOnStage(s, 'files', stageMaxFor(1024));
    expect(visible(s)).toEqual(['terminal', 'files']);
    expect(isVisible(s, 'architecture')).toBe(false);
    expect(s.active).toBe('files');
  });

  it('at 1440 the third surface stays open beside the other two', () => {
    let s = openOnStage(START, 'terminal', stageMaxFor(1440));
    s = openOnStage(s, 'files', stageMaxFor(1440));
    expect(visible(s).length).toBe(3);
  });

  it('narrowing the window retires the oldest surfaces that no longer fit', () => {
    let s = openOnStage(START, 'terminal', 3);
    s = openOnStage(s, 'files', 3);
    expect(visible(s).length).toBe(3);
    const fitted = fitStage(s, 2);
    expect(visible(fitted).length).toBe(2);
    expect(isVisible(fitted, 'architecture')).toBe(false);
    expect(fitStage(fitted, 2)).toBe(fitted);
  });
});

describe('a full stage gives up the least recently focused surface (0.1.8 polish)', () => {
  const open = (s: ChromeTabState, ids: Parameters<typeof openOnStage>[1][], max = stageMaxFor(1440)) =>
    ids.reduce((acc, id) => openOnStage(acc, id, max), s);

  it('four surfaces opened at 1440 keep the one just opened, and the stage holds the cap', () => {
    // Four 240px panes and their dividers need 984px; the 1440 stage is ~940px (chat 420, icon rail), so the cap stays 3.
    const s = open(START, ['files', 'agents', 'terminal']);
    expect(visible(s).length).toBe(stageMaxFor(1440));
    expect(isVisible(s, 'terminal')).toBe(true);
    expect(s.active).toBe('terminal');
  });

  it('a surface the reader just focused again is not the one retired', () => {
    let s = open(START, ['files', 'agents']);
    s = openOnStage(s, 'architecture', 3); // focus the oldest again
    s = openOnStage(s, 'terminal', 3);
    expect(isVisible(s, 'architecture')).toBe(true);
    expect(isVisible(s, 'terminal')).toBe(true);
    expect(isVisible(s, 'files')).toBe(false);
    expect(s.tabs.find((t) => t.id === 'files')).toBeDefined(); // still a pill, not closed
  });
});
