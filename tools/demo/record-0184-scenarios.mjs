/*
 * The 0.1.8.4 clips for record-014.mjs (run with --live-model so the chat is a real connection to a local stand-in):
 *
 *   node tools/demo/record-014.mjs --set 0184 --all --live-model --vw 1280 --vh 720 --dsf 1 --cam-max 1.5 --out <dir>
 *
 * The app is the real built app on a neutral copy of the shopfront fixture. The model is tools/measure/fake-openai.mjs: the
 * answer text below was written by hand for the recording and is NOT output of a model. Everything else on screen is live.
 * The old 0.1.4 scenarios in the other record-014-*.mjs files drive a UI that has since changed and are not in this set.
 */
export const ALL_0184 = ['ask-live', 'surfaces', 'rail-and-settings', 'board-tour'];

const ARCHITECTURE_ANSWER = [
  'Shopfront is a small storefront. **Edge** is the only public entry; it forwards to the **Gateway**, which routes each request to one of four services.',
  '',
  '- **Orders** (Python, FastAPI) takes the order and publishes `OrderCreated`.',
  '- **Shipping** (Go) and **Notifications** subscribe to `OrderCreated`.',
  '- **Payments** and **Invoices** are called by Orders over HTTP.',
  '- **Orders**, **Payments** and **Inventory** all read and write one Postgres database; Redis is configured but nothing connects to it.',
  '',
  'Source: gateway/src/index.ts:12, orders/app/main.py:31',
].join('\n');

export function register0184Scenarios(ctx) {
  const { SCENARIOS, tid, waitShell, waitBoard, liveAnswer } = ctx;

  liveAnswer.fn = ({ user }) => {
    if (/^Name this chat/i.test(user)) return 'Explaining the shopfront architecture';
    return ARCHITECTURE_ANSWER;
  };

  const tab = (rig, id, ms = 650) => rig.click(tid(rig.page, `s2-tab-${id}`), ms);

  SCENARIOS['ask-live'] = {
    async run(rig) {
      const { page } = rig;
      await waitShell(page);
      await waitBoard(page);
      rig.start();
      await rig.focus('full');
      await rig.pause(900);
      await rig.focus(tid(page, 's2-chat'));
      await rig.type(tid(page, 'composer-field').first(), 'Explain this architecture: the main services, how they talk to each other, and where the data lives.');
      await rig.pause(500);
      await page.keyboard.press('Enter');
      await rig.pause(7000);
      await rig.focus('full');
      await rig.pause(1600);
    },
  };

  SCENARIOS['surfaces'] = {
    async run(rig) {
      const { page } = rig;
      await waitShell(page);
      await waitBoard(page);
      rig.start();
      await rig.focus('full');
      await rig.pause(1200);
      for (const id of ['files', 'whiteboard', 'agents', 'terminal', 'architecture']) {
        await tab(rig, id);
        await rig.pause(1300);
      }
    },
  };

  SCENARIOS['rail-and-settings'] = {
    async run(rig) {
      const { page } = rig;
      await waitShell(page);
      await waitBoard(page);
      rig.start();
      await rig.focus('full');
      await rig.pause(900);
      for (const id of ['workflows', 'components', 'profiles', 'skills']) {
        await rig.click(tid(page, `rail-nav-${id}`), 600);
        await rig.pause(1100);
      }
      await rig.click(tid(page, 'v3-rail-settings'), 700);
      await rig.pause(1800);
      await page.keyboard.press('Escape');
      await rig.pause(900);
    },
  };

  SCENARIOS['board-tour'] = {
    async run(rig) {
      const { page } = rig;
      await waitShell(page);
      await waitBoard(page);
      rig.start();
      await rig.focus(tid(page, 'board-node').first());
      await rig.pause(900);
      await rig.focus('full');
      await rig.click(tid(page, 'board-node-title').first(), 800);
      await rig.pause(1200);
      await rig.click(tid(page, 'board-view-menu'), 700);
      await rig.pause(1300);
      await page.keyboard.press('Escape');
      await rig.click(tid(page, 'board-zoom-in'), 600);
      await rig.click(tid(page, 'board-zoom-in'), 300);
      await rig.pause(900);
      await rig.click(tid(page, 'board-fit'), 600);
      await rig.pause(1200);
    },
  };
}
