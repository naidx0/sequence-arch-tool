#!/usr/bin/env node
/**
 * THE JOURNEY PAGE'S SCREENS, PRODUCED BY THE REPOSITORY.
 *
 * `docs/journeys/teach-mode.md` described five screens in words because the
 * pane they were read in returns images inline rather than to disk. Words are
 * honest and unverifiable: a reader cannot check a transcription against a
 * screen they were never shown.
 *
 * This drives the RUNNING app with the same headless Chromium the e2e suite
 * uses, reopens a lesson that is already on disk, and writes the screens as
 * files. **No model call**: the lesson was taught earlier and its chart is
 * persisted, so this costs no card time and can run whenever.
 *
 *   node tools/ci/capture-journey.mjs [port] [sessionTitlePrefix]
 *   node tools/ci/capture-journey.mjs [port] [sessionTitlePrefix] --video
 *
 * Writes docs/journeys/img/<step>.png and docs/journeys/img/capture.json, the
 * sidecar carrying the build the screens came from — startedAt, builtAt and the
 * commit — because a screenshot with no build behind it is the same claim the
 * stale-server check exists to stop.
 *
 * ── --video ───────────────────────────────────────────────────────────────
 *
 * Records the same journey to `docs/journeys/teach-mode.webm` for launch
 * material: reopen the lesson, read down the reply, open the AI Canvas, rest on
 * the chart. Still no model call — it is the same persisted lesson.
 *
 * The pacing is deliberate and it is the whole difference between a recording
 * and a screen capture. A script that clicks as fast as Playwright allows
 * produces eight seconds of flicker that nobody can follow; the waits below are
 * sized for a human eye and add up to the 30-60 s the material needs.
 *
 * Its length is MEASURED with ffprobe, not inferred from the script's own wall
 * clock. Those two disagree — the encoder writes what it captured, not what the
 * script thought it was doing — and the sidecar records which one it is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'docs', 'journeys', 'img');
const VIDEO_DIR = path.join(REPO, 'docs', 'journeys');
const VIDEO_FILE = path.join(VIDEO_DIR, 'teach-mode.webm');

const argv = process.argv.slice(2);
const VIDEO = argv.includes('--video');
const positional = argv.filter((a) => !a.startsWith('--'));
const port = Number(positional[0] ?? 4173);
const sessionPrefix = positional[1] ?? 'Teach me how brief.ts';
const base = `http://127.0.0.1:${port}`;
const VIEWPORT = { width: 1280, height: 820 };

const log = (...a) => console.log('[capture]', ...a);

/* The build these screens came from. A capture that cannot say what it shows is
   worth no more than a description of it. */
async function buildStamp() {
  const res = await fetch(`${base}/api/build`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`no /api/build on ${base} — is the app running and current?`);
  return res.json();
}

/** The video's real duration, from the file, or null when ffprobe is absent. */
function probeSeconds(file) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { encoding: 'utf8' },
    ).trim();
    const n = Number(out);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
  } catch {
    /* Null, not the script's own elapsed time. Reporting the wall clock as the
       duration would be a measurement of the wrong thing wearing the right
       label — and the sidecar would carry no sign that it had happened. */
    return null;
  }
}

