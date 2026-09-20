/**
 * P3 PHASE 2 — THE PERMISSION RULE ALGEBRA.
 *
 * Wave 2 shipped the CONTROL (`packages/web2/src/chat/PermissionControl.tsx`)
 * and its three modes; §5.2 of `docs/research/v2-architecture-and-gaps.md`
 * calls that "the solved interaction for the autonomy question". What did not
 * exist is the algebra behind it: there was no rule a user could write down, so
 * the only permission Sequence enforced was the pair of hard stances baked into
 * the code (`propose_files` never writes; every read goes through
 * `resolveReadable`).
 *
 * This module is the smallest version of Claude Code's model that is REAL:
 *
 *   - three lists — **allow / ask / deny** — evaluated in a STATED precedence
 *     order (see {@link evaluatePermission});
 *   - per-tool specifiers with path globs, `read_file(/src/**)`, plus command
 *     and MCP specifiers for the tools whose subject is not a path;
 *   - **four path-anchoring forms** (see {@link matchPathSpecifier});
 *   - serialized to `.sequence/permissions.json` — a REVIEWABLE TEXT FILE IN
 *     THE REPO, never a database-only rule. §5.2: "a rule you cannot diff loses
 *     the argument for having rules at all." The repo `.gitignore` carries the
 *     un-ignore for it, alongside the identical un-ignore `.sequence/policies/`
 *     already has, and for the identical reason written there: a rule the team
 *     committed is SOURCE and must survive a fresh clone.
 *
 * ── WHAT THIS MODULE DELIBERATELY IS NOT ──────────────────────────────────
 *
 * **B7 is not built here and is not pretended at.** `Edit(src/**)` is a string,
 * while the set of things that break is a transitive closure, and `who_calls`
 * now walks that closure. A rule drawn on the graph is not expressible in a
 * `.json` string matcher, and writing one that LOOKED graph-aware while doing
 * prefix matching would be exactly the defect class this build is held to. The
 * string matcher ships; the graph predicate is named as a follow-up in the
 * lane report and nowhere claimed here.
 *
 * **This module knows nothing about any tool's argument shape.** It matches a
 * `tool` name and a list of already-extracted {@link PermissionSubject}s. The
 * extraction lives in `askTools.ts`, which owns those shapes. That is also what
 * keeps the import edge one-directional: `askTools` → `permissionRules`.
 *
 * **Nothing here is silent.** A rule string that does not parse becomes a named
 * warning on {@link PermissionPolicy.warnings}, and an unreadable or malformed
 * file becomes a named warning too — never an empty ruleset that quietly stops
 * enforcing what the team wrote down.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SEQUENCE_DIR } from './store.js';
import { isRepoTrusted } from './repoTrust.js';

/** The permissions file, relative to `.sequence/`. */
export const PERMISSIONS_FILE = 'permissions.json';

/** Env var carrying a whole permissions document (the `managed` source). */
export const PERMISSIONS_ENV = 'SEQUENCE_PERMISSIONS';

/** The document version this module writes and understands. */
export const PERMISSIONS_VERSION = 1;

/** The `$schema` marker written into the file, so a reader knows what it is. */
export const PERMISSIONS_SCHEMA = 'sequence/permissions@1';

/**
 * Default circuit-breaker length. Codex stops its auto-review agent after three
 * consecutive denials; the same number, for the same reason — a model that has
 * been refused three times running is not going to be un-refused by a fourth
 * attempt, and each attempt costs a provider call.
 *
 * `0` disables the breaker.
 */
export const DEFAULT_DENY_STREAK = 3;

/** One of the three lists. Also the terminal `default`. */
export type PermissionDecision = 'allow' | 'ask' | 'deny';

/** The three lists, in the order they are evaluated. */
export const PERMISSION_DECISIONS: readonly PermissionDecision[] = ['deny', 'ask', 'allow'];

