/* ══════════════════════════════════════════════════════════════════════════
   THE ACTIVITY SPECIMEN PAGE — the Tier-4 surface
   packages/web2/src/activity/specimen.tsx

   WHAT THIS IS. A RENDERING HARNESS. `activityRendered.test.ts` builds it,
   serves it and drives it in a real Chrome, because the load-bearing claims
   about this surface are claims about PAINT and no jsdom tier can evaluate one:

     · every `--st-*` tone actually RESOLVES, so a state is not silently the
       same ink as the four beside it
     · the greyscale invariant holds — sheet 12.5's "no state in this product is
       communicated by colour alone", measured off the rendered words
     · §12.6's rule that only a real failure is red, measured off the rendered
       colour rather than off a token name
     · running is the ONE animated object, and it pulses rather than spins
     · compact holds: 28px rows, 10–12px type
     · the row does not overflow its box and the pane does not scroll sideways

   It is ALSO the page a human looks at, which R15 requires of every wave: "no
   wave ships without a rendered screenshot compared against its sheet."

   ── IT SHOWS ALL THREE STATES OF THE SURFACE AT ONCE, ON PURPOSE ─────────

   A full list, a run opened beneath it, and — below the rule — the surface with
   NO run list at all. The third is not decoration: it is the state the product
   is actually in before the engine answers, it is the one this package's whole
   defect class lives in, and an honest absence has exactly the same right to be
   legible as a full list does. The rendered tier measures both.

   IT IS NOT PRODUCT DATA AND IT IS NEVER BUILT INTO THE APP, the same way
   review/specimen.tsx and canvas/specimen.tsx are not. Every run below is a
   `ProgramRunSummary` — the wire type — so a field the engine drops is a
   compile error here rather than a page that outlives the route it drew.
   ══════════════════════════════════════════════════════════════════════════ */

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';
import './activity.css';

import { ActivityPane } from './ActivityPane.js';
import { detail, oneOfEach } from './fixtures.js';
import type { ActivityFilter } from './activityModel.js';

const RUNS = oneOfEach();
/* ?long=1 gives two runs a very long workflow name, to look at ellipsis and wrapping. */
if (new URLSearchParams(window.location.search).get('long') === '1') {
  RUNS[1] = { ...RUNS[1]!, programName: 'Review every pull request that touches the billing service and summarise the risks for the release' };
  RUNS[4] = { ...RUNS[4]!, programName: 'Check generated documentation against the public API surface before each release' };
}
/** Pinned, not `Date.now()`: a specimen whose elapsed column changes between
 *  two runs of the same test is a specimen that cannot be compared to itself. */
const NOW = RUNS[0].startedAt + 97_000;
/** Screenshot harness switches: ?embedded=1 draws it as the Agents > Workflows pane, ?open=none starts with no run opened,
 *  ?w=<px> pins the column width, ?theme=light flips the theme. Defaults are unchanged. */
const QS = new URLSearchParams(window.location.search);
if (QS.get('theme') === 'light') document.documentElement.setAttribute('data-theme', 'light');
const EMBEDDED = QS.get('embedded') === '1';
/* ?author=1 opens the Start a workflow form; ?skin=1 loads the shell's activity skin (shell2/pages.css) under an `.s2` root,
 *  the cascade the real app paints the form under. */
const AUTHOR = QS.get('author') === '1';
const SKIN = QS.get('skin') === '1';
const WIDTH = Number(QS.get('w')) || undefined;
const START_OPEN = QS.get('open') === 'none' ? null : RUNS[0].runId;

function Specimen() {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [openId, setOpenId] = useState<string | null>(START_OPEN);

  return (
    <div
      data-testid="specimen"
      className={SKIN ? 's2' : undefined}
      style={{ display: 'grid', gridTemplateRows: 'auto auto', gap: 'var(--sp-20)', padding: 'var(--sp-20)', width: WIDTH }}
    >
      <ActivityPane
        embedded={EMBEDDED}
        authoring={AUTHOR}
        onAuthor={() => undefined}
        onAuthorCancel={() => undefined}
        onStart={() => undefined}
        runs={RUNS}
        now={NOW}
        filter={filter}
        onFilter={setFilter}
        onRefresh={() => undefined}
        openId={openId}
        open={openId === null ? null : detail()}
        onOpen={(id) => setOpenId((current) => (current === id ? null : id))}
        onCloseRun={() => setOpenId(null)}
      />

      {/* THE ABSENCE, DRAWN AT THE SAME SIZE AS THE LIST. It is the state the
          product opens in, and `groundedSweep.test.tsx` polices what it may
          say; this is where a human checks that saying it legibly is possible
          in the space the surface actually has. */}
      <div data-testid="specimen-absent" style={{ borderTop: 'var(--w-hair) solid var(--edge)', paddingTop: 'var(--sp-20)' }}>
        <ActivityPane
          runs={null}
          now={NOW}
          filter="all"
          onFilter={() => undefined}
          onOpen={() => undefined}
          onCloseRun={() => undefined}
        />
      </div>
    </div>
  );
}

void (SKIN ? import('../shell2/pages.css') : Promise.resolve()).then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <Specimen />
    </StrictMode>,
  );
});
