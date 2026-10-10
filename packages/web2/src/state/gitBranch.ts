/** The branch name from a `GET /api/git/status` body, or null: a non-git folder answers `{branch: '', notGit: true}`. */
export function branchFromStatus(body: unknown): string | null {
  const b = body as { branch?: unknown; notGit?: unknown } | null;
  if (!b || b.notGit === true) return null;
  return typeof b.branch === 'string' && b.branch !== '' ? b.branch : null;
}