/**
 * Where a rule or a scalar came from. `default` is not a file — it is the name
 * the verdict carries when no rule matched and the document default decided.
 */
export type PermissionSourceName = 'managed' | 'project' | 'user' | 'default';

/**
 * Source precedence, strongest first. This ONLY governs the scalars (`default`,
 * `denyStreak`) — see {@link evaluatePermission} for why it deliberately does
 * not govern rules.
 */
export const PERMISSION_SOURCE_ORDER: readonly Exclude<PermissionSourceName, 'default'>[] = [
  'managed',
  'project',
  'user',
];

/** What a specifier is matched against, once a tool has extracted it. */
export type PermissionSubjectKind = 'path' | 'command' | 'mcp' | 'plugin' | 'url';

export interface PermissionSubject {
  kind: PermissionSubjectKind;
  /**
   * For `path`, repo-relative. For `command`, the command line.
   * For `mcp`, `server:tool`. For `plugin`, `pluginId:tool`.
   */
  value: string;
}

/** A parsed rule: a tool name, an optional specifier, and which list it is on. */
export interface PermissionRule {
  decision: PermissionDecision;
  /** `*` means every tool. A `*` rule never carries a specifier — see {@link parsePermissionRule}. */
  tool: string;
  /** Absent for a bare `tool` rule. Never an empty string. */
  specifier?: string;
  /** Which file this rule came from. */
  source: Exclude<PermissionSourceName, 'default'>;
  /** The rule exactly as written, for a verdict the reader can find in the file. */
  text: string;
}

/** The on-disk / on-wire document shape. */
export interface PermissionDocument {
  version: number;
  /** The terminal decision when no rule matched. Defaults to `allow`. */
  default: PermissionDecision;
  /** Consecutive non-allow verdicts before the turn's tool loop stops. */
  denyStreak: number;
  deny: string[];
  ask: string[];
  allow: string[];
}

/** A loaded, merged, ready-to-evaluate policy. */
export interface PermissionPolicy {
  rules: PermissionRule[];
  /** Resolved by source precedence: managed > project > user. */
  default: PermissionDecision;
  /** Resolved by source precedence. `0` disables the breaker. */
  denyStreak: number;
  /** Which sources actually contributed, in precedence order. Empty ⇒ no file anywhere. */
  sources: Exclude<PermissionSourceName, 'default'>[];
  /**
   * Named failures. A malformed file, an unparseable rule, a rule naming a tool
   * that does not exist. NEVER silent: a ruleset that quietly shrank is the
   * failure mode this whole feature exists to prevent.
   */
  warnings: string[];
}

export interface PermissionVerdict {
  decision: PermissionDecision;
  /** The rule that decided, as written. Absent when the document default decided. */
  rule?: string;
  source: PermissionSourceName;
  /** The subject value the rule matched. Absent for a bare tool-level rule. */
  subject?: string;
  /** One sentence, written to be read by BOTH the model and the user. */
  reason: string;
}

/* ══════════════════════════════════════════════════════════ the empty policy ═ */

/**
 * The policy when no file exists anywhere: no rules, terminal default `allow`.
 *
 * **This is deliberate and it is the honest default.** Before this item there
 * was no permission system, and the enforcement that DID exist — the read jail,
 * the verifyGate command allowlist, `propose_files` never writing — is code, not
 * rules, and is unaffected by anything here. A file the user has never written
 * cannot deny them anything, and shipping a default-deny with no approval
 * channel open would break every existing flow with no way to say yes.
 *
 * The file is ADDITIVE. Write `"default": "deny"` in it to get an
 * allowlist-only posture; that is one line and it is diffable.
 */
export const EMPTY_PERMISSION_POLICY: PermissionPolicy = {
  rules: [],
  default: 'allow',
  denyStreak: DEFAULT_DENY_STREAK,
  sources: [],
  warnings: [],
};

export function emptyPermissionDocument(): PermissionDocument {
  return {
    version: PERMISSIONS_VERSION,
    default: 'allow',
    denyStreak: DEFAULT_DENY_STREAK,
    deny: [],
    ask: [],
    allow: [],
  };
}

