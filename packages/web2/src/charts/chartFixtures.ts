/* ══════════════════════════════════════════════════════════════════════════
   SEQ-CHART FIXTURES — one realistic spec per family
   packages/web2/src/charts/chartFixtures.ts

   THESE ARE SPECS A MODEL WOULD PLAUSIBLY EMIT ABOUT THIS REPOSITORY, not
   lorem. A fixture of three items called A, B and C proves the renderer does
   not throw and proves nothing else: it cannot overflow a box, it cannot
   truncate a label, and it cannot make two rows read the same. CLAUDE.md's
   rule is the standard here — "Fixture scale proves logic; only a REAL repo
   proves the result" — so these carry real package names, real path-shaped
   details and real sentence-length captions, and the layout claims that need a
   hundred nodes stay claims until the legibility gate opens a real one.

   `CHART_FIXTURES` is keyed by FAMILY and is total: adding a family to
   ChartFamily fails the build here until it has an example. `VARIANT_FIXTURES`
   covers the arrangements a family picks between — a hierarchy is a tree or a
   stack, a comparison is columns or a quadrant or a venn or a spectrum — which
   the one-per-family record cannot reach on its own.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChartFamily, SeqChart } from '@sequence/schema';

/** One per family. Total by construction. */
export const CHART_FIXTURES: Record<ChartFamily, SeqChart> = {
  'node-link': {
    version: 1,
    kind: 'system-architecture',
    title: 'How the Sequence packages depend on each other',
    caption: 'Every edge here is an import the scanner actually saw, not one the README claims.',
    items: [
      { id: 'schema', label: 'schema', detail: 'packages/schema', nodeId: 'pkg:schema' },
      { id: 'analyzer', label: 'analyzer', detail: 'scanner + server', nodeId: 'pkg:analyzer' },
      { id: 'acp', label: 'acp', detail: 'agent-client-protocol' },
      { id: 'web2', label: 'web2', detail: 'the v2 UI', tone: 'accent' },
      { id: 'gateway', label: 'gateway', detail: 'provider fan-out' },
      { id: 'export', label: 'export', detail: 'board to image' },
    ],
    links: [
      { from: 'schema', to: 'analyzer' },
      { from: 'schema', to: 'acp' },
      { from: 'schema', to: 'export' },
      { from: 'analyzer', to: 'web2' },
      { from: 'acp', to: 'web2' },
      { from: 'export', to: 'web2' },
      { from: 'analyzer', to: 'gateway', label: 'provider calls' },
    ],
  },

  flow: {
    version: 1,
    kind: 'swimlane',
    title: 'Where the 4.2s attach stall actually went',
    caption: 'Reconstructed from one run: the worker waited on a manifest scan that had already finished.',
    items: [
      { id: 'click', label: 'Attach pressed', group: 'browser', detail: '0ms' },
      { id: 'post', label: 'POST /api/attach', group: 'gateway', detail: '12ms' },
      { id: 'jail', label: 'Path jail check', group: 'gateway', detail: '14ms' },
      { id: 'scan', label: 'Manifest scan', group: 'worker', detail: '1.1s', tone: 'warn' },
      { id: 'wait', label: 'Idle on lock', group: 'worker', detail: '4.2s', tone: 'bad' },
      { id: 'graph', label: 'Graph written', group: 'worker', detail: '4.4s' },
      { id: 'paint', label: 'Board paints', group: 'browser', detail: '4.5s' },
    ],
    links: [
      { from: 'click', to: 'post' },
      { from: 'post', to: 'jail' },
      { from: 'jail', to: 'scan' },
      { from: 'scan', to: 'wait', tone: 'bad', label: 'stall' },
      { from: 'wait', to: 'graph' },
      { from: 'graph', to: 'paint' },
    ],
    axes: { lanes: ['browser', 'gateway', 'worker'] },
  },

  hierarchy: {
    version: 1,
    kind: 'hierarchy',
    title: 'What lives under packages/web2/src',
    caption: 'The four surfaces the shell composes, and what each one owns.',
    items: [
      { id: 'src', label: 'web2/src', detail: 'the v2 UI' },
      { id: 'shell', label: 'shell', detail: 'three-pane frame' },
      { id: 'chat', label: 'chat', detail: 'composer + transcript' },
      { id: 'canvas', label: 'canvas', detail: 'the board' },
      { id: 'charts', label: 'charts', detail: 'this package', tone: 'accent' },
      { id: 'rail', label: 'rail', detail: 'files + functions' },
      { id: 'tokens', label: 'tokens', detail: 'graphite.css' },
    ],
    links: [
      { from: 'src', to: 'shell' },
      { from: 'src', to: 'tokens' },
      { from: 'shell', to: 'chat' },
      { from: 'shell', to: 'canvas' },
      { from: 'shell', to: 'rail' },
      { from: 'chat', to: 'charts' },
    ],
  },

  timeline: {
    version: 1,
    kind: 'roadmap',
    title: 'The v2 rebuild, wave by wave',
    caption: 'Wave 7 was pulled forward: packages/web was deleted before the remaining surfaces landed.',
    items: [
      { id: 'w0', label: 'Wave 0 — tokens', group: 'substrate', detail: 'landed' , tone: 'good' },
      { id: 'w2', label: 'Wave 2 — shell', group: 'substrate', detail: 'landed', tone: 'good' },
      { id: 'w3', label: 'Wave 3 — board', group: 'surfaces', detail: 'landed', tone: 'good' },
      { id: 'w5', label: 'Wave 5 — chat', group: 'surfaces', detail: 'in flight', tone: 'warn' },
      { id: 'w7', label: 'Wave 7 — cutover', group: 'surfaces', detail: 'pulled forward', tone: 'accent' },
      { id: 'w8', label: 'Wave 8 — charts', group: 'surfaces', detail: 'here' },
    ],
    axes: { lanes: ['substrate', 'surfaces'], x: 'build order' },
  },

  quantitative: {
    version: 1,
    kind: 'bar',
    title: 'Edges by proof state in this repository',
    caption: 'Declared edges are config claims the source could not confirm — they are not failures.',
    items: [
      { id: 'traced', label: 'traced', value: 1841, tone: 'good' },
      { id: 'declared', label: 'declared', value: 296 },
      { id: 'derived', label: 'derived', value: 152 },
      { id: 'unresolved', label: 'unresolved', value: 37, tone: 'warn' },
    ],
    axes: { y: 'edges', x: 'proof state' },
  },

  comparison: {
    version: 1,
    kind: 'pros-and-cons',
    title: 'JSON chart specs against model-authored React',
    caption: 'The decision of 2026-09-01: the model emits data, the renderer owns the pixels.',
    items: [
      { id: 'p1', label: 'Checkable against the graph', group: 'spec', detail: 'refuses invented nodes', tone: 'good' },
      { id: 'p2', label: 'About 20 lines a chart', group: 'spec', detail: 'against roughly 150', tone: 'good' },
      { id: 'p3', label: 'Same spec, same pixels', group: 'spec', tone: 'good' },
      { id: 'p4', label: 'Bounded to 45 kinds', group: 'spec', detail: 'no arbitrary visual', tone: 'warn' },
      { id: 'c1', label: 'Any visual at all', group: 'component', tone: 'good' },
      { id: 'c2', label: 'Can draw a beautiful lie', group: 'component', detail: 'arbitrary code', tone: 'bad' },
      { id: 'c3', label: 'Costs 5-8x the tokens', group: 'component', tone: 'bad' },
      { id: 'c4', label: 'Not diffable or replayable', group: 'component', tone: 'bad' },
    ],
    axes: { columns: ['spec', 'component'] },
  },

  cards: {
    version: 1,
    kind: 'statistic-cards',
    title: 'What the scanner found in this monorepo',
    caption: 'Counted at the last attach; coverage is a ratio, not a verdict.',
    items: [
      { id: 'files', label: 'files scanned', value: 2326, detail: 'across 10 packages' },
      { id: 'nodes', label: 'graph nodes', value: 418 },
      { id: 'edges', label: 'graph edges', value: 2326 },
      { id: 'cycles', label: 'import cycles', value: 3, tone: 'warn', detail: 'all inside analyzer' },
    ],
  },

  loop: {
    version: 1,
    kind: 'flywheel',
    title: 'The grounding loop',
    caption: 'Each turn tightens the next: the graph is what makes the answer checkable.',
    items: [
      { id: 'scan', label: 'Scan the repo', detail: 'analyzer' },
      { id: 'graph', label: 'Build the graph', detail: 'nodes + proven edges' },
      { id: 'ask', label: 'Ask a question', detail: 'chat' },
      { id: 'ground', label: 'Answer from evidence', detail: 'cited node ids', tone: 'accent' },
      { id: 'edit', label: 'Change the code', detail: 'agent or human' },
    ],
  },

  annotated: {
    version: 1,
    kind: 'annotated-interface',
    title: 'The three-pane shell, part by part',
    caption: 'Sessions on the left, chat in the centre, the board taking the remainder.',
    items: [
      { id: 'rail', label: 'Sessions rail', detail: '280px, collapses at 1100' },
      { id: 'chat', label: 'Chat column', detail: '392px, up to 720' },
      { id: 'board', label: 'Board pane', detail: 'the flexible remainder', tone: 'accent' },
      { id: 'topbar', label: 'Top bar', detail: '44px' },
    ],
    links: [
      { from: 'topbar', to: 'rail' },
      { from: 'topbar', to: 'chat' },
      { from: 'topbar', to: 'board' },
    ],
  },
};

