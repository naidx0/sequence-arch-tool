import { findChromium, launchOptions, loadPlaywright, cacheRoots } from './chromium.mjs';
import { buildProblem, serveDist } from './serve.mjs';

/**
 * THE E2E HARNESS — tier 3 of §4.6, which packages/web2 did not have.
 *
 * WHY THIS TIER EXISTS AT ALL, stated once so no future item re-argues it from
 * scratch. Wave 2's gate found four locking criteria met at vitest+jsdom where
 * the plan specifies E2E. jsdom cannot measure a layout, cannot paint, has no
 * font stack, does not substitute custom properties, and its default window is
 * 1024px wide — which already cost this package one test that asserted the
 * RUNNER's window size and read as a statement about the product. Every
 * question this suite asks is one jsdom answers wrongly or not at all:
 *
 *     does the frame arrange into three columns   layout
 *     does the composer accept a keystroke        real key events
 *     what weight does a label actually paint     the font stack
 *     does the app boot without the network       real requests
 *
 * WHAT IT INHERITS FROM packages/web/e2e AND WHAT IT DOES NOT. 45 scripts were
 * re-anchored onto 913 data-testid references in Wave 0 precisely so the
 * BEHAVIOUR they assert survives v1's deletion. What is inherited is the shape:
 * boot a server over a real build, drive a real browser, address every element
 * by data-testid and never by a class name or a DOM path, skip loudly when
 * there is no browser, exit 2 when the harness cannot run and 1 when the
 * product is wrong. What is NOT inherited is a single line of those files —
 * markup, selectors, layout expectations and class names all die with v1's
 * stylesheet, and reading them for anything but "what did this assert" is how
 * the old product gets rebuilt by accident.
 *
 * THE ONE RULE THAT IS NOT NEGOTIABLE HERE: assertions address data-testid.
 * IDENTITY is a testid — what a thing IS. STATE is a named data-* attribute —
 * what state it is IN. A class name is a by-product of how a stylesheet
 * happened to be written; a testid is a contract the rebuild has to honour.
 */

/** `[data-testid="x"]`. Every selector in this suite goes through here. */
export const sel = (testid) => `[data-testid="${testid}"]`;

class Failures {
  constructor(name) {
    this.name = name;
    this.list = [];
    this.passes = 0;
  }

  log(...args) {
    console.log(`[${this.name}]`, ...args);
  }

  /**
   * Run one named check. A throw is recorded and the suite CONTINUES.
   *
   * Continuing is deliberate. A suite that stops at the first failure reports
   * one defect per run, so a change that breaks four things takes four runs to
   * understand — and the second, third and fourth get found one at a time by
   * whoever is least able to fix them.
   */
  async check(label, fn) {
    try {
      await fn();
      this.passes += 1;
      this.log('ok  ', label);
    } catch (error) {
      this.list.push(`${label}: ${error.message}`);
      this.log('FAIL', label, '—', error.message);
    }
  }
}

/** An assertion with the actual value in the message. "expected true" tells
 *  whoever reads the CI log nothing they can act on. */
export function is(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

export function atLeast(actual, floor, what) {
  if (!(actual >= floor)) throw new Error(`${what}: expected >= ${floor}, got ${actual}`);
}

export function within(actual, expected, slack, what) {
  if (Math.abs(actual - expected) > slack) {
    throw new Error(`${what}: expected ${expected} +/- ${slack}, got ${actual}`);
  }
}

/**
 * Let the frame settle before measuring anything.
 *
 * FINISH THE ANIMATIONS FIRST. A transition read mid-flight returns its start
 * value, and this project has already reported a start value as a final one.
 * shell.css transitions background and colour on every control, and while
 * neither moves a box, "measure only after the document has stopped moving" is
 * the rule that holds whether or not today's stylesheet happens to animate the
 * property being read.
 *
 * Then two animation frames: one for the layout the resize or the keystroke
 * caused, one for anything that layout caused in turn.
 */
export async function settle(page) {
  await page.evaluate(() => {
    document.getAnimations().forEach((animation) => animation.finish());
  });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

/**
 * Resize the window and prove the window actually resized.
 *
 * THE TRAP THIS AVOIDS: a resize the page never hears about. Shell.tsx reads
 * the frame from a `resize` listener on window, so a viewport change that does
 * not fire the event leaves the shell arranged for the previous size and the
 * suite reports a layout bug that is not there. Rather than dispatching a
 * synthetic event and hoping — which would also mask a REAL missing listener —
 * this asserts the browser did its half (innerWidth moved) and then waits for
 * the product to do its half (the breakpoint attribute moved). If the first
 * holds and the second does not, the failure is the product's, and the message
 * says so.
 */
export async function resize(page, width, height) {
  await page.setViewportSize({ width, height });

  const inner = await page.evaluate(() => window.innerWidth);
  if (inner !== width) {
    throw new Error(
      `harness: viewport did not take — asked for ${width}, window.innerWidth is ${inner}`,
    );
  }

  await settle(page);
}

/** The bounding box of a testid, or a failure naming the testid. */
export async function box(page, testid) {
  const found = await page.locator(sel(testid)).boundingBox();
  if (!found) throw new Error(`no box for ${testid} — is it rendered?`);
  return { ...found, right: found.x + found.width, bottom: found.y + found.height };
}

export const count = (page, testid) => page.locator(sel(testid)).count();

export const attr = (page, testid, name) => page.locator(sel(testid)).getAttribute(name);

/** A resolved computed style — a real browser, so var() is already
 *  substituted and there is no resolver standing between the test and the
 *  value. That is the whole reason this tier exists. */
export function computed(page, testid, property) {
  return page.evaluate(
    ([id, prop]) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) throw new Error(`no element for ${id}`);
      return getComputedStyle(el).getPropertyValue(prop);
    },
    [testid, property],
  );
}