/* ═════════════════════════════════════════════════════════════ rule strings ═ */

/**
 * `Tool` or `Tool(specifier)`. Tool names are the ask-tool names — snake_case,
 * because that is what the tool loop actually dispatches on — or `*`.
 *
 * A `*` rule NEVER carries a specifier. `*(src/**)` would have to mean "the
 * path specifier applies to the path-shaped tools and the command specifier to
 * the command-shaped ones", and a rule whose meaning changes per tool is a rule
 * nobody can review. Parse rejects it by name rather than guessing.
 */
const RULE_RE = /^([A-Za-z_][A-Za-z0-9_]*|\*)\s*(?:\(([^)]*)\))?$/;

export interface ParsedRule {
  tool: string;
  specifier?: string;
}

/**
 * Parse one rule string. Returns `null` when it does not parse — the caller
 * turns that into a named warning; nothing is ever dropped quietly.
 */
export function parsePermissionRule(raw: string): ParsedRule | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  const m = RULE_RE.exec(text);
  if (!m) return null;
  const tool = m[1];
  const hadParens = m[2] !== undefined;
  const specifier = hadParens ? m[2].trim() : undefined;
  // `Tool()` is not `Tool` — an empty specifier is a typo, and reading it as
  // "the bare tool" would silently widen the rule the user wrote.
  if (hadParens && (specifier === undefined || specifier.length === 0)) return null;
  if (tool === '*' && hadParens) return null;
  return specifier === undefined ? { tool } : { tool, specifier };
}

/** Render a rule back to its canonical string. Inverse of {@link parsePermissionRule}. */
export function formatPermissionRule(rule: ParsedRule): string {
  return rule.specifier === undefined ? rule.tool : `${rule.tool}(${rule.specifier})`;
}

/* ═══════════════════════════════════════════════════════════════ specifiers ═ */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Path glob → regex. `**` crosses `/`, `*` does not, `?` is one non-`/` char.
 * Case-insensitive, because two of the four anchoring forms resolve against a
 * filesystem that is case-insensitive on both platforms this ships on.
 *
 * This is the same construction `askTools.ts` uses for `search_files`, kept
 * separate rather than exported across the boundary so the permission matcher
 * cannot be changed by a tweak to a search cap.
 */
function pathGlobToRegex(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += escapeRegex(c);
    }
  }
  return new RegExp(`${re}$`, 'i');
}

/**
 * Command glob → regex. `*` spans ANYTHING, spaces included.
 *
 * A command is not a path. `run_command(pnpm *)` has to match `pnpm run build`
 * or the specifier form is useless for the only tool it exists to constrain,
 * and segmenting a command line on `/` would be meaningless.
 */
function commandGlobToRegex(glob: string): RegExp {
  const re = glob
    .split('*')
    .map(escapeRegex)
    .join('.*');
  return new RegExp(`^${re}$`);
}

/**
 * Glob → regex over `left:right` subjects (`server:tool`, `pluginId:tool`).
 * `*` stops at the `:`; `**` crosses it.
 */
function colonPairGlobToRegex(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^:]*';
      }
    } else {
      re += escapeRegex(c);
    }
  }
  return new RegExp(`${re}$`, 'i');
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * THE FOUR PATH-ANCHORING FORMS. A path specifier is read by its prefix, and
 * every form is anchored — there is no form that means "somewhere, maybe".
 *
 * | form      | example              | anchored at                                    |
 * | --------- | -------------------- | ---------------------------------------------- |
 * | `/glob`   | `/src/**`            | the REPO ROOT. `/src/**` is this repo's `src`.  |
 * | `//glob`  | `//etc/**`           | the FILESYSTEM. Absolute, leading `/` dropped.  |
 * | `~/glob`  | `~/.ssh/**`          | the USER HOME.                                 |
 * | `glob`    | `**\/*.env`           | the repo root, UNANCHORED — any depth.         |
 *
 * The fourth form is the one that earns its place: `/.env` denies exactly the
 * repo's own `.env`, while `.env` denies an `.env` anywhere in the tree. Both
 * are things a real rule wants to say, and a matcher with only one of them
 * forces the user to write `**\/` in front of everything and then get the root
 * case wrong.
 *
 * `repoRoot` is required for the `//` and `~/` forms because the subject a tool
 * hands us is repo-relative. Without one those two forms cannot be evaluated,
 * and they return `false` rather than guessing — a rule that cannot be
 * evaluated must never read as satisfied.
 */
