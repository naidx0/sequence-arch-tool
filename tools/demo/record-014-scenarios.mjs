/*
 * The scenarios for record-014.mjs: what each clip does on screen.
 * Each scenario is { run(rig), small?, light? }. `rig` is the Rig from the
 * recorder (pause, glide, click, type, snap, start, poster, page).
 * `small` also writes 1024x700 stills; `light` also writes light-theme stills
 * (only snaps marked { light: true } or { small: true } are kept for those passes).
 */
export function registerScenarios(ctx) {
  const { LAYOUT, SCENARIOS, R, tid, waitShell, waitBoard, installReplay, readJson, seedSessions, sleep, REPO, HOME, fs, path } = ctx;

  /* A chat tab or workspace row by its visible title. */
  const sidebarText = (page, text) => page.locator('[data-testid="s2-groups"]').getByText(text, { exact: false }).first();

  /* Give the working pane the width: fold the sidebar and narrow the chat column (both are the app's own controls). */
  const VIEW_W = 1920;
  async function giveRoom(page, shrink = 280) {
    /* The 1920x1080 video is zoomed out on purpose: the whole app stays on screen, nothing is folded away. */
    if ((page.viewportSize()?.width ?? 0) >= 1800) return;
    const col = tid(page, 's2-sidebar-collapse');
    if (await col.count()) await col.first().click().catch(() => {});
    await sleep(500);
    const rz = await tid(page, 'v3-resize-chat').boundingBox().catch(() => null);
    if (rz) {
      await page.mouse.move(rz.x + rz.width / 2, rz.y + 300);
      await page.mouse.down();
      await page.mouse.move(rz.x - shrink, rz.y + 300, { steps: 20 });
      await page.mouse.up();
    }
    await sleep(700);
  }

  async function openBoardTab(rig, id) {
    await rig.click(tid(rig.page, `s2-tab-${id}`), 600);
    await sleep(700);
  }
  ctx.giveRoom = giveRoom;
  ctx.openBoardTab = openBoardTab;

  async function openProjectViaPicker(rig, name) {
    const { page } = rig;
    await tid(page, 's2-open-project').click();
    await page.getByPlaceholder(/paste a path/i).fill(path.join(HOME, name).split(path.sep).join('/'));
    await page.keyboard.press('Enter');
    await tid(page, 'board-node').first().waitFor({ timeout: 90000 }).catch(() => {});
    await rig.pause(1200);
  }

  /* ───── architecture ───── */
  SCENARIOS['architecture'] = {
    small: true,
    light: true,
    async run(rig) {
      const { page } = rig;
      await waitShell(page);
      await waitBoard(page);
      rig.start();
      await rig.focus(tid(page, 'board-node'));
      await rig.pause(1600);
      await rig.snap('architecture-map', { small: true, light: true });
      rig.poster();
      /* A card: hover, then select. */
      const orders = tid(page, 'board-node-title').filter({ hasText: /^Orders$/ }).first();
      await rig.focus(orders, { zoom: 1.8 });
      await rig.hover(orders, 900);
      await rig.pause(500);
      await rig.click(orders, 300);
      await rig.pause(1600);
      await rig.snap('architecture-card-selected', { small: true });
      /* The one view dropdown: Map, Grid, Hotspots. */
      await rig.focus(tid(page, 'board-view-menu'), { zoom: 1.7, dy: 110 });
      await rig.click(tid(page, 'board-view-menu'), 700);
      await rig.pause(900);
      await rig.snap('architecture-view-menu', { small: true, light: true });
      await rig.click(tid(page, 'board-view-menu-grid'), 500);
      await rig.focus(LAYOUT.pane);
      await rig.pause(2000);
      await rig.snap('architecture-grid-view');
      await rig.click(tid(page, 'board-view-menu'), 600);
      await rig.pause(400);
      await rig.click(tid(page, 'board-view-menu-hotspots'), 500);
      await rig.pause(2200);
      await rig.snap('architecture-hotspots-view');
      await rig.click(tid(page, 'board-view-menu'), 600);
      await rig.pause(400);
      await rig.click(tid(page, 'board-view-menu-map'), 500);
      await rig.focus(tid(page, 'board-node'));
      await rig.pause(1500);
      /* The board controls (neighbours, layout, groups): shown in the stills only, they cover cards in a short clip. */
      if (!rig.video) {
        await rig.click(tid(page, 'board-controls-toggle'), 700);
        await rig.pause(900);
        await rig.snap('architecture-board-controls', { small: true });
        const near = page.getByRole('button', { name: /^(Only near selected|Show all)$/ });
        if (await near.count()) {
          if (/Show all/.test((await near.first().textContent()) ?? '')) { await near.first().click(); await rig.pause(900); }
          await rig.click(near, 600);
          await rig.pause(1800);
          await rig.snap('architecture-neighbours-only', { small: true });
          await rig.click(near, 500);
          await rig.pause(900);
        }
        const down = page.getByRole('button', { name: 'Down', exact: true });
        if (await down.count()) {
          await rig.click(down, 600);
          await rig.pause(1900);
          await rig.snap('architecture-layout-down');
          await rig.click(page.getByRole('button', { name: 'Auto', exact: true }), 500);
          await rig.pause(1500);
        }
        const expandAll = tid(page, 'board-expand-all');
        if (await expandAll.count()) {
          await rig.click(expandAll, 500);
          await rig.pause(1800);
          await rig.snap('architecture-groups-expanded');
        }
        await rig.click(tid(page, 'board-controls-toggle'), 600);
        await rig.pause(500);

      }
      await rig.click(tid(page, 'board-fit'), 700);
      await rig.pause(1500);
    },
  };

  /* ───── workspaces ───── */
  SCENARIOS['workspaces'] = {
    small: true,
    async run(rig) {
      const { page } = rig;
      seedSessions('shopfront', [
        { id: 'session-1101', title: 'Explain the order flow' },
        { id: 'session-1102', title: 'Why does payments retry?' },
        { id: 'session-1103', title: 'Add request ids at the gateway' },
      ]);
      seedSessions('notes-app', [
        { id: 'session-2201', title: 'Sketch the notes API' },
        { id: 'session-2202', title: 'Where is auth checked?' },
      ]);
      seedSessions('dashboard', [{ id: 'session-3301', title: 'Split the chart widgets' }]);
      await waitShell(page);
      await waitBoard(page);
      /* Bring the two other projects into the tree (real project picker, not recorded). */
      await openProjectViaPicker(Object.assign(Object.create(rig), { pause: async (ms) => sleep(Math.min(ms, 200)) }), 'notes-app');
      await openProjectViaPicker(Object.assign(Object.create(rig), { pause: async (ms) => sleep(Math.min(ms, 200)) }), 'dashboard');
      await sleep(800);
      await page.reload();
      await tid(page, 'shell').waitFor();
      await sidebarText(page, 'Explain the order flow').click();
      await waitBoard(page);
      rig.start();
      await rig.focus({ x: 0, y: 30, w: 960, h: 540 }, { zoom: 1.75 });
      await rig.pause(1800);
      await rig.snap('workspaces-tree', { small: true });
      rig.poster();
      await rig.hover(tid(page, 's2-group-workspaces'), 800);
      await rig.pause(500);
      /* Fold a workspace, open another. */
      const folds = tid(page, 's2-project-fold');
      if (await folds.count()) {
        await rig.click(folds.first(), 700);
        await rig.pause(1200);
        await rig.snap('workspaces-folded');
        await rig.click(folds.first(), 500);
        await rig.pause(900);
      }
      const notes = sidebarText(page, 'Sketch the notes API');
      if (await notes.count()) {
        await rig.click(notes, 800);
        await rig.focus('full', { zoom: 1.15 });
        await rig.pause(2200);
        await rig.snap('workspaces-switched', { small: true });
      }
      const mine = sidebarText(page, 'Explain the order flow');
      if (await mine.count()) {
        await rig.focus({ x: 0, y: 30, w: 960, h: 540 }, { zoom: 1.5 });
        await rig.click(mine, 800);
        await rig.focus('full', { zoom: 1.15 });
        await rig.pause(1800);
      }
    },
  };

  /* ───── files ───── */
  SCENARIOS['files'] = {
    small: true,
    light: true,
    async run(rig) {
      const { page } = rig;
      await waitShell(page);
      await waitBoard(page);
      await rig.click(tid(page, 's2-tab-files'), 600);
      await tid(page, 'files-row').first().waitFor({ timeout: 30000 });
      await rig.pause(700);
      const closeArch = tid(page, 'v3-tab-close-architecture');
      if (await closeArch.count()) await closeArch.first().click();
      await giveRoom(page, 220);
      const row = (p) => page.locator(`[data-testid="files-row"][data-path="${p}"]`);
      rig.start();
      /* Frame from where the tree really is (the pane moves with the layout): tree first, then tree plus the reader. */
      const tb = (await tid(page, 'files-row').first().boundingBox()) ?? { x: 680, y: 120 };
      const reader = { x: tb.x - 20, y: 60, w: VIEW_W - tb.x + 10, h: 760 };
      await rig.focus({ x: tb.x - 20, y: tb.y - 60, w: 760, h: 560 }, { zoom: 1.75 });
      await rig.pause(1000);
      for (const d of ['gateway', 'gateway/src', 'gateway/src/routes', 'docs']) {
        if (await row(d).count()) await rig.click(row(d), 450);
        await rig.pause(250);
      }
      await rig.pause(900);
      await rig.snap('files-tree-status-colours', { small: true, light: true });
      rig.poster();
      await rig.click(row('gateway/src/index.ts'), 800);
      await rig.focus(reader, { zoom: 1.45, dy: -60 });
      await rig.pause(2400);
      await rig.snap('files-code-header-breadcrumb', { small: true, light: true });
      await rig.focus(reader, { zoom: 1.3, dy: -20 });
      await rig.click(row('docs/guide.md'), 800);
      await rig.pause(3000);
      await rig.snap('files-markdown-preview-diagram', { light: true });
      await rig.pause(1600);
      if (await row('gateway/src/routes/health.ts').count()) {
        await rig.click(row('gateway/src/routes/health.ts'), 800);
        await rig.pause(1800);
        await rig.snap('files-new-file');
      }
    },
  };

  /* ───── terminal ───── */
  SCENARIOS['terminal'] = {
    small: true,
    async run(rig) {
      const { page } = rig;
      await waitShell(page);
      await waitBoard(page);
      const closeArch = tid(page, 'v3-tab-close-architecture');
      if (await closeArch.count()) await closeArch.first().click();
      await giveRoom(page, 220);
      await rig.click(tid(page, 's2-tab-terminal'), 600);
      const surface = tid(page, 'terminal-pane-surface').first();
      await surface.waitFor({ timeout: 30000 });
      await rig.pause(2500);
      rig.start();
      await rig.pause(1200);
      await rig.snap('terminal-prompt-toolbar', { small: true });
      rig.poster();
      await rig.click(surface, 500);
      for (const cmd of ['git status -s', 'git --no-pager log --oneline', 'ls gateway/src']) {
        await page.keyboard.type(cmd, { delay: rig.video ? 45 : 0 });
        await rig.pause(400);
        await page.keyboard.press('Enter');
        await rig.pause(1600);
      }
      await rig.snap('terminal-after-commands', { small: true });
      await rig.pause(800);
      const tools = tid(page, 'terminal-tools');
      if (await tools.count()) await rig.hover(tools.first(), 700);
      await rig.pause(1200);
    },
  };
}
