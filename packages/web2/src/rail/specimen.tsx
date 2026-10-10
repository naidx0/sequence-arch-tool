import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';
import './rail.css';

import type { GetArchGraphResponse, GetFunctionsResponse } from '@sequence/api-types';

import type { Coverage, FlowPlayback } from '../state/types';

import { IndexRail } from './IndexRail';
import { buildFunctionIndex, type FlowTrace } from './railModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE RENDERED SPECIMEN — not a product surface, not shipped
   packages/web2/src/rail/specimen.tsx

   WHY IT EXISTS. The plan's Tier 4 is not optional: "no wave ships without a
   rendered screenshot compared against its sheet", and §7-R15 names this
   repository's own precedent for skipping it — the cream-canvas defect shipped
   through two full rounds with every computed-value assertion green, because
   only the screenshot showed it, and the Graphite landing commit's closing line
   was "nobody has looked at this with human eyes". A jsdom render test cannot
   see a row collapsed to zero height, an accent that vanished into its ground,
   or a path that overflowed its column.

   `app/App.tsx` belongs to another lane and still mounts the Wave-4 placeholder
   in the rail slot, and a lane may only write inside its own directory — so the
   way to put this rail on a screen is a second entry point inside this one.

   IT CANNOT REACH PRODUCTION, AND THAT IS STRUCTURAL RATHER THAN PROMISED.
   `vite.config.ts` sets no `build.rollupOptions.input`, so `vite build` builds
   `index.html` and only `index.html`. Nothing in the app tree imports this file.

   ── THE DATA IS REAL, AND WHERE IT IS NOT, IT SAYS SO ─────────────────────
   The graph and the function graph are fetched from `/graph.json` and
   `/functions.json`, which the test harness serves straight out of
   `.sequence/graph.json` and `.sequence/functions.json` — the engine's own
   caches for THIS repository, written by the real scanner and by the same
   builder `GET /api/functions` serves. a real graph and a real function index.
   Nothing here is hand-written and nothing is trimmed to fit.

   THE ONE INPUT A SCAN CANNOT SUPPLY IS COVERAGE, and it is honest about that.
   `AskCoverage` is produced by an ASK — it is a fact about an answer, not about
   a repository — so it needs a provider and a question, neither of which a
   render specimen has. What the harness supplies is the same thing a question
   would decide: WHICH real components an answer read. Every other part of the
   badge is derived from the real graph — the component's real path, its real
   edge count, counted against `graph.edges.length` and never a capped digest.
   The names come in on `?missed=`, so the specimen never invents a package.
   ══════════════════════════════════════════════════════════════════════════ */

interface Loaded {
  graph: GetArchGraphResponse;
  functions: GetFunctionsResponse;
}

function Specimen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [playback, setPlayback] = useState<FlowPlayback | null>(null);
  const [acted, setActed] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch('./graph.json').then((r) => r.json()),
      fetch('./functions.json').then((r) => r.json()),
    ])
      .then(([graph, functions]) => {
        if (live) setLoaded({ graph, functions });
      })
      .catch((error: unknown) => {
        if (live) setFailure(String(error));
      });
    return () => {
      live = false;
    };
  }, []);

  if (failure) {
    return (
      <p data-testid="specimen-failed">{`the specimen could not read the scan: ${failure}`}</p>
    );
  }
  if (!loaded) return <p>reading the scan…</p>;

  const params = new URLSearchParams(window.location.search);
  const missed = params.getAll('missed').filter((p) => p !== '');

  /*
   * Built from the REAL graph: every component the scan produced is "seen"
   * except the ones the harness names as missed. `edgesTotal` is the whole
   * graph's edge count — risk R4's denominator, never the digest's.
   */
  const componentPaths = loaded.graph.nodes
    .filter((n) => n.kind === 'service' || n.kind === 'datastore' || n.kind === 'topic')
    .map((n) => String(n.path ?? n.label).split(String.fromCharCode(92)).join('/'));
  const coverage: Coverage | null =
    missed.length === 0
      ? null
      : {
          edgesSeen: 0,
          edgesTotal: loaded.graph.edges.length,
          packagesSeen: componentPaths.filter((p) => !missed.includes(p)),
          packagesMissed: componentPaths.filter((p) => missed.includes(p)),
        };

  const note = (what: string) => setActed((prev) => [...prev, what]);

  return (
    <div
      data-testid="specimen"
      style={{
        display: 'flex',
        height: '100vh',
        background: 'var(--bg-ground)',
      }}
    >
      {/* --rail-w, sheet 11.1's default, with the one border on its left. */}
      <div
        data-testid="specimen-column"
        style={{
          width: 'var(--rail-w)',
          flex: '0 0 auto',
          borderLeft: 'var(--w-hair) solid var(--edge)',
          marginLeft: 'auto',
          height: '100%',
        }}
      >
        <IndexRail
          graph={loaded.graph}
          functions={buildFunctionIndex(loaded.functions)}
          coverage={coverage}
          playback={playback}
          repoName={loaded.graph.repoName}
          onPlay={(next: FlowPlayback) => setPlayback(next)}
          onPlaybackChange={setPlayback}
          onClearFlow={() => setPlayback(null)}
          onFocusNode={(id) => note(`focus:${id}`)}
          onOpenScope={(id) => note(`scope:${id}`)}
        />
      </div>

      {/*
        The canvas's half of every rail action, as text. The rail's whole claim
        is that it DRIVES something; a specimen that swallowed the calls would
        let a rail that drives nothing look identical to one that does.
      */}
      <output data-testid="specimen-acted" hidden>
        {acted.join(' ')}
      </output>
    </div>
  );
}

/** Referenced so the type is not dropped as unused; see the flow list. */
export type { FlowTrace };

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Specimen />
  </StrictMode>,
);
