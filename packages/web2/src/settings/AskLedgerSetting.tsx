/* ══════════════════════════════════════════════════════════════════════════
   "MAKE SURE EVERY ASK GETS AN ANSWER" (t3gap/asks)
   packages/web2/src/settings/AskLedgerSetting.tsx

   One select in the Agents pane: off, show the asks a reply left open, or
   ask the agent again by itself. askLedgerPreference.ts says what each does.
   ══════════════════════════════════════════════════════════════════════════ */

import { useId, useState } from 'react';
import { readAskLedgerMode, writeAskLedgerMode, type AskLedgerMode } from './askLedgerPreference';

export function AskLedgerSetting() {
  const id = useId();
  const [mode, setMode] = useState(readAskLedgerMode);
  return (
    <section className="sb-group" data-testid="settings-ask-ledger">
      <h3 className="sb-lab">Messages with several asks</h3>
      <div className="sb-card">
        <label htmlFor={id} className="sb-row sb-theme">
          <span className="sb-row-txt">
            <span className="sb-row-t">Ask the agent to list what it didn’t do</span>
            <span className="sb-row-sub" data-testid="settings-ask-ledger-sub">
              Claude and Codex chats only. When a message holds several requests, the agent ends its reply with a short list of them, done or not. Anything it marks not done is shown under the reply. This relies on the agent’s own report. Saved on this device.
            </span>
          </span>
          <span className="sb-native">
            <select
              id={id}
              aria-label="Ask the agent to list what it didn’t do"
              value={mode}
              onChange={(e) => {
                const next = e.target.value as AskLedgerMode;
                setMode(next);
                writeAskLedgerMode(next);
              }}
            >
              <option value="off">Off</option>
              <option value="chip">Show what the agent reports not done</option>
              <option value="auto">Ask the agent again, once, automatically</option>
            </select>
          </span>
        </label>
      </div>
    </section>
  );
}
