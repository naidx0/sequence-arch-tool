/* ══════════════════════════════════════════════════════════════════════════
   THE REPOSITORY'S OWN INSTRUCTIONS
   packages/analyzer/src/explain/instructions.ts

   Every competitor reads a project instruction file — Claude Code has four
   memory scopes plus path-globbed rules, Codex and Cursor both read one from
   the repo root. Sequence read none. A team could write down "we use tabs",
   "never touch generated/", "the deploy story is in docs/deploy.md" and the
   assistant would answer the next question having seen none of it.

   THIS REPOSITORY IS ITS OWN BEST EXAMPLE: it carries `AGENTS.md` and
   `CLAUDE.md` at the root, both written to be read by an assistant, and
   nothing in the product ever opened either one.

   ── WHAT IT READS, AND IN WHAT ORDER ─────────────────────────────────────

   The conventional names, most specific first. `.sequence/instructions.md` is
   ours and wins because a file inside our own directory was written FOR this
   product; the others are shared with other tools and may say things aimed at
   them.

   ONLY ONE FILE IS USED. Concatenating four instruction files produces a
   prompt where two of them contradict each other and nothing says which wins —
   and the reader cannot see the merge to debug it. The one that was found is
   NAMED in the prompt, so the model can say where a rule came from and a user
   can go and edit the right file.

   ── AND IT IS BOUNDED ────────────────────────────────────────────────────

   An instruction file is hand-written and unbounded; a 200KB one would eat the
   context window that the actual question needs. The cap is generous enough
   for any real instruction file and small enough that a runaway one cannot
   crowd out the evidence — and when it bites, THE PROMPT SAYS SO, because
   silently truncating a user's rules is how the assistant appears to ignore
   half of them.

   PURE except for one `readFileSync`, which is the point of the module.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';

import { canonicalRoot, resolveInRepo } from '../server/jail.js';
import { isRepoTrusted } from '../server/repoTrust.js';

/**
 * Where to look, most specific first.
 *
 * `.sequence/instructions.md` is ours and wins: a file inside our own
 * directory was written for this product. The rest are shared with other
 * tools, and a repository carrying several of them has usually written the
 * same intent more than once rather than four different intents.
 */
export const INSTRUCTION_FILES = [
  '.sequence/instructions.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
] as const;

/** Bytes. Generous for any real instruction file; hard against a runaway one. */
export const INSTRUCTIONS_CAP_BYTES = 24_000;

export interface RepoInstructions {
  /** Repo-relative path of the file that was used. */
  file: string;
  text: string;
  /** True when the cap bit and the text is not the whole file. */
  truncated: boolean;
}

/**
 * The default path resolver: canonicalise the root, then jail the candidate.
 *
 * A root that cannot be realpath'd has no instructions — null is the honest
 * answer and matches the "most repositories have none" contract below, rather
 * than throwing at a caller who only asked whether a file existed.
 */
function jailedResolve(repoRoot: string, rel: string): string | null {
  let root: string;
  try {
    root = canonicalRoot(repoRoot);
  } catch {
    return null;
  }
  return resolveInRepo(root, rel);
}

/**
 * Find and read the repository's instruction file, or null.
 *
 * Null is a completely ordinary answer — most repositories have none — and it
 * is NOT a warning. A product that complained about a missing optional file
 * would train its users to ignore its warnings.
 */
export function readRepoInstructions(
  repoRoot: string,
  read: (p: string) => string = (p) => fs.readFileSync(p, 'utf8'),
  /**
   * How a candidate name becomes an absolute path, or null for "not available".
   *
   * THE DEFAULT IS THE JAIL, AND THAT IS THE SECURITY PROPERTY. This function's
   * output is rendered by `renderInstructionsSection` as *binding standing
   * instructions* for the model, so whatever it returns is trusted text. It used
   * to `path.join` and `readFileSync`, which FOLLOW a symlink — so a repository
   * committing `AGENTS.md -> /proc/self/environ` (or, on Windows, one pointed at
   * `~/.sequence/openrouter-key`) had up to INSTRUCTIONS_CAP_BYTES of whatever
   * that file holds injected into the prompt as its own rules, and shipped to
   * the provider. Key material out, attacker text in, from one committed link.
   *
   * `resolveInRepo` is the existing jail and already carries this lesson for
   * writes ("a repo can commit `notes.md -> /outside/pwned.txt`"); reads of a
   * trusted-text file need it just as much. It rejects lexical escapes, absolute
   * paths, NUL bytes, resolved symlink escapes AND dangling ones.
   *
   * Injectable only so the selection tests (precedence, cap, blank-skip) can run
   * against a fake filesystem. Production passes nothing and gets the jail.
   */
  resolve: (root: string, rel: string) => string | null = jailedResolve,
): RepoInstructions | null {
  for (const rel of INSTRUCTION_FILES) {
    const abs = resolve(repoRoot, rel);
    /* Escaped the repository — treat exactly like an absent file and try the
       next name. NOT an error the user sees: a hostile link is not a
       misconfiguration to report, and a warning here would only tell an
       attacker their probe was noticed. */
    if (abs === null) continue;
    let text: string;
    try {
      text = read(abs);
    } catch {
      /* Absent, unreadable, or a directory. Try the next name — an
         unreadable AGENTS.md must not stop CLAUDE.md being found. */
      continue;
    }
    if (typeof text !== 'string' || text.trim() === '') continue;

    if (text.length > INSTRUCTIONS_CAP_BYTES) {
      return { file: rel, text: text.slice(0, INSTRUCTIONS_CAP_BYTES), truncated: true };
    }
    return { file: rel, text, truncated: false };
  }
  return null;
}

