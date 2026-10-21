import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostAskStreamRequest } from '@sequence/api-types';

import { preloadChatLazies } from '../../test/preloadChat';
import type { AskTransport } from '../chat/askClient';
import { createComponentsClient, type ComponentsClient, type ComponentsListing } from '../components/componentsClient';
import { createStore, StoreProvider, type Store } from '../state';
import { composerPropsFrom } from '../state/connect';
import { V3Chat } from './V3Chat';

/*
 * Components in the composer and in the transcript (docs/requests/components-ui-contract.md):
 * the + menu row and picker, the slash command, the offer card, and the ask body.
 * The backend is a fake client; a missing route (404) must leave no trace.
 */

beforeAll(preloadChatLazies, 120_000);

const LISTING: ComponentsListing = {
  enabled: true,
  mode: 'approve',
  groups: [
    {
      id: 'design-elements',
      name: 'Design elements',
      blurb: 'Interface review, layout, type and colour passes.',
      components: [
        { id: 'better-typography', name: 'Better typography', blurb: 'Tighter, calmer type.', installed: true, inWorkspace: true },
        { id: 'reverse-engineer', name: 'Reverse engineering', blurb: 'Work back from the shipped thing.', installed: true, inWorkspace: true },
      ],
    },
  ],
};

function fakeClient(listing: ComponentsListing | null = LISTING) {
  const calls = { settings: [] as unknown[], offers: [] as Array<[string, boolean]> };
  const client: ComponentsClient = {
    list: async () => listing,
    setSettings: async (patch) => {
      calls.settings.push(patch);
      return true;
    },
    setWorkspace: async () => true,
    answerOffer: async (id, accept) => {
      calls.offers.push([id, accept]);
      return true;
    },
  };
  return { client, calls };
}

function draw(client: ComponentsClient, store: Store = createStore({})): Store {
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat componentsClient={client} />
      </div>
    </StoreProvider>,
  );
  return store;
}

beforeEach(() => localStorage.clear());

describe('A5: the + menu has a Components row and a grouped picker', () => {
  it('lists groups with blurbs; picking one adds a chip', async () => {
    const { client } = fakeClient();
    const store = draw(client);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    const row = await screen.findByTestId('v3-tools-components');
    fireEvent.click(row);
    const picker = await screen.findByTestId('components-picker');
    expect(picker.textContent).toContain('Design elements');
    expect(picker.textContent).toContain('Tighter, calmer type.');
    fireEvent.click(screen.getAllByTestId('components-item')[0]!);
    const chip = store.getState().composer.chips.find((c) => c.kind === 'component');
    expect(chip).toMatchObject({ ref: 'better-typography', label: 'Better typography' });
    expect(screen.getByTestId('composer-chips').textContent).toContain('Better typography');
  });

  it('hides Components quietly when the route is absent', async () => {
    const { client } = fakeClient(null);
    draw(client);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    await act(async () => {});
    expect(screen.queryByTestId('v3-tools-components')).toBeNull();
  });

  it('the typed client reads a 404 as no Components and a listing as data', async () => {
    const miss = createComponentsClient((async () => ({ ok: false, status: 404, json: async () => ({}) })) as never);
    expect(await miss.list()).toBeNull();
    const hit = createComponentsClient((async () => ({ ok: true, status: 200, json: async () => LISTING })) as never);
    expect((await hit.list())?.groups[0]?.components).toHaveLength(2);
    const puts: Array<[string, RequestInit | undefined]> = [];
    const c = createComponentsClient((async (url: string, init?: RequestInit) => {
      puts.push([url, init]);
      return { ok: true, status: 200, json: async () => ({}) };
    }) as never);
    await c.setSettings({ enabled: false });
    await c.answerOffer('o1', true);
    expect(puts[0]![0]).toBe('/api/components/settings');
    expect(puts[0]![1]?.method).toBe('PUT');
    expect(puts[1]![0]).toBe('/api/components/offer/o1');
    expect(JSON.parse(String(puts[1]![1]?.body))).toEqual({ accept: true });
  });
});

describe('A5: the ask body carries the chosen components', () => {
  it('sends components:[id] and keeps the chip out of the grounded context', async () => {
    const sent: PostAskStreamRequest[] = [];
    const transport: AskTransport = {
      stream: async (request) => {
        sent.push(request);
        return { outcome: 'ok', status: 200, body: null };
      },
    };
    const store = createStore({});
    store.dispatch({ type: 'composer/chip-add', chip: { id: 'component:better-typography', kind: 'component', ref: 'better-typography', label: 'Better typography', nodeKind: null } });
    store.dispatch({ type: 'composer/draft', text: 'tidy the settings page' });
    composerPropsFrom(store.getState(), store, transport).onSend();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.components).toEqual(['better-typography']);
    expect(sent[0]!.context).toBeUndefined();
  });
});