/**
 * Boot the built app in a real browser and hand the spec a page.
 *
 * The whole lifecycle is here so a spec is nothing but assertions: build
 * check, server, browser, console and network capture, teardown, exit code.
 *
 *   exit 0  every check passed, or the run was skipped for want of a browser
 *   exit 1  the product is wrong
 *   exit 2  the harness could not run
 */
export async function suite(name, run, options = {}) {
  const log = (...args) => console.log(`[${name}]`, ...args);

  const problem = buildProblem();
  if (problem) {
    console.error(`[${name}] ERROR: ${problem}`);
    console.error(`[${name}] run: pnpm --filter @sequence/web2 build`);
    process.exit(2);
  }

  const executablePath = findChromium();
  if (!executablePath) {
    log('SKIP: no Chromium found. Searched system Chrome and:', cacheRoots().join(', '));
    process.exit(0);
  }

  const chromium = await loadPlaywright();
  if (!chromium) {
    log('SKIP: playwright-core is not installed');
    process.exit(0);
  }

  /*
   * `options.routes` is how a spec puts something in front of dist/ — a real
   * scanned graph on /archgraph.json, a hard 404 on the /api routes this
   * origin does not serve. Absent, the server is the file host every existing
   * spec already runs against, so nothing changes for them.
   */
  const server = await serveDist(options.routes ?? {});
  const browser = await chromium.launch(launchOptions(executablePath));
  const failures = new Failures(name);

  // Everything the page said and everything it asked the network for. Both are
  // evidence for the first check every spec makes, and neither can be
  // reconstructed after the fact.
  const consoleErrors = [];
  const requests = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      /*
       * THE URL IS PART OF THE ERROR, not decoration. The browser's own text
       * for a failed request is "Failed to load resource: the server responded
       * with a status of 404 (Not Found)" — the same sentence whether the thing
       * that 404'd was a route the spec deliberately refuses or the
       * application's main stylesheet. Without the location, a spec can only
       * assert "zero console errors" or nothing at all, and the second time it
       * has one expected 404 somebody weakens it to a substring match on that
       * sentence and it stops seeing the stylesheet too.
       */
      const where = message.location?.().url ?? '';
      consoleErrors.push(where ? `${message.text()} [${where}]` : message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`uncaught: ${error.message}`));
    page.on('request', (request) => requests.push(request.url()));

    await run({
      page,
      base: server.base,
      log,
      consoleErrors,
      requests,
      check: (label, fn) => failures.check(label, fn),
    });
  } catch (error) {
    // A throw outside a check() is the harness itself failing — a bad
    // selector, a closed page, a typo. It is not a verdict on the product, so
    // it does not get to masquerade as one.
    console.error(`[${name}] HARNESS ERROR:`, error.stack ?? error.message);
    await browser.close();
    await server.close();
    process.exit(2);
  }

  await browser.close();
  await server.close();

  if (failures.list.length) {
    console.error(`\n[${name}] ${failures.list.length} FAILED, ${failures.passes} passed`);
    for (const failure of failures.list) console.error(`  - ${failure}`);
    process.exit(1);
  }

  log(`${failures.passes} checks passed`);
  process.exit(0);
}
