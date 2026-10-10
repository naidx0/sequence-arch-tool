/**
 * Tier 3 — Full council + Tier 2 build tail.
 *
 * Runs council-against-risks shape then the standard build-architecture program
 * nodes (scout through review). validateProgram-clean composite.
 */

import type { Program } from '../program.js';
import type { SeqDiagramV1 } from '../seqdiagram.js';
import { buildBuildArchitectureProgram } from './buildArchitecture.js';
import { buildCouncilAgainstRisksProgram } from './councilAgainstRisks.js';

export function buildBuildArchitectureFullProgram(doc?: SeqDiagramV1): Program {
  const council = buildCouncilAgainstRisksProgram();
  const build = buildBuildArchitectureProgram(doc);

  const councilBody = council.nodes.filter(
    (n) => n.id !== 'start' && n.id !== 'end' && n.id !== 'state',
  );
  const buildBody = build.nodes.filter(
    (n) =>
      n.id !== 'start' &&
      n.id !== 'end' &&
      n.id !== 'state' &&
      n.id !== 'scout' &&
      n.id !== 'plan',
  );

  /*
   * THE TWO HALVES SHARE A VOCABULARY, so composing them collides.
   *
   * Both programs have a `check` node and an `e-check-back` edge — the council's
   * loops back to `verify`, the build's to `gate` — and concatenating the bodies
   * emitted both, producing `duplicate node id: check; duplicate edge id:
   * e-check-back`. This file's own docstring called the result a
   * "validateProgram-clean composite"; it was not, and had not been since the
   * composite was written.
   *
   * It went unseen because `catalogue.test.ts` asserts exactly this — and
   * compiles to `dist/programs/`, which no package glob covers, so it had never
   * run. Found by counting declarations on disk against tests actually run.
   *
   * The rename is COMPUTED, not hardcoded to `check`: the two programs will keep
   * sharing words, and a fix that names today's collision leaves tomorrow's.
   */
  const buildIds = new Set(buildBody.map((n) => n.id));
  const rename = new Map(
    councilBody.filter((n) => buildIds.has(n.id)).map((n) => [n.id, `council-${n.id}`]),
  );
  const ren = (id: string): string => rename.get(id) ?? id;
  const renamedCouncilBody = councilBody.map((n) => (rename.has(n.id) ? { ...n, id: ren(n.id) } : n));

  const nodes = [
    { id: 'start', title: 'Start', kind: 'start' as const },
    council.nodes.find((n) => n.id === 'state')!,
    ...renamedCouncilBody,
    ...buildBody,
    { id: 'end', title: 'Done', kind: 'end' as const },
  ];

  const councilEnd = council.edges.find((e) => e.to === 'end');
  const bridgeFrom = ren(councilEnd?.from ?? 'verify');
  const buildStart = build.edges.find((e) => e.from === 'plan')?.to ?? 'gate';

  /* Council edges follow their nodes' new ids, and any edge id that the build
     half also uses is namespaced the same way. */
  const buildEdgeIds = new Set(build.edges.map((e) => e.id));
  const edges = [
    ...council.edges
      .filter((e) => e.from !== 'start' && e.to !== 'end')
      .map((e) => ({
        ...e,
        id: buildEdgeIds.has(e.id) ? `e-council-${e.id.replace(/^e-/, '')}` : e.id,
        from: ren(e.from),
        to: ren(e.to),
      })),
    { id: 'e-start-state', from: 'start', to: 'state', kind: 'seq' as const },
    { id: 'e-council-build', from: bridgeFrom, to: buildStart, kind: 'seq' as const },
    ...build.edges.filter((e) => e.from !== 'start' && e.to !== 'end' && e.from !== 'state' && e.from !== 'scout' && e.from !== 'plan'),
    { id: 'e-final-end', from: 'review', to: 'end', kind: 'seq' as const },
  ];

  return {
    id: 'build-architecture-full',
    name: doc?.title ? `${doc.title} (full council)` : 'Build architecture (full)',
    description: 'Tier 3: council against risks → build loop → review.',
    state: build.state,
    nodes,
    edges,
  };
}
