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
    blurb: 'Several agents check a pull request at once, then summarize it and choose what to do next.',
    build: buildPrTriageProgram,
  },
  {
    id: 'review-loop',
    title: 'Review loop',
    blurb: 'An agent proposes what to change, a checker confirms it against your code, and it repeats until it is clean.',
    build: buildReviewLoopProgram,
  },
  {
    id: 'council-against-risks',
    title: 'Council against risks',
    blurb: 'Agents look for single points of failure, wide blast radius and cycles, then agree on the risks.',
    build: buildCouncilAgainstRisksProgram,
  },
  {
    id: 'route-by-blast-radius',
    title: 'Route by blast radius',
    blurb: 'Gives big changes a deep review and small changes a quick routine one.',
    build: buildRouteByBlastRadiusProgram,
  },
  {
    id: 'dogfood-loop',
    title: 'Dogfood loop',
    blurb: 'An agent scouts the repository, proposes what to build, has it checked, and leaves a review note.',
    build: buildDogfoodLoopProgram,
  },
  {
    id: 'build-architecture',
    title: 'Build architecture',
    blurb: 'An agent scouts the code, plans the change, builds it in steps, then reviews the result.',
    build: () => buildBuildArchitectureProgram(),
  },
  {
    id: 'build-architecture-full',
    title: 'Build architecture (full council)',
    blurb: 'Agents weigh the risks first, then set up the work, build it in steps and review the result.',
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