export function matchPathSpecifier(
  specifier: string,
  relPath: string,
  repoRoot?: string | null,
): boolean {
  const rel = toPosix(relPath).replace(/^\.\//, '').replace(/^\/+/, '');
  const abs = repoRoot ? toPosix(path.resolve(repoRoot, rel)) : null;

  if (specifier.startsWith('//')) {
    if (!abs) return false;
    return pathGlobToRegex(specifier.slice(2)).test(abs.replace(/^\/+/, ''));
  }
  if (specifier.startsWith('~/') || specifier === '~') {
    if (!abs) return false;
    const home = toPosix(os.homedir()).replace(/\/+$/, '');
    const expanded = specifier === '~' ? home : `${home}/${specifier.slice(2)}`;
    return pathGlobToRegex(expanded.replace(/^\/+/, '')).test(abs.replace(/^\/+/, ''));
  }
  if (specifier.startsWith('/')) {
    return pathGlobToRegex(specifier.replace(/^\/+/, '')).test(rel);
  }
  // Unanchored: matches at the root, or at any depth below it.
  if (pathGlobToRegex(specifier).test(rel)) return true;
  return pathGlobToRegex(`**/${specifier}`).test(rel);
}

function matchSpecifier(
  specifier: string,
  subject: PermissionSubject,
  repoRoot?: string | null,
): boolean {
  switch (subject.kind) {
    case 'path':
      return matchPathSpecifier(specifier, subject.value, repoRoot);
    case 'command':
      return commandGlobToRegex(specifier).test(subject.value.trim());
    case 'mcp':
    case 'plugin': {
      // A specifier with no `:` names the left half and covers every tool on it.
      const full = specifier.includes(':') ? specifier : `${specifier}:*`;
      return colonPairGlobToRegex(full).test(subject.value);
    }
    case 'url':
      return commandGlobToRegex(specifier).test(subject.value.trim());
  }
}

/* ══════════════════════════════════════════════════════════════ evaluation ═ */

export interface PermissionCall {
  tool: string;
  /**
   * Every subject this one call touches. `propose_files` hands over one per
   * file; a tool whose arguments carry no subject (`git_status`) hands over
   * none, and then only a BARE rule (`git_status`, or `*`) can match it — a
   * specifier rule against a subject-less call returns no match rather than
   * matching vacuously.
   */
  subjects?: readonly PermissionSubject[];
  /** Needed by the `//` and `~/` path forms. */
  repoRoot?: string | null;
}

interface RuleHit {
  rule: PermissionRule;
  subject?: string;
}

/**
 * Write tools that stand in for one another WHEN DENYING.
 *
 * A rule names one tool. `propose_files` was the only way the agent could change a
 * file, so `deny propose_files(/secrets/**)` meant "the agent cannot write there".
 * Adding `edit_file` opened a SECOND write door that the same rule cannot see, and a
 * repository whose owner had already written that deny would silently start allowing
 * edits under it. Nobody re-reads their permission file because a new tool shipped.
 *
 * So a DENY naming either write tool is matched against both. Deny only, and
 * deliberately: widening an ALLOW would grant more than the reader wrote, which is the
 * same failure pointing the other way.
 */
const WRITE_TOOL_ALIASES: readonly (readonly string[])[] = [['propose_files', 'edit_file']];

/** Does `ruleTool` cover `callTool` for this decision? */
function toolCovers(ruleTool: string, callTool: string, decision: PermissionDecision): boolean {
  if (ruleTool === '*' || ruleTool === callTool) return true;
  if (decision !== 'deny') return false;
  return WRITE_TOOL_ALIASES.some((group) => group.includes(ruleTool) && group.includes(callTool));
}

function findHit(
  rules: readonly PermissionRule[],
  decision: PermissionDecision,
  call: PermissionCall,
): RuleHit | null {
  for (const rule of rules) {
    if (rule.decision !== decision) continue;
    if (!toolCovers(rule.tool, call.tool, decision)) continue;
    if (rule.specifier === undefined) return { rule };
    for (const subject of call.subjects ?? []) {
      if (matchSpecifier(rule.specifier, subject, call.repoRoot)) {
        return { rule, subject: subject.value };
      }
    }
  }
  return null;
}

/**
 * THE PRECEDENCE ORDER, STATED. Evaluated top to bottom; the first hit decides.
 *
 *   1. any matching **deny** rule, in any source
 *   2. any matching **ask** rule, in any source
 *   3. any matching **allow** rule, in any source
 *   4. the document **default** (itself resolved managed > project > user)
 *
 * TWO THINGS THIS ORDER DELIBERATELY DOES NOT DO, both because they are what
 * make a permission file impossible to review:
 *
 * **Specificity does not break ties.** `read_file(/src/**)` on the allow list
 * and `read_file(/src/secrets/**)` on the deny list resolves to DENY, not to
 * "the longer glob wins". A reader can answer "is this denied?" by grepping the
 * deny list, and never has to rank two globs in their head.
 *
 * **Source precedence does not break ties either — for RULES.** A deny in the
 * user file is not overridable by an allow in the project file. Source order
 * governs only the scalars (`default`, `denyStreak`), where there is exactly
 * one value and somebody has to win. The asymmetry is the point: a rule is a
 * refusal that must survive being included from somewhere weaker, and a scalar
 * is a setting that cannot be unioned.
 *
 * When a `propose_files` touches five files and one of them is denied, the
 * whole call is denied: the loop over subjects returns the first match, and the
 * deny pass runs before the allow pass, so a single denied path wins over four
 * allowed ones. That is the safe direction and it is the only direction that
 * can be honestly reported — a partially-applied proposal is not a thing this
 * tool can produce.
 */
export function evaluatePermission(
  policy: PermissionPolicy,
  call: PermissionCall,
): PermissionVerdict {
  for (const decision of PERMISSION_DECISIONS) {
    const hit = findHit(policy.rules, decision, call);
    if (!hit) continue;
    return {
      decision,
      rule: hit.rule.text,
      source: hit.rule.source,
      ...(hit.subject !== undefined ? { subject: hit.subject } : {}),
      reason: describeVerdict(decision, call.tool, hit.rule, hit.subject),
    };
  }
  return {
    decision: policy.default,
    source: 'default',
    reason:
      policy.default === 'allow'
        ? `no permission rule matches ${call.tool}`
        : `no permission rule matches ${call.tool}, and the permissions file sets "default": "${policy.default}"`,
  };
}

/**
 * The sentence the model reads. It names the decision, the exact rule text as
 * written in the file, and which file it is in, so that the next thing the
 * model says to the user can be actionable rather than "something went wrong".
 *
 * It also tells the model NOT to retry. A refusal the model reads as a
 * transient failure costs the user a full extra provider round.
 */
function describeVerdict(
  decision: PermissionDecision,
  tool: string,
  rule: PermissionRule,
  subject?: string,
): string {
  const where = sourceLabel(rule.source);
  const what = subject !== undefined ? `${tool} on "${subject}"` : tool;
  if (decision === 'deny') {
    return (
      `${what} is DENIED by the permission rule \`${rule.text}\` in ${where}. ` +
      `Do not retry it — the rule is the user's, and only the user can change it. ` +
      `Say what you needed it for and continue with what you can reach.`
    );
  }
  if (decision === 'ask') {
    return (
      `${what} needs the user's approval: the permission rule \`${rule.text}\` in ${where} ` +
      `puts it on the ask list, and this turn has no approval channel open, so it was NOT run. ` +
      `Do not retry it — ask the user in your answer.`
    );
  }
  return `${what} is allowed by \`${rule.text}\` in ${where}`;
}

export function sourceLabel(source: PermissionSourceName): string {
  switch (source) {
    case 'managed':
      return `the ${PERMISSIONS_ENV} environment policy`;
    case 'project':
      return `${SEQUENCE_DIR}/${PERMISSIONS_FILE}`;
    case 'user':
      return `~/${SEQUENCE_DIR}/${PERMISSIONS_FILE}`;
    case 'default':
      return 'the built-in default';
  }
}

/* ════════════════════════════════════════════════════════════ serialization ═ */

/**
 * Parse a permissions document out of raw text. TOTAL: every failure is a named
 * warning plus the part that did parse — a malformed `denyStreak` does not cost
 * you your deny list.
 *
 * `knownTools`, when supplied, turns a rule naming a tool that does not exist
 * into a warning. Without it a typo (`read_files(...)`) is a rule that can never
 * fire, and a permission rule that silently never fires is the worst possible
 * outcome for this feature.
 */
export function parsePermissionsDocument(
  raw: string,
  label: string,
  knownTools?: readonly string[],
): { doc: PermissionDocument; warnings: string[] } {
  const warnings: string[] = [];
  const doc = emptyPermissionDocument();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    warnings.push(`${label}: not readable as JSON (${(e as Error).message}) — NO RULES LOADED from it`);
    return { doc, warnings };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnings.push(`${label}: expected a JSON object — NO RULES LOADED from it`);
    return { doc, warnings };
  }
  const o = parsed as Record<string, unknown>;

  if (typeof o.version === 'number') doc.version = o.version;
  else if (o.version !== undefined) warnings.push(`${label}: "version" is not a number, using ${PERMISSIONS_VERSION}`);

  if (o.default !== undefined) {
    if (o.default === 'allow' || o.default === 'ask' || o.default === 'deny') doc.default = o.default;
    else warnings.push(`${label}: "default" must be allow|ask|deny, using "allow"`);
  }

  if (o.denyStreak !== undefined) {
    if (typeof o.denyStreak === 'number' && Number.isInteger(o.denyStreak) && o.denyStreak >= 0) {
      doc.denyStreak = o.denyStreak;
    } else {
      warnings.push(`${label}: "denyStreak" must be a non-negative integer, using ${DEFAULT_DENY_STREAK}`);
    }
  }

  for (const decision of PERMISSION_DECISIONS) {
    const list = o[decision];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      warnings.push(`${label}: "${decision}" must be an array of rule strings — that list is EMPTY`);
      continue;
    }
    for (const entry of list) {
      if (typeof entry !== 'string') {
        warnings.push(`${label}: "${decision}" holds a non-string entry, DROPPED`);
        continue;
      }
      const rule = parsePermissionRule(entry);
      if (!rule) {
        warnings.push(`${label}: "${entry}" in "${decision}" is not a rule — DROPPED, so it enforces nothing`);
        continue;
      }
      if (knownTools && rule.tool !== '*' && !knownTools.includes(rule.tool)) {
        warnings.push(
          `${label}: "${entry}" in "${decision}" names a tool that does not exist ("${rule.tool}") — ` +
            `it will never match. Known tools: ${knownTools.join(', ')}`,
        );
      }
      doc[decision].push(formatPermissionRule(rule));
    }
  }

  return { doc, warnings };
}