/**
 * Render the instructions as prompt lines — THE MODEL PATH.
 *
 * ⚠ THIS FUNCTION MAKES REPOSITORY TEXT BINDING. Everything it returns is
 * presented to the model as the user's own standing orders. It performs NO
 * trust check of its own and must not be called from a request handler: the
 * only production caller is {@link renderTrustedInstructionsSection}, which
 * asks the trust question first. `repo-trust.test.ts` asserts that
 * `server/repoServer.ts` never calls this name directly, because the way this
 * boundary comes back is somebody wiring a third `/api/…` route straight to
 * the renderer the way the two existing ones were.
 *
 * THE FILE IS NAMED. A model that can say "your AGENTS.md says X" gives the
 * user somewhere to go and edit; one that just asserts X leaves them guessing
 * which of their files it came from — or whether it was invented.
 *
 * AND THE TRUNCATION IS DECLARED. Silently cutting a user's rules in half is
 * how an assistant appears to ignore the second half of them, and the user has
 * no way to see it from the outside.
 */
export function renderInstructionsSection(
  instructions: RepoInstructions | null,
): string[] {
  if (!instructions) return [];
  const lines = [
    `--- PROJECT INSTRUCTIONS (${instructions.file}; the user's own rules for this repository) ---`,
    /* Stated as binding, because that is what the file is for — but ranked
       BELOW the grounded evidence, since an instruction file is a statement of
       intent and the graph is a measurement of fact. Where they disagree, the
       code is what is true. */
    'These are the standing instructions for this repository. Follow them unless the code contradicts them, and say so when it does.',
    '',
    instructions.text.trim(),
  ];
  if (instructions.truncated) {
    lines.push('');
    lines.push(
      `[This file is longer than ${INSTRUCTIONS_CAP_BYTES} characters and was cut here. Say so if the answer depends on what follows.]`,
    );
  }
  return lines;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE TRUST GATE — the two paths this text can take, named

   A repository's instruction file has TWO destinations and they are not the
   same thing:

     THE MODEL PATH   — the text becomes binding standing instruction inside
                        the prompt. Requires trust. This is the hole that was
                        open: attaching a repo was enough, and a repository you
                        cloned to look at could give the assistant its orders
                        on the first question.

     THE SURFACE PATH — the text is shown to the PERSON as content, so they can
                        read what the repo is asking for and decide. Requires
                        nothing; it is just a file being displayed.

   Silently dropping the text would be the wrong fix. A user who cannot see
   what the repository asked for cannot make the decision, and an assistant
   that quietly behaves differently with no explanation is the failure mode
   `docs/vision.md` §5 calls out by name. So: not fed, but shown.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE MODEL PATH. The repository's instructions as binding prompt lines —
 * empty unless the user has explicitly trusted this repository root.
 *
 * Every `/api/…` handler that builds a prompt calls THIS, never
 * {@link renderInstructionsSection}. `null` repoRoot (design mode, no repo
 * attached) is [] for the reason the call sites already documented: having no
 * repository is having no instructions.
 *
 * `isTrusted` is injectable ONLY so a lock test can drive both sides of the
 * gate without writing the real user store; production passes nothing and gets
 * {@link isRepoTrusted}, which reads the user-level store and defaults to
 * false for every uncertain case.
 */
export function renderTrustedInstructionsSection(
  repoRoot: string | null,
  isTrusted: (root: string) => boolean = (root) => isRepoTrusted(root),
): string[] {
  if (repoRoot === null) return [];
  if (!isTrusted(repoRoot)) return [];
  return renderInstructionsSection(readRepoInstructions(repoRoot));
}

/** What the SURFACE is told about a repository's instruction file. */
export interface RepoInstructionsDisclosure {
  /** True when the user has trusted this root — i.e. the model IS being given the text. */
  trusted: boolean;
  /** The file that was found and its text, or null when the repo has none. */
  instructions: RepoInstructions | null;
}

/**
 * THE SURFACE PATH. What the repository is asking for, as DATA — read whether
 * or not the repo is trusted, and never rendered as instruction.
 *
 * This is what the trust moment in the UI shows: the file's name and its own
 * words, so the decision is made by somebody who has seen it. Served by
 * `GET /api/repo-trust`.
 */
export function describeRepoInstructions(
  repoRoot: string | null,
  isTrusted: (root: string) => boolean = (root) => isRepoTrusted(root),
): RepoInstructionsDisclosure {
  if (repoRoot === null) return { trusted: false, instructions: null };
  return { trusted: isTrusted(repoRoot), instructions: readRepoInstructions(repoRoot) };
}
