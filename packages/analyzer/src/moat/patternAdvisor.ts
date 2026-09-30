/**
 * Grounded resilience-pattern advisor — re-export from schema (single source).
 * Spec: docs/tier-3-test-spec.md (file no longer exists; the living record is docs/adr/ADR-010-three-tier-completion-program.md) Layer 3
 */
export {
  patternAdvisor,
  evaluateResilienceSuggestions,
  type PatternAdvisoryFinding,
  type PatternAdvisorySuggestion,
  type PatternEvidenceRef,
} from '@sequence/schema/dist/moat/patternAdvisor.js';
