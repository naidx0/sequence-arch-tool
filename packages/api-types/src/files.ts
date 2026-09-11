/**
 * Files & git — the `/api/file` and `/api/git/*` routes in `server/repoServer.ts`.
 *
 * Every caller-supplied path goes through the same two-part choke point: the
 * realpath jail (`resolveInRepo`) and the reserved-dir refusal (`.sequence`,
 * `.git`, `.ssh`, `.aws`, `.gnupg` — `reservedRoots()` at `:3782`).
 */

/* ---------------------------- GET /api/file — :1469 ----------------------- */

export interface GetFileQuery {
  /** Repo-relative. Absolute paths, `..`, and symlink escapes are all 403. */
  path: string;
}

/**
 * **Not JSON.** This route answers `text/plain; charset=utf-8` and the body IS
 * the file's UTF-8 content. A client must read it as text, not parse it.
 *
 * Failures are JSON: **403** escapes the repo root or is reserved · **404** file
 * not found · **400** the path is a directory · **413** over `MAX_FILE_BYTES`.
 */
export type GetFileResponse = string;

/* ---------------------------- PUT /api/file — :1510 ----------------------- */

export interface PutFileRequest {
  /** Repo-relative destination. Missing parent directories are created. */
  path: string;
  /** Full new content. This is a whole-file replace, not a patch. */
  content: string;
  /**
   * P10 — the session this write belongs to. Present ⇒ the write is registered
   * with that session's checkpoint store BEFORE it lands, capturing the file's
   * pre-write baseline the first time the session touches it. That is what
   * makes a later rewind able to put this file back.
   *
   * BEFORE, not after, and the ordering is the feature: registering afterwards
   * would record the NEW content as the baseline and make every rewind past the
   * first touch a silent no-op — the failure that looks exactly like the
   * feature working.
   *
   * Absent ⇒ byte-identical behaviour to every pre-P10 caller: nothing is
   * tracked and no checkpoint directory is created.
   */
  sessionId?: string;
}

/**
 * `path` is the repo-relative path the write actually landed on — recomputed from
 * the resolved absolute path, so it may be spelled differently from the request.
 *
 * **The graph is knowingly stale after this call.** The route clears the persisted
 * graph cache and does NOT re-scan (the `PUT /api/file` handler in `server/repoServer.ts`); nothing in the response
 * says so today. Wave 1 item 1.5 adds a `stale: true` marker here.
 */
export interface PutFileResponse {
  ok: true;
  path: string;
}

/**
 * Write refusals a client must render honestly, all `{ error }`:
 * **415** wrong content-type · **400** missing/non-string `path` or `content`, or
 * the path is a directory · **403** escapes the repo root, is reserved, or falls
 * outside the `program.md` "Agent may edit" allowlist · **409** a decision record
 * (`ADR-NNN-*.md`) already exists and is never overwritten.
 *
 * THREE NARROW HOLES in the reserved `.sequence/` root, and only these three
 * (the `.sequence/` allowlist in `server/repoServer.ts`) — each additionally requires the target be a regular
 * file with `nlink === 1`, so a hard link aliasing the stored API key is refused:
 *
 *  - `.sequence/decisions/*.md` — decision records and saved research briefs;
 *  - `.sequence/diagrams/*.seqd` — exported SeqDiagrams;
 *  - `.sequence/plans/*.md` — plan documents.
 *
 * `ai.json`, `spec.json` and the rest of platform memory stay unwritable.
 */
export type PutFileErrorResponse = { error: string };

/* ------------------------- GET /api/git/status — :3384 -------------------- */

export type GetGitStatusRequest = void;

/** One dirty file from `git status --porcelain`. */
export interface GitStatusFile {
  /** Repo-relative, forward-slashed (the destination for a rename). */
  path: string;
  /** Normalised word: added | modified | deleted | renamed | copied | untracked | conflicted | unknown. */
  status: string;
  /**
   * Is this change in the INDEX?
   *
   * Porcelain gives two letters per file — X for the index, Y for the working
   * tree — and the server collapsed them into `status` alone, so this wire
   * could not express "staged" and the Staged review scope listed the entire
   * dirty tree.
   *
   * OPTIONAL, because an older server does not send it. Absent means "not
   * told", which a client must treat as SHOW rather than hide: hiding a real
   * change because the server was old is a worse failure than showing one that
   * turns out to be unstaged.
   *
   * Both flags, because a file can be BOTH — stage a change, edit it again,
   * and git records `MM`.
   */
  staged?: boolean;
  /** Is there a change in the working tree that is not in the index? */
  unstaged?: boolean;
}

export interface GetGitStatusResponse {
  branch: string;
  files: GitStatusFile[];
}

/* -------------------------- GET /api/git/diff — :3396 --------------------- */

export interface GetGitDiffQuery {
  /** Repo-relative; required (an empty `?path` is a 400). */
  path: string;
}

export interface GetGitDiffResponse {
  path: string;
  /** Unified diff text. May be EMPTY for an untracked or unchanged file. */
  diff: string;
}

/* ------------------------- POST /api/git/commit — :3417 ------------------- */

