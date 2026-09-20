import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CheckpointRecord, PostCheckpointRestoreResponse, RestorePlan } from '@sequence/api-types';

import type { ReviewClient } from '../review/reviewClient';
import { RewindPanel } from './RewindPanel';
import './rewind.css';

afterEach(cleanup);

const NOW = 1_700_000_000_000;

function plan(over: Partial<RestorePlan> = {}): RestorePlan {
  return {
    ok: true,
    sessionId: 's',
    seq: 1,
    requestedScope: 'code',
    touches: { code: true, conversation: false },
    writes: [],
    deletes: [],
    unchanged: [],
    unrecoverable: [],
    notes: [],
    ...over,
  };
}

function cp(over: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return { seq: 1, at: NOW, sessionId: 's', files: [], ...over };
}

const refuse = async () => ({ outcome: 'unreachable', message: 'not served in this test' }) as const;

function clientWith(over: Partial<ReviewClient>): ReviewClient {
  return {
    status: refuse,
    diff: refuse,
    revisions: refuse,
    writeFile: refuse,
    commit: refuse,
    functions: refuse,
    checkpoints: refuse,
    planRestore: refuse,
    restore: refuse,
    ...over,
  } as ReviewClient;
}

type Applied = NonNullable<PostCheckpointRestoreResponse['applied']>;

/** A planRestore that answers with this plan. */
function planned(p: RestorePlan): ReviewClient['planRestore'] {
  return async () => ({ outcome: 'ok', status: 200, body: { plan: p } });
}

/** A planRestore that REFUSES but still carries the plan, as the route does. */
function refusedPlan(p: RestorePlan): ReviewClient['planRestore'] {
  return async () => ({ outcome: 'error', status: 409, body: { plan: p } });
}

/** A restore that reports exactly this outcome. */
function restored(applied: Applied): ReviewClient['restore'] {
  return async () => ({ outcome: 'ok', status: 200, body: { plan: plan(), applied } });
}

function writesOf(...paths: string[]): RestorePlan['writes'] {
  /* `blob` is REQUIRED on a planned write - the plan names the exact
     content it would put back, not just the path. */
  return paths.map((path) => ({ path, bytes: 1, blob: `blob-${path}` }));
}

function listing(checkpoints: CheckpointRecord[]): ReviewClient['checkpoints'] {
  /* Typed as the client's own member rather than `as const`: `as const` makes
     `tracked: []` readonly, which is not the shape the wire declares. */
  return async () => ({ outcome: 'ok', status: 200, body: { checkpoints, tracked: [] as string[] } });
}