describe('A4: the components slash command', () => {
  it('opens the same picker', async () => {
    const { client } = fakeClient();
    draw(client);
    const field = screen.getByTestId('composer-field');
    /* The listing is read when a slash is typed, not at boot. */
    fireEvent.change(field, { target: { value: '/' } });
    await act(async () => {});
    fireEvent.change(field, { target: { value: '/components' } });
    expect(screen.getAllByTestId('v3-slash-item').map((r) => r.getAttribute('data-command'))).toContain('components');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByTestId('components-picker')).toBeTruthy();
  });

  it('off and on call PUT settings', async () => {
    const { client, calls } = fakeClient();
    draw(client);
    const field = screen.getByTestId('composer-field');
    fireEvent.change(field, { target: { value: '/' } });
    await act(async () => {});
    fireEvent.change(field, { target: { value: '/components off' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(calls.settings).toEqual([{ enabled: false }]));
    fireEvent.change(field, { target: { value: '/components on' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(calls.settings).toEqual([{ enabled: false }, { enabled: true }]));
  });

  it('is not offered when the route is absent', async () => {
    const { client } = fakeClient(null);
    draw(client);
    const field = screen.getByTestId('composer-field');
    fireEvent.change(field, { target: { value: '/' } });
    await act(async () => {});
    fireEvent.change(field, { target: { value: '/comp' } });
    expect(screen.queryAllByTestId('v3-slash-item').some((r) => r.getAttribute('data-command') === 'components')).toBe(false);
  });
});

describe('A8: the component offer card', () => {
  it('shows the question with the reason; both buttons answer the offer route', async () => {
    const { client, calls } = fakeClient();
    const store = createStore({});
    draw(client, store);
    store.dispatch({ type: 'composer/draft', text: 'reverse engineer the checkout' });
    store.dispatch({ type: 'turn/send', at: 1 });
    act(() => {
      store.dispatch({
        type: 'turn/event',
        event: { type: 'component:offer', turnId: 't1', offerId: 'o1', componentId: 'reverse-engineer', name: 'Reverse engineering', reason: 'You asked to reverse engineer something.' },
        at: 2,
      });
    });
    const card = await screen.findByTestId('component-offer');
    expect(screen.getByTestId('component-offer-title').textContent).toBe('Use Reverse engineering?');
    expect(card.textContent).toContain('You asked to reverse engineer something.');
    expect(screen.getByTestId('component-offer-accept').textContent).toBe('Use it');
    expect(screen.getByTestId('component-offer-decline').textContent).toBe('Keep the regular workflow');
    fireEvent.click(screen.getByTestId('component-offer-decline'));
    await waitFor(() => expect(calls.offers).toEqual([['o1', false]]));
    await waitFor(() => expect(screen.queryByTestId('component-offer')).toBeNull());
  });

  it('component:used becomes a normal tool row', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'component:used', turnId: 't1', componentId: 'better-typography', name: 'Better typography' }, at: 2 });
    const row = store.getState().session.inFlight!.work.find((w) => w.from === 'component:used');
    expect(row).toMatchObject({ verb: 'Used a component', identifier: 'Better typography', status: 'done' });
  });

  it('component:skipped becomes a quiet tool row with the reason', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'component:skipped', turnId: 't1', componentId: 'better-typography', reason: 'no UI in this change' }, at: 2 });
    const row = store.getState().session.inFlight!.work.find((w) => w.from === 'component:skipped');
    expect(row).toMatchObject({ verb: 'Skipped a component', identifier: 'better-typography: no UI in this change', status: 'done', opens: null });
  });
});

describe('review fixes: offers belong to their chat and their turn', () => {
  const offer = { type: 'component:offer', turnId: 't1', offerId: 'o1', componentId: 'x', name: 'X', reason: 'r' } as const;
  it('opening another chat drops a pending offer', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: offer, at: 2 });
    expect(store.getState().session.componentOffers).toHaveLength(1);
    store.dispatch({ type: 'session/browse', activeId: 'b', turns: [] } as never);
    expect(store.getState().session.componentOffers ?? []).toHaveLength(0);
  });
  it('a settled turn leaves no pending offer', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: offer, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'done' }, at: 3 });
    expect(store.getState().session.componentOffers ?? []).toHaveLength(0);
  });
});

describe('review fixes: retry, keyboard and the off state', () => {
  it('a 404 listing is asked again the next time the menu opens', async () => {
    let n = 0;
    const { client } = fakeClient();
    const flaky: ComponentsClient = { ...client, list: async () => (++n < 2 ? null : LISTING) };
    draw(flaky);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    await act(async () => {});
    expect(screen.queryByTestId('v3-tools-components')).toBeNull();
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    expect(await screen.findByTestId('v3-tools-components')).toBeTruthy();
  });

  it('the picker takes focus, arrows move, Escape returns focus to the composer', async () => {
    const { client } = fakeClient();
    draw(client);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    fireEvent.click(await screen.findByTestId('v3-tools-components'));
    const items = screen.getAllByTestId('components-item');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'Escape' });
    expect(screen.queryByTestId('components-picker')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('composer-field'));
  });

  it('/components says they are off and offers to turn them on', async () => {
    const { client, calls } = fakeClient({ ...LISTING, enabled: false });
    draw(client);
    const field = screen.getByTestId('composer-field');
    fireEvent.change(field, { target: { value: '/' } });
    await act(async () => {});
    fireEvent.change(field, { target: { value: '/components' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByTestId('components-off')).toBeTruthy();
    fireEvent.click(screen.getByTestId('components-turn-on'));
    await waitFor(() => expect(calls.settings).toEqual([{ enabled: true }]));
  });
});
