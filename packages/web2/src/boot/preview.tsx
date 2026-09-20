import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';
import './boot.css';

import { AttachDialog } from './AttachDialog';
import { BootSurface } from './BootSurface';
import { createBootTransport } from './bootClient';
import type { BootTransport, WireResult } from './bootSequence';

/**
 * ITEM 2.4 — THE DEV PREVIEW. Not a product surface. Not shipped.
 *
 * WHY IT EXISTS. The plan's Tier 4 is not optional: "no wave ships without a
 * rendered screenshot compared against its sheet", and §7-R15 names this
 * repository's own precedent for skipping it — the cream-canvas defect shipped
 * through two full rounds with every computed-value assertion green, because
 * "only the screenshot showed the defect", and the Graphite landing commit's
 * closing line was "nobody has looked at this with human eyes". A jsdom render
 * test cannot see a box that has collapsed, an ink colour that vanished into
 * its ground, or a 20px glyph sitting on an 11px line.
 *
 * The boot surface has no other way to be looked at yet: `app/App.tsx` belongs
 * to item 2.3 and mounts the Wave 0 token smoke surface, and a lane may only
 * write inside its own directory. So the way to put this on a screen is a
 * second dev entry point inside this directory.
 *
 * IT CANNOT REACH PRODUCTION, AND THAT IS STRUCTURAL RATHER THAN PROMISED.
 * `vite.config.ts` sets no `build.rollupOptions.input`, so `vite build` builds
 * `index.html` and only `index.html`. This file has no importer inside the app
 * tree; nothing in the bundle can reach it. In dev, vite will serve any .html
 * under the package root, which is what makes `/src/boot/preview.html` work
 * without touching a shared file.
 *
 * DELETE IT AT 2.3, when <Shell/> hosts <BootSurface/> and the whole app can be
 * opened at `/` instead. That is in the handback.
 *
 * THE SEVEN STATES ARE DRIVEN BY CANNED ANSWERS, NOT BY A SERVER, because the
 * point is to look at all of them in one pass — including the three that need a
 * dead server, an authenticated server and a foreign session to reproduce.
 * `live` is the eighth button and is the real transport against whatever is
 * actually listening.
 */

const GRAPH = {
  version: 1,
  scannedAt: new Date().toISOString(),
  repoRoot: '/home/max/projects/sequence',
  repoName: 'sequence',
  nodes: [
    { id: 'svc:analyzer', kind: 'service', label: 'Analyzer' },
    { id: 'svc:web2', kind: 'service', label: 'Web2' },
    { id: 'svc:gateway', kind: 'service', label: 'Gateway' },
    { id: 'db:sessions', kind: 'datastore', label: 'Sessions' },
    { id: 'topic:scan', kind: 'topic', label: 'Scan events' },
    { id: 'mod:schema', kind: 'module', label: 'Schema' },
  ],
  edges: [
    { id: 'e1', srcId: 'svc:web2', dstId: 'svc:analyzer', kind: 'http', confidence: 1, origin: 'deterministic', evidence: [] },
    { id: 'e2', srcId: 'svc:analyzer', dstId: 'db:sessions', kind: 'db_write', confidence: 1, origin: 'deterministic', evidence: [] },
  ],
  warnings: [],
  nodeDetail: {},
};

const BROWSE = {
  root: '/home/max',
  path: '/home/max/projects',
  parent: '/home/max',
  entries: [
    { name: 'sequence', path: '/home/max/projects/sequence', isRepo: true, hasChildren: true },
    { name: 'shopfront', path: '/home/max/projects/shopfront', isRepo: true, hasChildren: true },
    { name: 'notes', path: '/home/max/projects/notes', isRepo: false, hasChildren: true },
    { name: 'scratch', path: '/home/max/projects/scratch', isRepo: false, hasChildren: false },
    {
      name: 'a-directory-with-a-very-long-name-that-has-to-truncate-somewhere',
      path: '/home/max/projects/a-directory-with-a-very-long-name-that-has-to-truncate-somewhere',
      isRepo: true,
      hasChildren: false,
    },
  ],
};