export interface PostGitCommitRequest {
  message: string;
  /** Omitted ⇒ commit everything staged/dirty. Every entry must be a string. */
  paths?: string[];
}

/**
 * Success only. A failed commit is a **400** `{ error }` — `ok:false` never
 * reaches the wire, because the route unwraps `GitCommitResult` and turns a
 * falsy `ok` into `sendError`.
 */
export interface PostGitCommitResponse {
  ok: true;
  /** The new commit SHA. Absent when git reported success without one. */
  commit?: string;
}

/* ===================== P12 — branch + worktree handoff ===================== *
 *
 * Codex has `/worktree` → "create branch here" / "hand off"; before P12 the
 * server had no route that created a ref at all, so every branching decision
 * left the app. These four routes are the app doing the git.
 *
 * All four are repo-scoped (409 with no repo attached) and owner-gated, the
 * same stance as `/api/git/commit`. None of them takes a filesystem path from
 * the caller except the removal route, whose `path` must resolve inside the
 * worktrees root this server derived — see `POST /api/git/worktree`.
 */

/* ------------------------- POST /api/git/branch --------------------------- */

export interface PostGitBranchRequest {
  /**
   * The branch to create. Validated against git's ref rules BEFORE `git` is
   * spawned, so a flag-shaped name (`--upload-pack=…`) is a 400 rather than an
   * argument. A leading `-`, a space, `..`, `@{`, `~^:?*[`, a backslash, a
   * component starting with `.` or ending `.lock`, and a trailing `.` or `/`
   * are all refused.
   */
  name: string;
  /**
   * Optional start point — a SHA, tag or branch. Resolved with
   * `rev-parse --verify` first; the RESOLVED SHA is what reaches `git branch`.
   * Omitted ⇒ the branch starts at current HEAD.
   */
  from?: string;
}

/**
 * `head` is READ BACK from `git rev-parse refs/heads/<name>` after the branch
 * lands, not echoed from the request — the response states what the repository
 * is, not what was asked for. It is absent only when git created the branch and
 * then would not resolve it, which is an honest partial success.
 *
 * The attached checkout does NOT move: `git branch` never touches HEAD or the
 * working tree.
 *
 * Failures are `{ error }`: **400** bad name or unresolvable `from` ·
 * **409** the branch already exists · **500** git itself failed.
 */
export interface PostGitBranchResponse {
  ok: true;
  branch: string;
  head?: string;
}

/* ------------------------ GET /api/git/worktrees -------------------------- */

export type GetGitWorktreesRequest = void;

/** One working tree, parsed from `git worktree list --porcelain`. */
export interface GitWorktreeEntry {
  /** Absolute path git reports. */
  path: string;
  /** Short branch name, or `null` when detached or bare. */
  branch: string | null;
  /** The commit it is on, or `null` when bare. */
  head: string | null;
  bare: boolean;
  detached: boolean;
}

/**
 * Includes the MAIN checkout — git lists it first, and hiding it would make the
 * attached repo look like it was not a working tree.
 */
export interface GetGitWorktreesResponse {
  worktrees: GitWorktreeEntry[];
}

/* ------------------------ POST /api/git/worktree -------------------------- */

export interface PostGitWorktreeRequest {
  /** The branch to hand off. Created when absent, REUSED when it already exists. */
  branch: string;
  /** Optional start point, used only when the branch has to be created. */
  from?: string;
}

/**
 * WHERE THE TREE GOES IS NOT THE CALLER'S CHOICE, and that is a security
 * property rather than a limitation: the server derives
 * `<parent-of-repo>/<repo-name>-worktrees/<slug>` itself, so no filesystem path
 * crosses the wire inbound. `path` is the absolute directory that now exists —
 * a real checkout with a `.git` FILE pointing back at the main repo, sharing
 * one object store.
 *
 * `createdBranch` is reported honestly: `false` means the branch was already
 * there and this call joined it rather than starting it.
 *
 * Failures are `{ error }`: **400** bad branch name · **409** a directory is
 * already at that slug, or git refuses because the branch is checked out in
 * another tree · **500** git itself failed (the branch is rolled back when this
 * call had created it).
 */
export interface PostGitWorktreeResponse {
  ok: true;
  branch: string;
  path: string;
  createdBranch: boolean;
}

/* ----------------------- DELETE /api/git/worktree ------------------------- */

export interface DeleteGitWorktreeQuery {
  /**
   * Absolute path of the worktree to remove. TWO gates before anything is
   * deleted: it must resolve inside this repo's worktrees root (realpath on
   * both sides), and git's own `worktree list` must agree a working tree is
   * there. Anything else is a 403 or a 404 and nothing is touched.
   */
  path: string;
  /**
   * `'1'` to pass `--force`. Without it a worktree with uncommitted changes is
   * a **409** — `git worktree remove` deletes the directory, and silently
   * discarding another agent's work is not a thing this server does by default.
   */
  force?: string;
}

export interface DeleteGitWorktreeResponse {
  ok: true;
  /** The path that was removed. */
  path: string;
}
