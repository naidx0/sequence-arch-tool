/**
 * P4 — curated built-in workflow catalogue.
 *
 * Five validateProgram-clean templates already lived under `programs/`; nothing
 * listed them for the Activity author UI. This is the one registry the picker
 * and locking tests read — add a builder here and it appears in Activity.
 */

import type { Program } from '../program.js';
import { buildBuildArchitectureProgram } from './buildArchitecture.js';
import { buildBuildArchitectureFullProgram } from './buildArchitectureFull.js';
import { buildCouncilAgainstRisksProgram } from './councilAgainstRisks.js';
import { buildDogfoodLoopProgram } from './dogfoodLoop.js';
import { buildPrTriageProgram } from './prTriage.js';
import { buildReviewLoopProgram } from './reviewLoop.js';
import { buildRouteByBlastRadiusProgram } from './routeByBlastRadius.js';

export interface BuiltinProgramEntry {
  /** Stable id — matches `Program.id` from the builder. */
  readonly id: string;
  /** Short label for the Activity picker. */
  readonly title: string;
  /** One sentence — honesty boundary included where the template is a stub. */
  readonly blurb: string;
  readonly build: () => Program;
}

export const BUILTIN_PROGRAMS: readonly BuiltinProgramEntry[] = [
  {
    id: 'pr-triage',
    title: 'PR Triage',
    blurb: 'Parallel probes → summarize → branch on mode. Needs a local ACP agent.',
    build: buildPrTriageProgram,
  },
  {
    id: 'review-loop',
    title: 'Review loop',
    blurb: 'Propose graph ids → grounded checker → re-loop until clean.',
    build: buildReviewLoopProgram,
  },
  {
    id: 'council-against-risks',
    title: 'Council against risks',
    blurb: 'Parallel SPOF / blast / cycle critics → synthesize → checker.',
    build: buildCouncilAgainstRisksProgram,
  },
  {
    id: 'route-by-blast-radius',
    title: 'Route by blast radius',
    blurb: 'Branch on supplied blastBand (high → deep, low → mechanical).',
    build: buildRouteByBlastRadiusProgram,
  },
  {
    id: 'dogfood-loop',
    title: 'Dogfood loop',
    blurb: 'Scout → propose build ids → checker gate → review note.',
    build: buildDogfoodLoopProgram,
  },
  {
    id: 'build-architecture',
    title: 'Build architecture',
    blurb: 'Tier 2: scout → plan → build loop → review. Default for board launch.',
    build: () => buildBuildArchitectureProgram(),
  },
  {
    id: 'build-architecture-full',
    title: 'Build architecture (full council)',
    blurb: 'Tier 3: parallel risk council → scaffold → Tier 2 build tail.',
    build: () => buildBuildArchitectureFullProgram(),
  },
];

export function builtinProgramById(id: string): BuiltinProgramEntry | undefined {
  return BUILTIN_PROGRAMS.find((e) => e.id === id);
}

export function buildBuiltinProgram(id: string): Program | null {
  const entry = builtinProgramById(id);
  return entry ? entry.build() : null;
}