describe('the empty state', () => {
  it('says how a checkpoint comes to exist, rather than only saying none', async () => {
    render(<RewindPanel client={clientWith({ checkpoints: listing([]) })} now={() => NOW} />);
    const empty = await screen.findByTestId('rewind-empty');
    expect(empty.textContent).toMatch(/before a turn edits files/);
  });

  it('does not dress an ordinary empty list as an error', async () => {
    render(<RewindPanel client={clientWith({ checkpoints: listing([]) })} now={() => NOW} />);
    await screen.findByTestId('rewind-empty');
    expect(screen.queryByTestId('rewind-failed')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the list', () => {
  it("shows the engine's own sentence when the engine refuses", async () => {
    const client = clientWith({
      checkpoints: async () => ({ outcome: 'error', status: 400, body: { error: 'not a usable session id' } }) as const,
    });
    render(<RewindPanel client={client} now={() => NOW} />);
    const failed = await screen.findByTestId('rewind-failed');
    expect(failed.textContent).toBe('not a usable session id');
  });

  it('is newest first on screen, not just in the model', async () => {
    const client = clientWith({
      checkpoints: listing([cp({ seq: 1, label: 'first' }), cp({ seq: 2, label: 'second' })]),
    });
    render(<RewindPanel client={client} now={() => NOW} />);
    const rows = await screen.findAllByTestId('rewind-row');
    expect(rows.map((r) => r.getAttribute('data-seq'))).toEqual(['2', '1']);
  });

  it('names an unlabelled checkpoint by its seq rather than inventing one', async () => {
    render(<RewindPanel client={clientWith({ checkpoints: listing([cp({ seq: 7 })]) })} now={() => NOW} />);
    const row = await screen.findByTestId('rewind-row');
    expect(row.textContent).toMatch(/Checkpoint 7/);
  });

  it('says whether conversation was captured on each row (B3.3)', async () => {
    render(
      <RewindPanel
        client={clientWith({
          checkpoints: listing([
            cp({ seq: 1, conversation: [{ role: 'user', text: 'hi' }] }),
          ]),
        })}
        now={() => NOW}
      />,
    );
    const row = await screen.findByTestId('rewind-row');
    expect(row.textContent).toMatch(/· conversation/);
    expect(row.textContent).not.toMatch(/no conversation/);
  });
});

describe('nothing acts before it states', () => {
  it('asks for the PLAN on select, and does not restore', async () => {
    const planRestore = vi.fn<ReviewClient['planRestore']>(planned(plan()));
    const restore = vi.fn<ReviewClient['restore']>(refuse);
    const client = clientWith({ checkpoints: listing([cp({ seq: 3 })]), planRestore, restore });

    render(<RewindPanel client={client} now={() => NOW} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));

    await waitFor(() => expect(planRestore).toHaveBeenCalled());
    expect(planRestore.mock.calls[0][0]).toBe(3);
    /* THE POINT OF THIS TEST. Selecting a row must never be the thing that
       changes the tree. */
    expect(restore).not.toHaveBeenCalled();
  });

  it('re-asks the plan when the scope changes, because the scope is the question', async () => {
    const planRestore = vi.fn<ReviewClient['planRestore']>(planned(plan()));
    const client = clientWith({ checkpoints: listing([cp({ seq: 1 })]), planRestore });

    render(<RewindPanel client={client} now={() => NOW} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));
    await waitFor(() => expect(planRestore).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('rewind-scope-both'));
    await waitFor(() => expect(planRestore).toHaveBeenCalledTimes(2));
    expect(planRestore.mock.calls[1][1]).toBe('both');
  });

  it('restores with the scope that was on screen, not the default', async () => {
    const restore = vi.fn<ReviewClient['restore']>(
      restored({ ok: true, wrote: ['a'], deleted: [], conversationRestored: false }),
    );
    const client = clientWith({
      checkpoints: listing([cp({ seq: 1 })]),
      planRestore: planned(plan({ writes: writesOf('a') })),
      restore,
    });

    render(<RewindPanel client={client} now={() => NOW} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));
    fireEvent.click(await screen.findByTestId('rewind-scope-conversation'));
    await waitFor(() => expect(screen.getByTestId('rewind-restore').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('rewind-restore'));

    await waitFor(() => expect(restore).toHaveBeenCalled());
    expect(restore.mock.calls[0][1]).toBe('conversation');
  });
});

describe('the button agrees with the engine', () => {
  it('is OFF when a blob was swept, and the reason is on screen beside it', async () => {
    const client = clientWith({
      checkpoints: listing([cp({ seq: 1 })]),
      planRestore: planned(plan({ unrecoverable: ['src/gone.ts'] })),
    });

    render(<RewindPanel client={client} now={() => NOW} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));

    await waitFor(() => expect(screen.getByTestId('rewind-restore').hasAttribute('disabled')).toBe(true));
    /* Sheet 12.5: a disabled control with no sentence next to it communicates
       its state by appearance alone, and the reader has nowhere to go. */
    expect(screen.getByTestId('rewind-refusal').textContent).toMatch(/gone/);
    expect(within(screen.getByTestId('rewind-lines')).getByText('src/gone.ts')).toBeTruthy();
  });

  it('is OFF when the tree already matches, and that does not read as a failure', async () => {
    const client = clientWith({
      checkpoints: listing([cp({ seq: 1 })]),
      planRestore: planned(plan({ unchanged: ['a.ts'] })),
    });

    render(<RewindPanel client={client} now={() => NOW} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));

    await waitFor(() => expect(screen.getByTestId('rewind-restore').hasAttribute('disabled')).toBe(true));
    expect(screen.getByTestId('rewind-headline').textContent).toMatch(/already matches/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal still renders the plan the engine sent with it', async () => {
    /* The route answers 409 WITH the plan in the body precisely so the client
       can show what stopped it. Dropping it would waste the one thing the
       engine went out of its way to provide. */
    const client = clientWith({
      checkpoints: listing([cp({ seq: 1 })]),
      planRestore: refusedPlan(plan({ ok: false, error: 'checkpoint 1 is gone', unrecoverable: ['x.ts'] })),
    });

    render(<RewindPanel client={client} now={() => NOW} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));

    await waitFor(() => expect(screen.getByTestId('rewind-restore').hasAttribute('disabled')).toBe(true));
    expect(within(screen.getByTestId('rewind-lines')).getByText('x.ts')).toBeTruthy();
  });
});

describe('after it acts', () => {
  it('reports what the engine DID, not what the plan said it would do', async () => {
    const client = clientWith({
      checkpoints: listing([cp({ seq: 1 })]),
      planRestore: planned(plan({ writes: writesOf('a', 'b') })),
      /* The plan said two files; the engine wrote one. The panel must say one. */
      restore: restored({ ok: true, wrote: ['a'], deleted: [], conversationRestored: false }),
    });

    render(<RewindPanel client={client} now={() => NOW} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));
    await waitFor(() => expect(screen.getByTestId('rewind-restore').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('rewind-restore'));

    const applied = await screen.findByTestId('rewind-applied');
    expect(applied.textContent).toMatch(/put back 1 file/);
    expect(applied.textContent).not.toMatch(/2 files/);
  });

  it('tells the host what changed, so the graph can be rescanned', async () => {
    const onRestored = vi.fn();
    const client = clientWith({
      checkpoints: listing([cp({ seq: 1 })]),
      planRestore: planned(plan({ writes: writesOf('a') })),
      restore: restored({ ok: true, wrote: ['a.ts'], deleted: ['b.ts'], conversationRestored: false }),
    });

    render(<RewindPanel client={client} now={() => NOW} onRestored={onRestored} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));
    await waitFor(() => expect(screen.getByTestId('rewind-restore').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('rewind-restore'));

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(['a.ts'], ['b.ts']));
  });

  it('does not claim success when the engine refused to apply', async () => {
    const client = clientWith({
      checkpoints: listing([cp({ seq: 1 })]),
      planRestore: planned(plan({ writes: writesOf('a') })),
      restore: restored({ ok: false, wrote: [], deleted: [], conversationRestored: false, error: 'a file changed underneath' }),
    });

    render(<RewindPanel client={client} now={() => NOW} />);
    fireEvent.click(await screen.findByTestId('rewind-row'));
    await waitFor(() => expect(screen.getByTestId('rewind-restore').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByTestId('rewind-restore'));

    const applied = await screen.findByTestId('rewind-applied');
    expect(applied.textContent).toBe('a file changed underneath');
    expect(applied.textContent).not.toMatch(/Done/);
  });
});
