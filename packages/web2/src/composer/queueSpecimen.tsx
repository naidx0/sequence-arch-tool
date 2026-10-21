/* The S5 queue and "Deny with reason" on their own page. Not part of the app
   build (see queue.specimen.html). Two queued prompts, as they stand after a
   person pressed Tab twice while a turn ran; the deny field open beside an
   approval's buttons. Every control is live: edit, reorder, remove. */
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../tokens/graphite.css';
import '../styles/base.css';

import { DenyWithReason } from './DenyWithReason';
import { PromptQueueList } from './PromptQueueList';
import { promptQueue } from './promptQueue';

const theme = new URLSearchParams(location.search).get('theme');
if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');

promptQueue.add('specimen', 'Now run the parser tests and paste the failures.');
promptQueue.add('specimen', 'If they pass, commit with a message that names the fixture.');

function Specimen() {
  const [denied, setDenied] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    /* Open the reason field for the screenshot, the way a click would. */
    const t = document.querySelector<HTMLButtonElement>('[data-testid="agent-deny-reason"]');
    if (!open && t) {
      t.click();
      setOpen(true);
    }
  }, [open]);
  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: '0 16px', fontFamily: 'var(--font-ui)', color: 'var(--ink-1)' }}>
      <p style={{ color: 'var(--ink-3)', fontSize: 'var(--t-12)' }}>Codex, turn running, 1 approval waiting</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 20px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--t-13)' }}>Run psql -c "drop table orders"</span>
        <DenyWithReason onDeny={(r) => setDenied(r)} />
        {denied ? <span style={{ color: 'var(--ink-3)', fontSize: 'var(--t-12)' }}>denied: {denied}</span> : null}
      </div>
      <PromptQueueList queueKey="specimen" />
      <textarea
        aria-label="Message input"
        rows={3}
        placeholder="Enter steers the running turn, Tab queues it"
        style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 'var(--t-14)', color: 'var(--ink-1)', background: 'var(--surface-2)', border: 'var(--w-hair) solid var(--edge)', borderRadius: 'var(--r-10)', padding: 'var(--sp-10)' }}
      />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Specimen />
  </StrictMode>,
);