/**
 * The arrangements a family chooses between.
 *
 * A hierarchy with links is a tree and a hierarchy without them is a stack;
 * a comparison is one of four things. `CHART_FIXTURES` can only exercise one
 * branch per family, so the others live here and the family test walks both
 * lists.
 */
export const VARIANT_FIXTURES: SeqChart[] = [
  {
    version: 1,
    kind: 'pyramid',
    title: 'What has to be true before a change ships',
    caption: 'Three gates, and a change is not done until all of them hold.',
    items: [
      { id: 'human', label: 'Human-usability', detail: 'scored as the user' },
      { id: 'legible', label: 'Legibility', detail: 'nothing overflows or overlaps' },
      { id: 'correct', label: 'Correctness', detail: 'builds, tests, locking test' },
    ],
  },
  {
    version: 1,
    kind: 'maturity-model',
    title: 'How grounded an answer can be',
    items: [
      { id: 'l1', label: 'Guessed from the prompt', tone: 'bad' },
      { id: 'l2', label: 'Read from one file', tone: 'warn' },
      { id: 'l3', label: 'Traced across the graph' },
      { id: 'l4', label: 'Cited with node ids', tone: 'good' },
    ],
  },
  {
    version: 1,
    kind: 'gantt',
    title: 'One attach, by phase',
    caption: 'Durations in tenths of a second, laid end to end in the order they ran.',
    items: [
      { id: 'walk', label: 'Walk the tree', value: 11, group: 'worker' },
      { id: 'parse', label: 'Parse manifests', value: 4, group: 'worker' },
      { id: 'resolve', label: 'Resolve imports', value: 26, group: 'worker', tone: 'warn' },
      { id: 'write', label: 'Write the graph', value: 3, group: 'worker' },
    ],
    axes: { lanes: ['worker'], x: 'tenths of a second' },
  },
  {
    version: 1,
    kind: 'sankey',
    title: 'Where the answer came from',
    caption: 'Weights are the number of edges each source contributed.',
    items: [
      { id: 'q', label: 'Question' },
      { id: 'traced', label: 'Traced edges' },
      { id: 'declared', label: 'Declared edges' },
      { id: 'answer', label: 'Answer' },
    ],
    links: [
      { from: 'q', to: 'traced', value: 241 },
      { from: 'q', to: 'declared', value: 55 },
      { from: 'traced', to: 'answer', value: 241 },
      { from: 'declared', to: 'answer', value: 55 },
    ],
  },
  {
    version: 1,
    kind: 'donut',
    title: 'Lines of the v2 tree by surface',
    items: [
      { id: 'canvas', label: 'canvas', value: 9200 },
      { id: 'chat', label: 'chat', value: 5400, tone: 'accent' },
      { id: 'shell', label: 'shell', value: 2100 },
      { id: 'rail', label: 'rail', value: 1800 },
    ],
  },
  {
    version: 1,
    kind: 'line',
    title: 'Gate runtime over the last five rounds',
    items: [
      { id: 'u1', label: 'r6', value: 41, group: 'unit' },
      { id: 'u2', label: 'r7', value: 44, group: 'unit' },
      { id: 'u3', label: 'r8', value: 52, group: 'unit' },
      { id: 'u4', label: 'r9', value: 58, group: 'unit' },
      { id: 'e1', label: 'r6', value: 120, group: 'e2e' },
      { id: 'e2', label: 'r7', value: 132, group: 'e2e' },
      { id: 'e3', label: 'r8', value: 155, group: 'e2e' },
      { id: 'e4', label: 'r9', value: 149, group: 'e2e' },
    ],
    axes: { y: 'seconds', x: 'round' },
  },
  {
    version: 1,
    kind: 'heat-map',
    title: 'Test coverage by package and tier',
    items: [
      { id: 'a1', label: 'high', value: 9, group: 'schema' },
      { id: 'a2', label: 'high', value: 8, group: 'schema' },
      { id: 'b1', label: 'medium', value: 5, group: 'analyzer' },
      { id: 'b2', label: 'low', value: 2, group: 'analyzer' },
      { id: 'c1', label: 'medium', value: 6, group: 'web2' },
      { id: 'c2', label: 'none', value: 0, group: 'web2' },
    ],
    axes: { columns: ['unit', 'e2e'], lanes: ['schema', 'analyzer', 'web2'] },
  },
  {
    version: 1,
    kind: 'quadrant',
    title: 'Where the remaining gaps sit',
    items: [
      { id: 'g1', label: 'Chart renderer', group: 'do now' },
      { id: 'g2', label: 'Teach mode', group: 'do now' },
      { id: 'g3', label: 'Light theme', group: 'later' },
      { id: 'g4', label: 'Export presets', group: 'later' },
      { id: 'g5', label: 'Annotated interface', group: 'ask first' },
      { id: 'g6', label: 'Second graph backend', group: 'drop' },
    ],
    axes: { columns: ['do now', 'ask first', 'later', 'drop'], x: 'effort', y: 'value' },
  },
  {
    version: 1,
    kind: 'venn',
    title: 'What each tool actually knows',
    items: [
      { id: 'v1', label: 'File contents', group: 'Codex' },
      { id: 'v2', label: 'Shell access', group: 'Codex' },
      { id: 'v3', label: 'Proven edges', group: 'Sequence', tone: 'accent' },
      { id: 'v4', label: 'Live architecture', group: 'Sequence', tone: 'accent' },
    ],
    axes: { columns: ['Codex', 'Sequence'] },
  },
  {
    version: 1,
    kind: 'spectrum',
    title: 'How much a surface may act without asking',
    items: [
      { id: 's1', label: 'Propose', value: 0, tone: 'good' },
      { id: 's2', label: 'Edit on approval', value: 1 },
      { id: 's3', label: 'Edit freely', value: 2, tone: 'warn' },
      { id: 's4', label: 'Run commands', value: 3, tone: 'bad' },
    ],
    axes: { x: 'asks every time', y: 'never asks' },
  },
  {
    version: 1,
    kind: 'scorecard',
    title: 'Gate results for this round',
    items: [
      { id: 'build', label: 'build', value: 100, detail: 'clean', tone: 'good' },
      { id: 'unit', label: 'unit tests', value: 100, detail: '412 passing', tone: 'good' },
      { id: 'e2e', label: 'e2e', value: 92, detail: '1 skipped', tone: 'warn' },
      { id: 'legibility', label: 'legibility', value: 100, tone: 'good' },
    ],
  },
  {
    version: 1,
    kind: 'feedback-loop',
    title: 'Why a stale graph gets staler',
    caption: 'The balancing arm is the re-scan; without it the loop only reinforces.',
    items: [
      { id: 'edit', label: 'Code changes' },
      { id: 'stale', label: 'Graph goes stale', tone: 'warn' },
      { id: 'trust', label: 'Answers drift', tone: 'bad' },
      { id: 'rescan', label: 'Re-scan', tone: 'good' },
    ],
    links: [
      { from: 'edit', to: 'stale' },
      { from: 'stale', to: 'trust' },
      { from: 'trust', to: 'rescan', tone: 'good', label: 'balancing' },
      { from: 'rescan', to: 'edit' },
    ],
  },
];

/** Everything, for a gallery or a screenshot sweep. */
export const ALL_FIXTURES: SeqChart[] = [...Object.values(CHART_FIXTURES), ...VARIANT_FIXTURES];