const ok = <T,>(body: T): WireResult<T> => ({ outcome: 'ok', status: 200, body });
const bad = (status: number, body: unknown): WireResult<never> => ({
  outcome: 'error',
  status,
  body,
});
const dead: WireResult<never> = { outcome: 'unreachable', message: 'Failed to fetch' };

function canned(over: Partial<BootTransport>): BootTransport {
  return {
    status: async () => dead,
    archGraph: async () => dead,
  detach: async () => ({ outcome: 'unreachable' as const, message: 'preview has no engine' }),
    recent: async () => ok({ recent: [{ path: '/home/max/projects/shopfront', name: 'shopfront' }] }),
    browse: async () => ok(BROWSE),
    attach: async () => bad(422, {
      error: 'no deployment manifests found',
      code: 'no-manifests',
      repoName: 'notes',
    }),
    ...over,
  };
}

const CASES: { id: string; label: string; transport: BootTransport }[] = [
  {
    id: 'no-engine',
    label: 'no engine',
    transport: canned({}),
  },
  {
    id: 'unattached',
    label: 'unattached (S0)',
    transport: canned({ status: async () => ok({ attached: false }) }),
  },
  {
    id: 'attached',
    label: 'attached',
    transport: canned({
      status: async () => ok({ attached: true, repoName: 'sequence', root: '/home/max/projects/sequence' }),
      archGraph: async () => ok<unknown>(GRAPH),
    }),
  },
  {
    id: 'static-graph',
    label: 'static graph',
    transport: canned({ archGraph: async () => ok<unknown>(GRAPH) }),
  },
  {
    id: 'sign-in',
    label: 'sign-in required',
    transport: canned({ status: async () => bad(401, { error: 'sign in required' }) }),
  },
  {
    id: 'foreign',
    label: 'foreign repo',
    transport: canned({ status: async () => ok({ attached: true }) }),
  },
  {
    id: 'hydrate-failed',
    label: 'hydrate failed',
    transport: canned({
      status: async () => ok({ attached: true, repoName: 'sequence', root: '/home/max/projects/sequence' }),
      archGraph: async () => bad(500, { error: 'scan failed: EACCES /home/max/projects/sequence/.git' }),
    }),
  },
  {
    id: 'live',
    label: 'live engine',
    transport: createBootTransport(),
  },
];

function Preview() {
  const [caseId, setCaseId] = useState('no-engine');
  const [dialog, setDialog] = useState<'closed' | 'browse' | 'note' | 'refused' | 'fault'>('closed');
  const active = CASES.find((c) => c.id === caseId) ?? CASES[0];

  /* NOT a spread with a conditional `undefined` in it: `{...{attach: undefined}}`
   * OVERWRITES the default with undefined rather than falling back to it, and
   * the symptom was the 422 note silently not rendering in this preview. The
   * override is built only when there is one. */
  const dialogTransport = canned(
    dialog === 'refused'
      ? { attach: async () => bad(403, { error: 'path escapes the browse root' }) }
      : dialog === 'fault'
        ? { attach: async () => bad(500, { error: 'scan failed: EACCES while reading node_modules' }) }
        : {},
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="attach-bar" style={{ padding: 'var(--sp-8) var(--sp-12)', flexWrap: 'wrap' }}>
        {CASES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`startup-btn sm${c.id === caseId ? ' solid' : ''}`}
            onClick={() => {
              setCaseId(c.id);
              setDialog('closed');
            }}
          >
            {c.label}
          </button>
        ))}
        <span style={{ width: 'var(--sp-16)' }} />
        {(['browse', 'note', 'refused', 'fault'] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={`startup-btn sm${dialog === d ? ' solid' : ''}`}
            onClick={() => setDialog(dialog === d ? 'closed' : d)}
          >
            dialog: {d}
          </button>
        ))}
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
        {dialog === 'closed' ? (
          <BootSurface key={caseId} transport={active.transport} />
        ) : (
          <div className="startup">
            <AttachDialog
              key={dialog}
              transport={dialogTransport}
              onAttached={() => setDialog('closed')}
              onClose={() => setDialog('closed')}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const host = document.getElementById('root');
if (!host) throw new Error('#root missing from preview.html');
createRoot(host).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
