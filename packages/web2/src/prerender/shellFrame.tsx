/* ══════════════════════════════════════════════════════════════════════════
   THE SHELL'S FIRST FRAME, RENDERED AT BUILD TIME
   packages/web2/src/prerender/shellFrame.tsx

   scripts/prerender-shell.mjs loads this through Vite's SSR loader under a
   jsdom window (empty storage, a fixed width) and puts the HTML into
   dist/index.html as #static-shell. It is the REAL V3App with a fresh store,
   which is what React's first render draws for a person with the default
   layout, so the static composer sits where React's will (alignment by
   construction, checked at three viewports by tools/ci/static-shell.test.mjs).

   Nothing here runs in the browser.
   ══════════════════════════════════════════════════════════════════════════ */

import { renderToString } from 'react-dom/server';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore } from '../state';
import { CHAT_CARD_W, CHAT_COMFY_W, CHAT_MIN_W, OVERVIEW_GAP, PANEL_MAX_H, PANEL_MAX_W, PANEL_MIN_W, PILL_W } from '../overview/overviewPlace';
import { OVERVIEW_MIN_W } from '../overview/overviewPrefs';
import { CHAT_DEFAULT, CHAT_MAX, CHAT_MIN, NARROW_W } from '../shell2/layoutPrefs';
import { SHELL2_INITIAL_TABS } from '../shell2/Shell2';
import { V3App } from '../v3/V3App';

export function renderShellFrame(): string {
  const store = createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  return renderToString(<V3App appStore={store} />);
}

/** The layout facts the page's pre-paint script needs, taken from the shell itself. */
export const SHELL_LAYOUT = {
  defaultTabsJson: JSON.stringify(SHELL2_INITIAL_TABS),
  chatDefault: CHAT_DEFAULT,
  chatMin: CHAT_MIN,
  chatMax: CHAT_MAX,
  narrowW: NARROW_W,
  overviewMinW: OVERVIEW_MIN_W,
  overviewGap: OVERVIEW_GAP,
  panelMaxW: PANEL_MAX_W,
  panelMinW: PANEL_MIN_W,
  panelMaxH: PANEL_MAX_H,
  pillW: PILL_W,
  chatCardW: CHAT_CARD_W,
  chatMinW: CHAT_MIN_W,
  chatComfyW: CHAT_COMFY_W,
};
