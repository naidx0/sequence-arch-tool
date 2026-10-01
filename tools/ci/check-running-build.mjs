#!/usr/bin/env node
/**
 * IS THE RUNNING APP THE ONE WE JUST BUILT?
 *
 * A day-old `sequence app` served 4173 while the derived visual, the reasoning
 * narrowing and the one-assembly teach turn all sat in `dist` unrun. A person
 * opened the product, waited two minutes for a turn that wrote no lesson and
 * drew no chart, and every one of those defects was already fixed. Nobody
 * noticed because the seat reads ran against a separately-started instance.
 *
 *   node tools/ci/check-running-build.mjs [port...]
 *
 * Exits 1 when a server is running code older than what is on disk. Exits 0
 * when every port checked is current OR nothing is listening: a port with no
 * server is not a stale server, and failing on it would train people to ignore
 * this.
 */
const ports = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const targets = ports.length > 0 ? ports : [4173];

let stale = 0;
let checked = 0;

for (const port of targets) {
  let stamp;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/build`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      /* A server that answers but has no /api/build predates this check, which
         is itself the strongest possible evidence that it is stale. */
      console.log(`port ${port}: running, but has no /api/build — it predates this check. STALE`);
      stale += 1;
      checked += 1;
      continue;
    }
    stamp = await res.json();
  } catch {
    console.log(`port ${port}: nothing listening (not a failure)`);
    continue;
  }
  checked += 1;
  const age =
    stamp.builtAt === null
      ? 'unknown'
      : `${Math.round((Date.parse(stamp.builtAt) - Date.parse(stamp.startedAt)) / 1000)}s`;
  if (stamp.stale) {
    console.log(
      `port ${port}: STALE — started ${stamp.startedAt}, code built ${stamp.builtAt} (${age} newer). Restart it.`,
    );
    stale += 1;
  } else {
    console.log(`port ${port}: current — started ${stamp.startedAt}, built ${stamp.builtAt}`);
  }
}

/*
 * `process.exitCode`, NOT `process.exit()`.
 *
 * `process.exit()` after async work trips a libuv assertion on Windows --
 * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" -- exit 127 with the
 * real output already printed. That defect was found in cli.js and fixed there
 * tonight, and I reintroduced it here in a brand new file within the hour.
 * Setting the code and returning lets the loop close its own handles.
 */
if (stale > 0) {
  console.log(`\n${stale} of ${checked} running server(s) are older than the built code.`);
  process.exitCode = 1;
}
