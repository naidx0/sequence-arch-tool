/**
 * The card for a real repository: one scan, no second walk.
 *
 * The scan already parses every service's files and already knows which
 * directories it never entered. Both come back through `onServiceFacts` and
 * `graph.unscanned`, so this driver adds no traversal of its own — which is the
 * point. A card that re-walked the repo would answer a slightly different
 * question from the graph beside it, and the first disagreement would be
 * invisible.
 */
import { scanCoverage } from '@sequence/schema';

import { scanRepo, type ServiceFiles } from '../scan.js';
import type { Discovery } from '../types.js';

import { cardInputFrom } from './collectEnvReads.js';
import { declaredFromDotenvExample } from './declaredInputs.js';
import { buildServiceInputCard, type ServiceInputCard } from './serviceInputCard.js';

export async function serviceInputCardForRepo(repoRoot: string): Promise<ServiceInputCard> {
  let perService: readonly ServiceFiles[] = [];
  let discovery: Discovery | undefined;

  const graph = await scanRepo(repoRoot, {
    onServiceFacts: (p, d) => {
      perService = p;
      discovery = d;
    },
  });

  /*
   * If the hook never fired the scan produced no service facts at all. That is
   * not "nothing is read" — it is "we did not look", and the card says so by
   * treating every service as unscanned rather than by reporting zeros.
   */
  const services = discovery?.services ?? [];
  const coverage = scanCoverage(graph);
  return buildServiceInputCard({
    ...cardInputFrom(perService, services, coverage, graph.unscanned ?? []),
    repoDeclared: declaredFromDotenvExample(repoRoot),
  });
}
