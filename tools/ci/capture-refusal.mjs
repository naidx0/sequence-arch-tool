/**
 * The fifth journey screen: the subject-less refusal as a person meets it.
 *
 * CARD-FREE BY CONSTRUCTION. The refusal is already on disk in session-6773 —
 * it was produced with zero provider calls — so this opens the app, selects that
 * conversation, and photographs it. No turn is sent.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';

/*
 * DERIVED, NOT TYPED. This held my own absolute home path — copied in when the
 * script came out of a scratchpad — and the release mirror refused the whole
 * tree over it: "a personal identifier" and "a private directory path", two
 * refusals in a file written hours earlier. The mirror is the only thing that
 * would ever have caught it, and it did on the first dry run after.
 */
const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(REPO, 'docs', 'journeys', 'img');
const PORT = 4173;
const base = `http://127.0.0.1:${PORT}`;

const build = await (await fetch(`${base}/api/build`)).json();
if (build.stale === true) throw new Error(`the app is stale: started ${build.startedAt}, built ${build.builtAt}`);
console.log(`[capture] app current — started ${build.startedAt}, built ${build.builtAt}`);

const chromium = await loadPlaywright();
const browser = await chromium.launch({ ...launchOptions(), executablePath: findChromium(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const row = page.locator('[data-testid="sessions-row"][data-id="session-6773"]').first();
  if ((await row.count()) === 0) throw new Error('session-6773 is not in the list');
  /* Only click if it is not already the open one: an active row is disabled, and
     the seat learned this the same way — a click that waits 30 s on an element
     that will never enable is not a failure to find the session. */
  if ((await row.getAttribute('data-active')) !== 'true') await row.click();
  await page.waitForTimeout(2500);

  const text = await page.locator('body').innerText();
  const has = (s) => text.includes(s);
  const checks = {
    'names what is missing': has('could not find a subject'),
    'says no file was named': has('names a file'),
    'says nothing points at the repo': has('points at the repository'),
    'remedy 1 — name a file': has('teach me jail.ts'),
    'remedy 2 — say it is this repo': has('in this repo'),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? 'ok  ' : 'MISS'} ${k}`);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, '5-subjectless-refusal.png') });
  console.log(`[capture] wrote ${path.join('docs/journeys/img', '5-subjectless-refusal.png')}`);
  fs.writeFileSync(
    path.join(OUT, '5-subjectless-refusal.json'),
    `${JSON.stringify({ startedAt: build.startedAt, builtAt: build.builtAt, session: 'session-6773', checks }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
