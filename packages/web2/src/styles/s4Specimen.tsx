/* The real chat column on a seeded store, for the S4 shots beside the Ramp Kit
   parts (thinking fold, block cursor, tool cards, braille loader, status strip).
   The store is driven with the same `turn/event` actions the live stream sends.
   Not part of the app build (see s4-specimen.html). */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import './base.css';
import '../chat/chat.css';
import '../v3/v3.css';

import { createStore, StoreProvider } from '../state';
import { V3Chat } from '../v3/V3Chat';

const q = new URLSearchParams(location.search);
if (q.get('theme') === 'light') document.documentElement.setAttribute('data-theme', 'light');
const done = q.get('state') === 'done';

const store = createStore({});
const ev = (event: object, at: number) => store.dispatch({ type: 'turn/event', event, at } as never);
store.dispatch({ type: 'composer/draft', text: 'Why does the gateway call payments before orders?' });
store.dispatch({ type: 'turn/send', at: Date.now() - 7_400 });
ev({ type: 'reasoning', text: 'The gateway routes /checkout. I should read gateway/app/routes.py to see the call order, then check orders and payments for the handlers it reaches.' }, Date.now() - 6_000);
ev({ type: 'tool:start', id: 't1', name: 'read_file', input: { path: 'gateway/app/routes.py' } }, Date.now() - 5_000);
ev({ type: 'tool:done', id: 't1', name: 'read_file', ok: true, evidence: 'routes.py: 42 lines' }, Date.now() - 4_000);
ev({ type: 'tool:start', id: 't2', name: 'search', input: { pattern: 'payments_client' } }, Date.now() - 3_000);
if (done) {
  ev({ type: 'tool:done', id: 't2', name: 'search', ok: true, evidence: '3 matches' }, Date.now() - 2_000);
}
ev({ type: 'delta', text: 'The gateway authorises the card before it creates the order, so a declined payment never leaves an order behind. ' }, Date.now() - 1_000);
if (done) ev({ type: 'result', text: '' }, Date.now());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      {/* Inside .v3-scaffold, as V3Shell mounts it: icon sizes are scoped there. */}
      <div className="v3-scaffold v3-chat-col" style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px' }}>
        <V3Chat />
      </div>
    </StoreProvider>
  </StrictMode>,
);
