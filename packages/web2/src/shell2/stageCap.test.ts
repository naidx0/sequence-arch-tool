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
