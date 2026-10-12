/**
 * Harness skill (Phase 3 — Hermes-style distill).
 *
 * A skill is a repo-scoped, inspectable, reversible `SKILL.md` written under
 * `.sequence/skills/<slug>/SKILL.md`. It carries a YAML frontmatter (the
 * progressive-disclosure SUMMARY — always loaded) and a markdown body (loaded
 * only when an ask matches). The frontmatter is the part the schema vouches for:
 * it names the skill, says what it is for, and pins the trajectory evidence it
 * was distilled from plus any services it claims to be grounded in.
 *
 * HONESTY, binding (same posture as `policy.ts`):
 *  - `evidenceRunIds` MUST be non-empty: a skill with no evidence is a guess,
 *    not a distill. The distill step refuses to write one.
 *  - `groundedServiceIds` is optional, but when present each id MUST resolve
 *    against the scanned graph (the distill step takes a `knownServiceIds` set
 *    and refuses otherwise) — a skill referencing a service that is not in the
 *    scan is the same law as a topology proposal citing a missing node.
 *  - Validation is PURE, returns error STRINGS, never throws — mirroring
 *    `validatePolicy` / `validateProgram`. An empty array means valid.
 */

/** The YAML frontmatter of a `SKILL.md` (the always-loaded summary). */
export interface HarnessSkillFrontmatter {
  /** Only `1` exists. A future shape bumps this rather than guessing. */
  version: 1;
  /** Short human name, printed in the prompt's skill summary list. */
  name: string;
  /** One sentence: what this skill is for / when to apply it. */
  description: string;
  /** Trajectory run ids the skill was distilled from. Non-empty. */
  evidenceRunIds: string[];
  /**
   * Service node ids the skill claims to be grounded in. Optional, but when
   * present each id must exist in the scanned graph — the distill step refuses
   * to write a skill naming a service the scan did not find.
   */
  groundedServiceIds?: string[];
}

/** A parsed skill: frontmatter + the markdown body (loaded on match only). */
export interface HarnessSkill {
  frontmatter: HarnessSkillFrontmatter;
  body: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Validate a parsed skill frontmatter, mirroring `validatePolicy`: PURE, returns
 * EVERY error it finds as a plain string (never throws, never stops at the
 * first), and an empty array means valid. Takes `unknown` on purpose — the
 * input is a YAML block a user (or the distill step) wrote, so it must be
 * checked before it is trusted, not cast into shape.
 */
export function validateHarnessSkill(value: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(value)) {
    return ['skill frontmatter must be an object'];
  }
  if (value.version !== 1) {
    errors.push(`unsupported skill version: ${JSON.stringify(value.version)} (expected 1)`);
  }
  if (typeof value.name !== 'string' || value.name.trim() === '') {
    errors.push('skill name must be a non-empty string');
  }
  if (typeof value.description !== 'string' || value.description.trim() === '') {
    errors.push('skill description must be a non-empty string');
  }
  if (!isStringArray(value.evidenceRunIds) || value.evidenceRunIds.length === 0) {
    errors.push('skill evidenceRunIds must be a non-empty string array');
  }
  if (value.groundedServiceIds !== undefined) {
    if (!isStringArray(value.groundedServiceIds)) {
      errors.push('skill groundedServiceIds must be a string array when present');
    }
  }
  return errors;
}

/** True when `validateHarnessSkill` finds nothing wrong. */
export function isValidHarnessSkill(value: unknown): value is HarnessSkillFrontmatter {
  return validateHarnessSkill(value).length === 0;
}