const chromium = await loadPlaywright();
const executablePath = findChromium();
if (!chromium || !executablePath) {
  log('SKIP: no headless Chromium available');
  process.exitCode = 0;
} else {
  const stamp = await buildStamp();
  if (stamp.stale) throw new Error('the running app is older than the built code — restart it first');
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ ...launchOptions(), executablePath, headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    ...(VIDEO ? { recordVideo: { dir: path.join(VIDEO_DIR, '.rec'), size: VIEWPORT } } : {}),
  });
  const page = await context.newPage();
  const shots = [];
  const shoot = async (step, note) => {
    const file = path.join(OUT, `${step}.png`);
    await page.screenshot({ path: file });
    const { size } = fs.statSync(file);
    shots.push({ step, file: path.relative(REPO, file).split(path.sep).join('/'), bytes: size, note });
    log(`${step}.png  ${size} bytes  — ${note}`);
  };

  /** Open the lesson that is already on disk, the way a person does. */
  async function openLesson() {
    await page.goto(base, { waitUntil: 'networkidle' });
    /*
     * BY ID, NOT BY TITLE — the third instance of one defect.
     *
     * Several sessions share the ask, so `has-text(...).first()` opened the
     * topmost of them, which has no chart, and the capture silently produced two
     * screens instead of four with "no chart pointer in this session". The seat
     * and the replay were fixed for this on 2026-09-06; this script was not, and
     * nothing connected them until it failed the same way.
     *
     * The session wanted is the one whose `canvas.json` holds a chart — the same
     * rule the replay uses — and the row carries `data-id`.
     */
    const withChart = (() => {
      const dir = path.join(REPO, '.sequence', 'sessions');
      if (!fs.existsSync(dir)) return null;
      for (const id of fs.readdirSync(dir)) {
        const f = path.join(dir, id, 'canvas.json');
        if (!fs.existsSync(f)) continue;
        try {
          if ((JSON.parse(fs.readFileSync(f, 'utf8')).charts ?? []).length > 0) return id;
        } catch {
          /* not this one */
        }
      }
      return null;
    })();
    if (withChart !== null) log(`opening ${withChart} — the session whose canvas.json holds a chart`);
    const row =
      withChart === null
        ? page.locator(`button:has-text("${sessionPrefix}")`).first()
        : page.locator(`[data-testid="sessions-row"][data-id="${withChart}"]`).first();
    await row.waitFor({ timeout: 15_000 });
    /* THE ACTIVE SESSION'S ROW IS DISABLED, which is correct -- there is nowhere
       to navigate to -- and a blind click waits thirty seconds for an element
       that will never enable. Click only when it is a session to switch TO. */
    const alreadyOpen = (await row.getAttribute('data-active')) === 'true';
    if (!alreadyOpen) await row.click();
    else log('session already active — no click needed');
  }

  const startedMs = Date.now();
  try {
    if (!VIDEO) {
      await openLesson();
      await page.waitForTimeout(1200);
      await shoot('1-lesson', 'the reply, its edge count, and the closing check-in');

      /* The mode menu, where Teach lives. */
      await page.locator('.permsel').first().click();
      await page.waitForTimeout(400);
      await shoot('2-mode-menu', 'one menu, Teach as its first row');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      /* The pointer, and what it opens. */
      const pointer = page.getByTestId('chat-chart-pointer').first();
      if ((await pointer.count()) > 0) {
        await shoot('3-chart-pointer', 'the one line in the chat that names the picture');
        await pointer.click();
        await page.waitForTimeout(1200);
        await shoot('4-ai-canvas', 'the derived chart on the AI Canvas');
      } else {
        log('NOTE: no chart pointer in this session — steps 3 and 4 skipped');
      }
    } else {
      /*
       * THE RECORDED TIMELINE. Four beats, paced for a viewer rather than for a
       * test runner, totalling roughly forty-five seconds. The first cut measured 29.16 s and tripped
       * the range warning below, which is what that warning is for.
       */
      await openLesson();
      await page.waitForTimeout(4500); // 1. land, and let the reader see where they are
      log('beat 1 — the lesson, reopened');

      /*
       * 2. Read DOWN the reply — which means going to the TOP of it first.
       *
       * The first cut did not. It scrolled DOWN from where the app opens, and
       * the app opens a restored session pinned to the BOTTOM of the transcript
       * (scrollTop 826 of 826), so thirteen seconds of the recording were a
       * single frozen frame while the log cheerfully printed "read down the
       * reply". Two bugs, one symptom: the selector `.chat-transcript` matches
       * nothing — the element is `.transcript` — so it had also silently fallen
       * back to `body`, which does not scroll at all.
       *
       * Found by pulling frames out of the finished file and looking at them.
       * Nothing in the run said anything was wrong, which is the whole reason
       * this repository does not accept a green log as evidence about pixels.
       */
      const scroller = page.locator('.transcript').first();
      const heightOf = () =>
        scroller.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));

      await scroller.evaluate((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(2500); // the top of the reply, held long enough to start reading
      const atTop = await heightOf();

      /* Many small steps rather than one jump: a single scrollIntoView teleports
         and the viewer loses their place, the same reason the product animates a
         flow rather than cutting to it. Sized to reach the bottom in ~13 s. */
      const STEPS = 13;
      const step = Math.max(40, Math.ceil(atTop.max / STEPS));
      for (let i = 0; i < STEPS; i += 1) {
        await scroller.evaluate((el, by) => el.scrollBy({ top: by, behavior: 'smooth' }), step);
        await page.waitForTimeout(950);
      }
      const atEnd = await heightOf();

      /*
       * THE CHECK THAT MAKES THE BEAT REAL. A recording whose scroll silently
       * did nothing looks exactly like one that worked, from the log.
       */
      if (atEnd.top - atTop.top < 100) {
        log(`WARNING: the reply did not scroll (${atTop.top} -> ${atEnd.top} of ${atEnd.max}) — the recording has a dead beat`);
      } else {
        log(`beat 2 — read down the reply (${atTop.top} -> ${atEnd.top} of ${atEnd.max})`);
      }
      await page.waitForTimeout(1500);

      /* 3. The one line in the chat that names the picture, then open it. */
      const pointer = page.getByTestId('chat-chart-pointer').first();
      if ((await pointer.count()) > 0) {
        await pointer.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(2500);
        await pointer.click();
        log('beat 3 — opened the AI Canvas');
      } else {
        log('NOTE: no chart pointer in this session — the canvas beat is missing');
      }

      /* 4. REST on the chart. The point of the whole recording is the picture,
         and a viewer needs time to read four labels and their arrows. */
      await page.waitForTimeout(15_000);
      log('beat 4 — rested on the chart');
    }
  } finally {
    /* The video is only flushed when the CONTEXT closes, not the page. */
    await context.close();
    await browser.close();
  }
  const elapsed = (Date.now() - startedMs) / 1000;

  let video = null;
  if (VIDEO) {
    const rec = path.join(VIDEO_DIR, '.rec');
    const produced = fs
      .readdirSync(rec)
      .filter((f) => f.endsWith('.webm'))
      .map((f) => path.join(rec, f));
    if (produced.length === 0) {
      log('NOTE: Chromium produced no video file');
    } else {
      fs.rmSync(VIDEO_FILE, { force: true });
      fs.renameSync(produced[0], VIDEO_FILE);
      fs.rmSync(rec, { recursive: true, force: true });
      const bytes = fs.statSync(VIDEO_FILE).size;
      const seconds = probeSeconds(VIDEO_FILE);
      video = {
        file: path.relative(REPO, VIDEO_FILE).split(path.sep).join('/'),
        bytes,
        seconds,
        secondsMeasuredBy: seconds === null ? null : 'ffprobe',
        scriptElapsedSeconds: Number(elapsed.toFixed(2)),
        size: VIEWPORT,
      };
      log(`teach-mode.webm  ${(bytes / 1024).toFixed(0)} KB  ${seconds ?? '?'}s (ffprobe), script ran ${elapsed.toFixed(1)}s`);
      if (seconds !== null && (seconds < 30 || seconds > 60)) {
        log(`WARNING: ${seconds}s is outside the 30-60 s the launch material asks for`);
      }
    }
  }

  const commit = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
  const sidecarPath = path.join(VIDEO ? VIDEO_DIR : OUT, VIDEO ? 'teach-mode.webm.json' : 'capture.json');
  const sidecar = {
    capturedAt: new Date().toISOString(),
    commit,
    build: { startedAt: stamp.startedAt, builtAt: stamp.builtAt },
    viewport: VIEWPORT,
    port,
    session: sessionPrefix,
    modelCallsMade: 0,
    ...(VIDEO ? { video } : { shots }),
  };
  fs.writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  log(
    VIDEO
      ? `wrote the recording + ${path.basename(sidecarPath)} at commit ${commit}`
      : `wrote ${shots.length} screens + capture.json at commit ${commit}`,
  );
}