/**
 * Serialize a document to the text that goes on disk.
 *
 * Key order is FIXED and is precedence order — `deny`, then `ask`, then
 * `allow` — so the file reads top to bottom in the order it is evaluated. Each
 * list is sorted, so two people who add the same rule produce the same diff,
 * and a rule that moves in the file is a real change rather than reordering
 * noise. Two-space indent, trailing newline: it is a text file people review.
 */
export function serializePermissionsDocument(doc: PermissionDocument): string {
  const out = {
    $schema: PERMISSIONS_SCHEMA,
    version: doc.version,
    default: doc.default,
    denyStreak: doc.denyStreak,
    deny: [...doc.deny].sort(),
    ask: [...doc.ask].sort(),
    allow: [...doc.allow].sort(),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Where the project-scoped file lives for a given repo. */
export function permissionsFilePath(repoRoot: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, PERMISSIONS_FILE);
}

/**
 * Write the project-scoped file, creating `.sequence/` if needed. Returns the
 * absolute path written. Round-trips with {@link parsePermissionsDocument}.
 */
export function writePermissionsDocument(repoRoot: string, doc: PermissionDocument): string {
  const file = permissionsFilePath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializePermissionsDocument(doc), 'utf8');
  return file;
}

/* ═══════════════════════════════════════════════════════════════════ loading ═ */

