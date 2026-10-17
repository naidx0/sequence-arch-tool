/* ══════════════════════════════════════════════════════════════════════════
   THE PROJECT LIST IS HIS TO ARRANGE AND HIS TO SHORTEN
   packages/web2/src/v3/railProjectEdits.test.tsx

   Owner, 2026-09-21: "apart from starting a new chat in that folder, you
   should be able to move the folder, compress the folder ... you can also be
   able to delete it if you don't want to. Like, I just delete the folder, just
   delete it from that workspace."

   ── WHY THESE THREE ───────────────────────────────────────────────────────

   1. A PROJECT WITH NO CHATS IS STILL DRAWN. The rail used to end its pipeline
      in `.filter((entry) => entry.rows.length > 0)`, which is right for a list
      of conversations and wrong for a list of projects. It also made the first
      minutes after an attach look exactly like the project-loss he reported in
      the same walk: open a folder, write nothing in it yet, and the rail shows
      no sign you ever did.

   2. A DRAG WRITES ONCE, ON THE DROP. An abandoned drag must cost nothing, and
      the request that does go must carry the order he let go of.

   3. REMOVING ASKS FIRST, AND THE QUESTION SAYS WHAT IT DOES NOT DO. Not
      because the act is dangerous — it edits a list of paths — but because his
      word for it is "delete", and in an application that can read his files
      that word has to be disarmed in the sentence before the button.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createSessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { V3SessionsRail } from './V3SessionsRail';

const HOME = '/home/max';
const EMPTY = '/home/max/t3code';
const BUSY = '/home/max/ml-harness';

function sessionsIndex(activeId: string, ids: string[]) {
  return {
    version: 1,
    activeId,
    sessions: ids.map((id) => ({
      id,
      title: id,
      createdAt: '2026-09-21T09:00:00.000Z',
      updatedAt: '2026-09-21T09:00:00.000Z',
    })),
  };
}

interface Wire {
  /** Every mutation of the project list, in order, as the rail sent it. */
  edits: { method: string; body: unknown }[];
}

