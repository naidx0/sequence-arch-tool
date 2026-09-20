#!/usr/bin/env node
/**
 * ITEM ZERO — is Enter pressed in the composer a send?
 *
 *   node tools/ci/enter-to-send.mjs [port]
 *
 * `docs/journeys/teach-mode.md` carries this under "Not verified, and not
 * claimed": *"Enter-to-send has not been pressed on this build by a second
 * reader. The code implements Enter → send and Shift+Enter → newline with an IME
 * guard, and tests assert it; the one manual attempt was against a day-old
 * server."*
 *
 * A test asserting a keydown handler and a key actually sending a turn are two
 * different claims. This presses the key on the running app and reports which
 * one is true, so the journey page can stop hedging or keep hedging for a
 * reason.
 *
 * ONE TURN. It costs a model call, so it holds the card and says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const port = Number(process.argv[2] ?? 4173);
const base = `http://127.0.0.1:${port}`;
const ASK = 'In one sentence, what does bigram_counts.py do?';
const log = (...a) => console.log('[enter]', ...a);

const stamp = await (await fetch(`${base}/api/build`)).json();
if (stamp.stale) {
  console.error('enter-to-send: REFUSED — the app is older than its code. Run `pnpm restart:app`.');
  process.exit(2);
}
const commit = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
log(`app on ${port} current — started ${stamp.startedAt}, built ${stamp.builtAt}, tree ${commit}`);

const chromium = await loadPlaywright();
const browser = await chromium.launch({ ...launchOptions(), executablePath: findChromium(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const OUT = path.join(REPO, 'docs', 'journeys', 'seat');
fs.mkdirSync(OUT, { recursive: true });

const state = () =>
  page.evaluate(() => ({
    replies: document.querySelectorAll('[data-testid="chat-prose"]').length,
    streaming: document.querySelectorAll('[data-testid="chat-prose"][data-streaming]').length,
    box: document.querySelector('textarea')?.value ?? null,
  }));

let result = { shiftEnterKeptTyping: null, enterSent: null, ms: null, replyChars: null };
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const newChat = page.locator('button:has-text("New chat")').first();
  if ((await newChat.count()) > 0) await newChat.click();
  await page.waitForTimeout(1200);

  const box = page.locator('textarea').first();
  await box.click();

  /* SHIFT+ENTER FIRST, because the pair is the claim: a build where Enter sends
     but Shift+Enter also sends has not implemented "Enter to send", it has
     implemented "any Enter". */
  await box.type('one');
  await page.keyboard.press('Shift+Enter');
  await box.type('two');
  await page.waitForTimeout(400);
  const afterShift = await state();
  result.shiftEnterKeptTyping = afterShift.replies === 0 && (afterShift.box ?? '').includes('\n');
  log(`Shift+Enter: newline kept, nothing sent — ${result.shiftEnterKeptTyping ? 'yes' : 'NO'} (box: ${JSON.stringify(afterShift.box)})`);

  /* Clear, then the real question. */
  await box.fill(ASK);
  const before = await state();
  await page.screenshot({ path: path.join(OUT, 'enter-1-typed.png') });

  const t0 = Date.now();
  await page.keyboard.press('Enter');
  let s = before;
  while (Date.now() - t0 < 180_000) {
    await page.waitForTimeout(1000);
    s = await state();
    if (s.replies > before.replies && s.streaming === 0) break;
  }
  result.ms = Date.now() - t0;
  result.enterSent = s.replies > before.replies;
  result.replyChars = await page.evaluate(
    () => document.querySelectorAll('[data-testid="chat-prose"]')[0]?.textContent?.length ?? 0,
  );
  await page.screenshot({ path: path.join(OUT, 'enter-2-sent.png') });
  log(`Enter: sent the turn — ${result.enterSent ? 'yes' : 'NO'} (${(result.ms / 1000).toFixed(1)}s, reply ${result.replyChars} chars)`);
} finally {
  await browser.close();
}

fs.writeFileSync(
  path.join(OUT, 'enter-to-send.json'),
  `${JSON.stringify({ commit, build: stamp, port, ask: ASK, ...result }, null, 2)}\n`,
);
process.exitCode = result.enterSent && result.shiftEnterKeptTyping ? 0 : 1;
