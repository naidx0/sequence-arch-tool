/* ══════════════════════════════════════════════════════════════════════════
   HOW TO INVOKE pnpm ON THIS PLATFORM
   packages/desktop/scripts/pnpm-invocation.mjs

   Its own module, and deliberately so: prepare-server.mjs assembles a bundle
   at import time, so a test that imported it to check one pure function would
   run packaging as a side effect.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * How to invoke pnpm on this platform.
 *
 * `execFileSync('pnpm', …)` died with `spawnSync pnpm ENOENT` on Windows,
 * which reads like "pnpm is not installed" and is not: on Windows pnpm is
 * `pnpm.cmd`, and since the fix for CVE-2024-27980 (Node 18.20 / 20.12 and
 * later) Node REFUSES to spawn a `.cmd` without a shell. So the one platform
 * `electron-builder.yml` targets with an NSIS installer was the one platform
 * that could not assemble the bundle that installer ships — and the error it
 * printed blamed the user's pnpm install.
 *
 * ── WHY WINDOWS GETS ONE STRING AND NOT AN ARGUMENT LIST ─────────────────
 *
 * Node's DEP0190: passing `args` alongside `shell: true` concatenates them
 * WITHOUT escaping, so the quoting is the caller's job whether it looks like
 * it or not. Returning the finished command line makes that explicit rather
 * than leaving a deprecated code path to do it invisibly.
 *
 * Quoting matters because the deploy target is an absolute path, and absolute
 * paths on Windows contain spaces more often than not (`C:\Users\First Last`).
 * Unquoted, `pnpm deploy` receives two arguments and writes the bundle
 * somewhere nobody asked for — a silently wrong output, which is worse than
 * the ENOENT this replaced.
 *
 * Pure and exported so the branch is testable without spawning anything — a
 * platform branch that can only be checked by being on that platform is a
 * branch that stays broken on the other one.
 */
export function pnpmInvocation(platform, args) {
  if (platform !== 'win32') return { command: 'pnpm', args, shell: false };
  const quote = (a) => (/[\s&|<>^"()%!]/.test(a) ? '"' + a.split('"').join('""') + '"' : a);
  return { command: ['pnpm', ...args.map(quote)].join(' '), args: [], shell: true };
}
