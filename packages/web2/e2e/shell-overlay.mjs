#!/usr/bin/env node
/**
 * THE OVERLAY LOCK — "Open a repository" opens a repository.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS SPEC EXISTS, AND WHY IT IS NOT A vitest FILE.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `src/canvas/Board.test.tsx:315` asserted this behaviour like this:
 *
 *     act.click();
 *     expect(store.getState().shell.overlay).toEqual({ kind: 'attach' });
 *
 * That is an assertion that A DISPATCH LANDED. It was green for a whole wave
 * while the button it describes opened NOTHING in a real browser, because two
 * independent things stood between the action and a dialog: `app/App.tsx`
 * passed no `renderOverlay`, and `Shell.tsx` guarded its overlay host on
 * `shell.overlay && renderOverlay`. Both halves of that guard could be false
 * forever and the expression above would still pass.
 *
 * CANON §6 names the failure mode — "assert the invariant, not the
 * expression". The invariant is A DIALOG IS ON SCREEN. The honest form of that
 * is a click in a real engine against the shipped bundle, which is this file.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE ROUTE TABLE IS FOR, AND WHAT IS NOT INVENTED IN IT.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `runBoot`'s first rung is `GET /api/status`. `{ attached: false }` is the
 * answer a real engine gives when it is running and holds no repository, and it
 * is the ONE outcome whose surface offers the attach action rather than a
 * retry — so it is the origin this spec has to stand up in order to reach the
 * button at all. Everything else is either an honest empty answer
 * (`/api/recent` → no recents) or a hard 404 for a route this origin genuinely
 * does not serve.
 *
 * `/api/browse` answers with THIS MONOREPO'S OWN `packages/` DIRECTORY, read
 * off disk at run time. It is a real listing of real folders, for the same
 * reason `board-grounded.mjs` scans rather than fixtures: a hand-written
 * listing is a listing that can be made to satisfy any dialog, including a
 * wrong one, and this project's first non-negotiable is that what reaches the
 * screen is real.
 */
import fs from 'node:fs';
import path from 'node:path';

import { ATTACH, BOOT, SHELL } from './lib/anchors.mjs';
import { atLeast, box, count, attr, is, sel, settle, suite } from './lib/harness.mjs';
import { WEB2 } from './lib/serve.mjs';

const PACKAGES = path.resolve(WEB2, '..');

/** The real sub-directories of packages/, in the shape GET /api/browse returns. */
function realBrowseListing() {
  const entries = fs
    .readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => {
      const full = path.join(PACKAGES, entry.name);
      return {
        name: entry.name,
        path: full,
        isRepo: fs.existsSync(path.join(full, 'package.json')),
        hasChildren: fs
          .readdirSync(full, { withFileTypes: true })
          .some((child) => child.isDirectory()),
      };
    });

  return { root: PACKAGES, path: PACKAGES, parent: null, entries };
}

const routes = {
  /* The engine is up and holds nothing. `runBoot` rung 1 → outcome
     'unattached' → the surface whose one action is "Open a repository". */
  '/api/status': { attached: false },
  '/api/recent': { recent: [] },
  '/api/browse': realBrowseListing(),
  /* Never reached from 'unattached', and a 404 is the truth for a route this
     origin does not serve. Listed rather than left to the SPA fallback, which
     would answer index.html with a 200. */
  '/archgraph.json': null,
  '/api/attach': null,
};

