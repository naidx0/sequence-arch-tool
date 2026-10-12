import { describe, expect, it, vi } from 'vitest';

/* The router chunk fails to load (a page left open across an update): the message is still sent, without the hint. */
vi.mock('@sequence/schema/dist/visual/router.js', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

import { withVisualHint } from './visualHint';

describe('the private hint is optional', () => {
  it('a router chunk that cannot be loaded never fails the send: the message (with its attachments) goes as it is', async () => {
    await expect(withVisualHint('draw a chart of p95 latency by week')).resolves.toBe('draw a chart of p95 latency by week');
    await expect(withVisualHint('draw a chart of @drawing:d1', 'draw a chart of @drawing:d1 + attachment')).resolves.toBe('draw a chart of @drawing:d1 + attachment');
  });
});