function readIfPresent(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

export interface LoadPermissionPolicyOptions {
  /** Tool names that exist, so a rule naming a typo becomes a warning. */
  knownTools?: readonly string[];
  /** Override the user-scope directory. Tests point this at a temp dir. */
  userDir?: string;
  /** Override the managed-scope raw JSON. Tests use it instead of mutating `process.env`. */
  managedRaw?: string;
}

/**
 * Load and merge the three sources into one evaluable policy.
 *
 *   managed — `SEQUENCE_PERMISSIONS`, a whole document as JSON
 *   project — `<repoRoot>/.sequence/permissions.json`
 *   user    — `~/.sequence/permissions.json`
 *
 * Rules from all three are UNIONED, each tagged with where it came from, so a
 * verdict can name the file the reader has to open. Scalars take the
 * highest-precedence source that SET them — `default` and `denyStreak` are only
 * adopted from a source whose raw text actually contains the key, so a project
 * file that omits `denyStreak` does not silently overwrite the user's.
 *
 * A repo with no file anywhere loads {@link EMPTY_PERMISSION_POLICY} — see the
 * note there on why the terminal default is `allow`.
 */
export function loadPermissionPolicy(
  repoRoot: string | null,
  opts: LoadPermissionPolicyOptions = {},
): PermissionPolicy {
  const rules: PermissionRule[] = [];
  const warnings: string[] = [];
  const sources: Exclude<PermissionSourceName, 'default'>[] = [];
  let resolvedDefault: PermissionDecision | undefined;
  let resolvedStreak: number | undefined;

  /*
   * ── THE PROJECT SCOPE IS REPO-PROVIDED CONFIG, SO IT NEEDS TRUST ────────
   *
   * `.sequence/permissions.json` is committed BY THE REPOSITORY, and it is the
   * one repo-controlled file that GRANTS power rather than describing the
   * code: `{"default":"allow","allow":["run_command(*)"]}` is four fields, and
   * cloning a repo that ships it would have silently widened what the agent
   * may do before the user had read a line. That is the same failure as the
   * instruction file (`docs/research/trust-boundary-verification.md` §1) —
   * attaching treated as consenting — so it takes the same answer.
   *
   * IGNORED, AND SAID OUT LOUD. The skip lands on `warnings`, which the
   * permissions surface already prints, because a rule the user believes is
   * enforced and which the server quietly dropped is the worst outcome this
   * feature can produce (the note `readPolicies` already carries).
   *
   * The `user` and `managed` scopes are NOT gated: `~/.sequence` is the
   * person's own file and `SEQUENCE_PERMISSIONS` is the process environment,
   * which is the same trust level as the process itself. Neither is writable
   * by a scanned repository, which is the whole test.
   */
  /* `isRepoTrusted`'s OWN default store, never `opts.userDir` — the boundary
     has exactly one store, and a caller that redirected the permissions read
     must not also be able to redirect the trust read (see the same note on
     `PUT /api/repo-trust`). `SEQUENCE_USER_DIR` moves the one store. */
  const projectTrusted = repoRoot === null ? false : isRepoTrusted(repoRoot);
  if (repoRoot !== null && !projectTrusted && readIfPresent(permissionsFilePath(repoRoot)) !== undefined) {
    warnings.push(
      `.sequence/permissions.json was IGNORED: this repository is not trusted, so rules it ` +
        `ships cannot change what the agent may do. Trust the repository to apply them.`,
    );
  }
  const raws: { source: Exclude<PermissionSourceName, 'default'>; raw: string | undefined }[] = [
    {
      source: 'managed',
      raw: opts.managedRaw ?? process.env[PERMISSIONS_ENV],
    },
    {
      source: 'project',
      raw: repoRoot && projectTrusted ? readIfPresent(permissionsFilePath(repoRoot)) : undefined,
    },
    {
      source: 'user',
      raw: readIfPresent(path.join(opts.userDir ?? path.join(os.homedir(), SEQUENCE_DIR), PERMISSIONS_FILE)),
    },
  ];

  // PERMISSION_SOURCE_ORDER is strongest-first, and `raws` is in that same
  // order, so the FIRST source that set a scalar wins it.
  for (const { source, raw } of raws) {
    if (raw === undefined || raw.trim().length === 0) continue;
    const parsed = parsePermissionsDocument(raw, sourceLabel(source), opts.knownTools);
    warnings.push(...parsed.warnings);
    sources.push(source);
    for (const decision of PERMISSION_DECISIONS) {
      for (const text of parsed.doc[decision]) {
        const r = parsePermissionRule(text);
        if (!r) continue; // already warned inside parsePermissionsDocument
        rules.push({
          decision,
          tool: r.tool,
          ...(r.specifier !== undefined ? { specifier: r.specifier } : {}),
          source,
          text,
        });
      }
    }
    // Only adopt a scalar the source actually SET. `parsePermissionsDocument`
    // fills defaults, so asking the parsed doc would make every source look
    // like it set every scalar and destroy the precedence entirely.
    const setKeys = topLevelKeys(raw);
    if (resolvedDefault === undefined && setKeys.has('default')) resolvedDefault = parsed.doc.default;
    if (resolvedStreak === undefined && setKeys.has('denyStreak')) resolvedStreak = parsed.doc.denyStreak;
  }

  return {
    rules,
    default: resolvedDefault ?? 'allow',
    denyStreak: resolvedStreak ?? DEFAULT_DENY_STREAK,
    sources,
    warnings,
  };
}

/** Which top-level keys a raw document actually carries. Malformed ⇒ none. */
function topLevelKeys(raw: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set();
    return new Set(Object.keys(parsed as Record<string, unknown>));
  } catch {
    return new Set();
  }
}

/* ════════════════════════════════════════════════════════════ circuit breaker ═ */

/**
 * Codex's circuit breaker: stop after N consecutive denials.
 *
 * A streak is broken by any ALLOWED tool call, not by a successful one — a
 * denied `read_file` followed by a `read_file` that was allowed and then failed
 * on ENOENT is not a permissions problem, and counting it would trip the
 * breaker on an unrelated fault.
 */
export class PermissionCircuitBreaker {
  private streak = 0;

  constructor(private readonly limit: number) {}

  /** Feed one verdict. Returns true once the breaker has tripped. */
  record(decision: PermissionDecision): boolean {
    if (decision === 'allow') this.streak = 0;
    else this.streak++;
    return this.tripped;
  }

  get tripped(): boolean {
    return this.limit > 0 && this.streak >= this.limit;
  }

  get consecutive(): number {
    return this.streak;
  }
}
