/**
 * Tier-3 moat types — pattern catalog and industry starters.
 * Spec: docs/tier-3-test-spec.md (file no longer exists; the living record is docs/adr/ADR-010-three-tier-completion-program.md) · Program: ADR-010
 */

export type ResiliencePatternId =
  | 'read-cache'
  | 'circuit-breaker'
  | 'idempotent-consumer';

export interface CheckerRuleRef {
  /** Grounded rule id executed by harness checker — never freeform LLM */
  id: string;
  /** Human-readable; must cite schema or scan evidence type */
  description: string;
}

export interface ResiliencePattern {
  id: ResiliencePatternId | string;
  domain: string;
  appliesWhen: string;
  checkerRules: CheckerRuleRef[];
}

export interface IndustryStarter {
  id: string;
  title: string;
  /** When true, every service/node must trace to manifest or scan evidence */
  groundedOnly: boolean;
  /** Compose-valid fragment ids — docker-compose service keys */
  fragmentIds: string[];
}

export { RESILIENCE_PATTERNS } from './resiliencePatterns.js';
export { INDUSTRY_STARTERS } from './industryStarters.js';
export {
  evaluateResilienceSuggestions,
  patternAdvisor,
  type PatternAdvisoryFinding,
  type PatternAdvisorySuggestion,
  type PatternEvidenceRef,
} from './patternAdvisor.js';
export {
  SHOPFRONT_EDGES,
  SHOPFRONT_GRAPH,
  SHOPFRONT_IMPACT_GOLDEN,
  SHOPFRONT_IMPACT_LINKS,
  SHOPFRONT_NODES,
  SHOPFRONT_POSTGRES_SPOF,
  SHOPFRONT_RISK_NODES,
} from './moatFixtures.js';

export function validateResilienceCatalog(patterns: ResiliencePattern[]): string[] {
  const errors: string[] = [];
  for (const p of patterns) {
    if (!p.id?.trim()) errors.push('pattern missing id');
    if (!p.domain?.trim()) errors.push(`pattern ${p.id}: missing domain`);
    if (!p.appliesWhen?.trim()) errors.push(`pattern ${p.id}: missing appliesWhen`);
    if (!Array.isArray(p.checkerRules) || p.checkerRules.length === 0) {
      errors.push(`pattern ${p.id}: checkerRules required`);
    }
  }
  return errors;
}

export function validateIndustryStarters(starters: IndustryStarter[]): string[] {
  const errors: string[] = [];
  for (const s of starters) {
    if (!s.id?.trim()) errors.push('starter missing id');
    if (!s.title?.trim()) errors.push(`starter ${s.id}: missing title`);
    if (!Array.isArray(s.fragmentIds)) errors.push(`starter ${s.id}: fragmentIds must be array`);
  }
  return errors;
}