await suite(
  'shell-overlay',
  async ({ page, base, check, consoleErrors }) => {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector(sel(SHELL.root), { timeout: 15000 });
    /*
     * THE DOOR MOVED, AND THE SPEC MOVED WITH IT. The BootSurface third pane
     * was retired from the unattached flow (Transcript.tsx: "same attach door
     * as the appbar — no BootSurface third pane"; the 760w no-board boot). An
     * unattached origin now boots the SHELL, and the one attach door on screen
     * is the appbar's own repo button reading "Open a repository". The
     * INVARIANT below is unchanged — the click puts a real dialog on screen,
     * hosted by the shell's overlay — only the door is the shipped one.
     */
    await page.waitForSelector('[data-testid="shell-repo"]', { timeout: 15000 });
    await settle(page);

    /* ── The precondition, asserted rather than assumed ─────────────────── */

    await check('the appbar offers the attach door, and no dialog is open yet', async () => {
      is(
        (await page.locator('[data-testid="shell-repo"]').textContent())?.trim(),
        'Open a repository',
        'the one attach door on an unattached origin',
      );
      is(await count(page, ATTACH.root), 0, 'attach dialogs before the click');
    });

    /* ── THE INVARIANT ──────────────────────────────────────────────────── */

    /**
     * A DIALOG IS ON SCREEN. Not "a dispatch landed", not "state changed" — a
     * box with a non-zero area, inside the viewport, that a user could click.
     * In-DOM is not on-screen and this project has already shipped the
     * difference: `board-grounded.mjs` carries the same pairing for the same
     * reason.
     */
    await check('clicking it puts an attach dialog ON SCREEN', async () => {
      await page.locator('[data-testid="shell-repo"]').click();
      await settle(page);

      atLeast(await count(page, ATTACH.root), 1, `${ATTACH.root} after the click`);

      const dialog = await box(page, ATTACH.root);
      const viewport = page.viewportSize();
      atLeast(dialog.width, 1, 'attach dialog painted width');
      atLeast(dialog.height, 1, 'attach dialog painted height');
      atLeast(dialog.x + dialog.width, 1, 'attach dialog reaches the left edge of the viewport');
      atLeast(viewport.width - dialog.x, 1, 'attach dialog starts inside the viewport');
      atLeast(viewport.height - dialog.y, 1, 'attach dialog top is inside the viewport');

      is(
        await page.locator(sel(ATTACH.root)).getAttribute('role'),
        'dialog',
        'the attach surface reports itself as a dialog',
      );
    });

    /**
     * ONE dialog, and it is hosted by the SHELL.
     *
     * This is the half that separates the root fix from the symptom fix.
     * `BootSurface` can host an attach dialog itself — it does exactly that
     * when no `onOpenAttach` is supplied — so "a dialog appeared" alone would
     * also pass if the boot surface had simply been left to open its own,
     * leaving `shell.overlay` a slice nothing reads and the second copy of
     * shell state exactly where it was. The board's empty state and the boot
     * surface must reach ONE host, and the host is the shell's overlay.
     */
    await check('exactly one dialog, and the shell is the thing hosting it', async () => {
      is(await count(page, ATTACH.root), 1, 'attach dialog count');
      is(await count(page, SHELL.overlay), 1, "the shell's overlay host count");

      const hosted = await page.evaluate(
        ([host, dialog]) => {
          const hostEl = document.querySelector(`[data-testid="${host}"]`);
          const dialogEl = document.querySelector(`[data-testid="${dialog}"]`);
          return hostEl !== null && dialogEl !== null && hostEl.contains(dialogEl);
        },
        [SHELL.overlay, ATTACH.root],
      );
      is(hosted, true, "the attach dialog sits inside the shell's overlay host");
    });

    /**
     * AND IT CLOSES. An overlay that cannot be dismissed is a modal that has
     * captured the app, and Escape is the shell's own contract: "One Escape
     * closes one thing, innermost first."
     */
    await check('Escape takes the dialog back off the screen', async () => {
      // The precondition is asserted, so this check cannot pass by dismissing
      // nothing. A green "it closed" on a dialog that never opened is the
      // vacuous half of every teardown assertion.
      is(await count(page, ATTACH.root), 1, 'a dialog to dismiss');

      await page.keyboard.press('Escape');
      await settle(page);
      is(await count(page, ATTACH.root), 0, 'attach dialogs after Escape');
      is(await count(page, SHELL.overlay), 0, 'overlay hosts after Escape');
    });

    /**
     * THE SAME ONE DIALOG FROM THE COMMAND SURFACE.
     *
     * `shellModel.ts` marks `overlay.attach` as a command the shell runs
     * itself, and `Shell.tsx` renders a command DISABLED with the reason "not
     * built" when there is no overlay renderer. So this check is two claims at
     * once: the row is offered as runnable, and running it lands on the same
     * host the button did — one attach dialog in the product, not two.
     */
    await check('Cmd-K → "Attach a repository" opens the same one dialog', async () => {
      await page.keyboard.press('Control+k');
      await settle(page);

      const row = page.locator('[role="option"]', { hasText: 'Attach a repository' });
      is(await row.count(), 1, 'one Attach row in the command surface');
      is(await row.getAttribute('aria-disabled'), null, 'the Attach row is not disabled');

      await row.click();
      await settle(page);

      is(await count(page, ATTACH.root), 1, 'attach dialog count after the command');
      is(await count(page, SHELL.overlay), 1, "the shell's overlay host count after the command");
    });

    /* ── Nothing this spec did not ask for ──────────────────────────────── */

    await check('no console error this spec did not deliberately cause', async () => {
      /*
       * BY URL, NEVER BY A SUBSTRING OF THE MESSAGE. The browser's text for
       * every failed request is the same sentence, so excusing "404" would
       * also excuse a missing stylesheet. The two routes below are the ones
       * this spec answers with a hard 404 on purpose.
       */
      const unexpected = consoleErrors.filter(
        (line) => !line.includes('/archgraph.json') && !line.includes('/api/attach'),
      );
      is(unexpected.length, 0, `console errors: ${unexpected.join(' | ')}`);
    });
  },
  { routes },
);
