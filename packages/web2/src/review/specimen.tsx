/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEW SPECIMEN PAGE — the Tier-4 surface
   packages/web2/src/review/specimen.tsx

   WHAT THIS IS. A RENDERING HARNESS. `reviewRendered.test.ts` builds it,
   serves it and drives it in a real Chrome, because the load-bearing claims
   about this surface are claims about PAINT and no jsdom tier can evaluate one:

     · the add and remove washes actually resolve and actually differ
     · the code foreground is the SAME on an added, removed and context line —
       the book's "background wash only, never foreground"
     · the highlighter spends no hue, measured off the rendered colour
     · the two gutters and the code column do not overlap and are not zero-wide
     · the pane does not scroll horizontally; the DIFF scrolls inside itself
     · compact holds: 10–12px type, a 28px control, a 26px icon button

   It is ALSO the page a human looks at, which R15 requires of every wave:
   "no wave ships without a rendered screenshot compared against its sheet."
   `8d38fad3`'s own commit message is why — "nobody has looked at this with
   human eyes — every claim above is a computed-value measurement, because the
   browser pane would not composite."

   IT IS NOT PRODUCT DATA AND IT IS NEVER BUILT INTO THE APP, the same way
   canvas/specimen.tsx and boot/preview.tsx are not.

   ── THE DIFF IT SHOWS COMES FROM REAL git WHEN THERE IS ONE ──────────────

   `reviewRendered.test.ts` runs a real `git diff` in a throwaway repository and
   injects the bytes as `window.__REVIEW_SPECIMEN__` before the page loads. So
   the measured run is measuring the exact dialect the engine serves. The
   fallback below exists only so the page still opens standalone for a human,
   and it is LABELLED ON THE PAGE as a specimen — Graphite law 4 forbids
   inventing a number, and a diff nobody produced is a number with lines.
   ══════════════════════════════════════════════════════════════════════════ */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';
import './review.css';

import { ReviewPane } from './ReviewPane.js';
import type { ReviewClient } from './reviewClient.js';

declare global {
  interface Window {
    __REVIEW_SPECIMEN__?: { diff: string; path: string };
  }
}

/** The standalone fallback. Replaced by real `git diff` output under the test. */
const FALLBACK = [
  'diff --git a/specimen.ts b/specimen.ts',
  '--- a/specimen.ts',
  '+++ b/specimen.ts',
  '@@ -1,6 +1,7 @@ export function verify(token: string) {',
  ' // a specimen, not a measurement',
  '   const claims = decode(token);',
  '-  if (!claims) return null;',
  '+  if (!claims) throw new AuthError("unreadable token");',
  '+  if (claims.exp < now()) throw new AuthError("expired and this line is deliberately long enough to need a horizontal scroll inside the diff rather than on the page");',
  '   return claims;',
  ' }',
  '',
].join('\n');

const injected = window.__REVIEW_SPECIMEN__;
const DIFF = injected?.diff ?? FALLBACK;
const PATH = injected?.path ?? 'specimen.ts';

/** A client that answers from the page rather than from a socket. */
const client: ReviewClient = {
  status: async () => ({
    outcome: 'ok',
    status: 200,
    body: { branch: 'main', files: [{ path: PATH, status: 'modified' }] },
  }),
  diff: async (path) => ({ outcome: 'ok', status: 200, body: { path, diff: DIFF } }),
  /* One commit and one branch, so the specimen can draw the picker without a
     socket. Fixed values, because a specimen whose content moved would make
     every screenshot of it a different page. */
  revisions: async () => ({
    outcome: 'ok',
    status: 200,
    body: {
      commits: [
        { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'widen the scanner', at: '2026-08-22T09:00:00.000Z' },
      ],
      branches: ['main'],
      head: 'main',
    },
  }),
  /* THE SPECIMEN NEVER WRITES. A harness page that could PUT a file is a
     harness page that will, the first time somebody opens it against a running
     engine and clicks the solid button. */
  writeFile: async () => ({ outcome: 'error', status: 403, body: { error: 'the specimen never writes' } }),
  commit: async () => ({ outcome: 'error', status: 403, body: { error: 'the specimen never commits' } }),
  /* And it certainly never throws work away. */
  discard: async () => ({ outcome: 'error', status: 403, body: { error: 'the specimen never discards' } }),
  functions: async () => ({ outcome: 'error', status: 404, body: { error: 'no engine' } }),
  /* THE SPECIMEN HAS NOTHING TO UNDO, because it never wrote. An empty
     list is the honest answer here and not a stub: a harness page with
     no writes behind it genuinely has no checkpoints. Restoring is
     refused outright for the same reason writing is. */
  /* The specimen never writes, so it has nothing to take a restore point
     for either. Refused for the same reason writing is. */
  checkpoint: async () => ({ outcome: 'error', status: 403, body: { error: 'the specimen never writes' } }),
  checkpoints: async () => ({ outcome: 'ok', status: 200, body: { checkpoints: [], tracked: [] } }),
  planRestore: async () => ({ outcome: 'error', status: 403, body: { error: 'the specimen never restores' } }),
  restore: async () => ({ outcome: 'error', status: 403, body: { error: 'the specimen never restores' } }),
};

function Specimen() {
  return (
    <div data-testid="specimen" style={{ display: 'grid', gridTemplateRows: '1fr auto', height: '100vh' }}>
      <ReviewPane
        client={client}
        proposal={null}
        graph={null}
        functions={null}
        scope="unstaged"
        onSteer={() => {}}
      />
      {/* THE SECOND PANE IS THE REFUSAL, and it is on the page because an
          honest empty state is a rendered surface with the same right to be
          legible as a full one — and because three of the five scopes will be
          in that state for as long as the engine has no route for them. */}
      <div data-testid="specimen-gap" style={{ height: '220px', borderTop: '1px solid var(--edge)' }}>
        <ReviewPane
          client={client}
          proposal={null}
          graph={null}
          functions={null}
          /*
           * A SCOPE THE REGISTER NEVER HEARD OF, deliberately.
           *
           * All five listed scopes are served now, so `commit` no longer paints
           * a gap — and the refusal path would have gone untested with the last
           * unserved scope. `scopeSupport` is TOTAL and its fallback is a
           * REFUSAL rather than a default: a scope nobody registered must not
           * render as "unstaged". This specimen is where that arm is drawn.
           */
          scope={'deploy' as never}
          onSteer={() => {}}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Specimen />
  </StrictMode>,
);