function wiredClient(wire: Wire) {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url === '/api/sessions' && method === 'GET') {
      return new Response(
        JSON.stringify({
          index: sessionsIndex('session-home', ['session-home']),
          scope: 'workspace',
          repos: [
            /* The home workspace, exactly as the server synthesises it. Not a
               project anybody opened, so not one anybody can move or remove. */
            { path: HOME, name: 'Workspace', home: true, index: sessionsIndex('s-h', ['s-h']) },
            /* t3code is attached and has NOTHING in it — the case the old
               filter erased from the rail entirely. */
            { path: EMPTY, name: 't3code', index: sessionsIndex('', []) },
            {
              path: BUSY,
              name: 'ml-harness',
              index: sessionsIndex('session-mlh', ['session-mlh']),
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (url === '/api/recent' && (method === 'DELETE' || method === 'PUT')) {
      wire.edits.push({ method, body: JSON.parse(String(init?.body ?? 'null')) as unknown });
      return new Response(JSON.stringify({ recent: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

function mount(): Wire {
  const wire: Wire = { edits: [] };
  render(
    <StoreProvider store={createStore({})}>
      <V3SessionsRail client={wiredClient(wire)} onOpenProject={vi.fn()} />
    </StoreProvider>,
  );
  return wire;
}

/** jsdom has no DataTransfer, and `fireEvent.drag*` will not invent one. */
function dataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: 'move',
    dropEffect: 'move',
    setData: (k: string, v: string) => void store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
  } as unknown as DataTransfer;
}

describe('the project list in the rail', () => {
  it('draws a project that has no chats in it yet', async () => {
    mount();

    /*
     * The section, the name, and a sentence that distinguishes EMPTY from
     * GONE — which is the distinction the owner could not make in his walk.
     */
    await waitFor(() => expect(screen.getByTestId('v3-rail-project-t3code')).toBeTruthy());
    expect(screen.getByTestId('v3-rail-section-empty').textContent).toMatch(/no chats yet/i);
  });

  it('a drag that is abandoned writes nothing', async () => {
    const wire = mount();
    await waitFor(() => expect(screen.getByTestId('v3-rail-project-t3code')).toBeTruthy());

    const from = screen.getByTestId('v3-rail-project-t3code');
    const to = screen.getByTestId('v3-rail-project-ml-harness');
    const dt = dataTransfer();

    fireEvent.dragStart(from, { dataTransfer: dt });
    fireEvent.dragOver(to, { dataTransfer: dt });
    /* He lets go outside the list, or presses Escape — `dragend`, not `drop`. */
    fireEvent.dragEnd(from, { dataTransfer: dt });

    expect(wire.edits, 'a drag that never landed is not an opinion').toEqual([]);
  });

  it('a drop sends the order he let go of, once', async () => {
    const wire = mount();
    await waitFor(() => expect(screen.getByTestId('v3-rail-project-t3code')).toBeTruthy());

    const from = screen.getByTestId('v3-rail-project-t3code');
    const to = screen.getByTestId('v3-rail-project-ml-harness');
    const dt = dataTransfer();

    fireEvent.dragStart(from, { dataTransfer: dt });
    fireEvent.dragOver(to, { dataTransfer: dt });
    fireEvent.drop(to, { dataTransfer: dt });

    await waitFor(() => expect(wire.edits.length).toBe(1));
    expect(wire.edits[0].method).toBe('PUT');
    expect(
      (wire.edits[0].body as { order: string[] }).order,
      'ml-harness was dragged over, so t3code takes its place',
    ).toEqual([BUSY, EMPTY]);
  });

  it('the home workspace is not a project — no remove, no drag', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('v3-rail-project-Workspace')).toBeTruthy());

    /*
     * THE FIRST BUILD OF THIS OFFERED "Remove Workspace from the workspace",
     * caught in a real browser rather than here. It is meaningless as a
     * sentence and it could not have worked as a control: the server
     * synthesises this section on every read, so there is no entry in
     * `recent.json` to remove or reorder, and both edits would have been
     * controls that silently did nothing.
     */
    expect(screen.queryByTestId('v3-rail-project-remove-Workspace')).toBeNull();
    expect(screen.getByTestId('v3-rail-project-Workspace').getAttribute('draggable')).toBe('false');

    /* And the projects beside it keep both. */
    expect(screen.getByTestId('v3-rail-project-remove-t3code')).toBeTruthy();
    expect(screen.getByTestId('v3-rail-project-t3code').getAttribute('draggable')).toBe('true');
  });

  it('removing asks first, and says the folder is not going anywhere', async () => {
    const wire = mount();
    await waitFor(() => expect(screen.getByTestId('v3-rail-project-t3code')).toBeTruthy());

    fireEvent.click(screen.getByTestId('v3-rail-project-remove-t3code'));

    const confirm = screen.getByTestId('v3-rail-project-confirm');
    /*
     * THE SENTENCE IS THE POINT OF THE DIALOG. A reader who presses a control
     * labelled with his word for this has to be told, before the button, that
     * it is not what the word usually means.
     */
    expect(confirm.textContent).toMatch(/folder on disk are untouched/i);
    expect(confirm.textContent).toMatch(/open it again any time/i);

    expect(wire.edits, 'asking is not doing').toEqual([]);
  });

  it('cancelling a removal leaves the project alone', async () => {
    const wire = mount();
    await waitFor(() => expect(screen.getByTestId('v3-rail-project-t3code')).toBeTruthy());

    fireEvent.click(screen.getByTestId('v3-rail-project-remove-t3code'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByTestId('v3-rail-project-confirm')).toBeNull();
    expect(wire.edits).toEqual([]);
    expect(screen.getByTestId('v3-rail-project-t3code')).toBeTruthy();
  });

  it('confirming sends the removal for that project and no other', async () => {
    const wire = mount();
    await waitFor(() => expect(screen.getByTestId('v3-rail-project-t3code')).toBeTruthy());

    fireEvent.click(screen.getByTestId('v3-rail-project-remove-t3code'));
    fireEvent.click(screen.getByTestId('v3-rail-project-confirm-remove'));

    await waitFor(() => expect(wire.edits.length).toBe(1));
    expect(wire.edits[0].method).toBe('DELETE');
    expect((wire.edits[0].body as { path: string }).path).toBe(EMPTY);
  });
});
