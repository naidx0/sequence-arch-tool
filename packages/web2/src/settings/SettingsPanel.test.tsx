import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { resolvedStyle } from '../../test/support/css';

import '../tokens/graphite.css';
import './settings.css';

import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';
import type { GetAiConfigResponse } from '@sequence/api-types';

/**
 * `Ctrl-K → Settings` SAID "BUILT IN A LATER WAVE."
 *
 * The register recorded why that mattered more than a missing panel usually
 * does: the free-tier message tells a user to add their own key, and there was
 * no way to add one. The whole path out of "the free default is unavailable"
 * ended in a dead end, so a real user's first blocked question was their last.
 *
 * THE SECURITY PROPERTY IS THE FIRST TEST IN THIS FILE, not the last. The key
 * goes one way: `GET /api/ai-config` answers with `••••` plus four characters,
 * and there is no request this panel can make that returns a usable key. A
 * panel that put one in an input would put it in every screenshot and every bug
 * report.
 */

interface Call {
  method: string;
  body: unknown;
}

function recorder(
  get: GetAiConfigResponse,
  putStatus = 200,
  putBody?: unknown,
  hooksBody?: unknown,
  /**
   * Is the repository trusted, as `/api/auto-approve` reports it?
   *
   * Default FALSE, which is the product's own default and the state most of
   * this file's tests are actually in. The unattended mode is gated on trust,
   * so a fixture that quietly said "trusted" would let a panel test pass over a
   * grant the engine would have refused.
   */
  autoApproveTrusted = false,
) {
  const calls: Call[] = [];
  /* The session grant this fixture's server remembers, so a PUT changes what
     the next GET says — the round trip is the thing under test. */
  let autoApproveOn = false;
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, body });
    if (String(_url).startsWith('/api/auto-approve')) {
      if (method === 'PUT') {
        const wanted = (body as { on?: boolean } | null)?.on === true;
        if (wanted && !autoApproveTrusted) {
          /* The real route's 403 and its real sentence — the panel must print
             the server's words rather than inventing a second wording. */
          return new Response(
            JSON.stringify({
              error:
                'auto-approve cannot be turned on for a repository that is not trusted. ' +
                'Trust the repository in Sequence, then turn this on.',
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          );
        }
        autoApproveOn = wanted;
      }
      return new Response(
        JSON.stringify({
          root: '/repo',
          trusted: autoApproveTrusted,
          on: autoApproveOn,
          refusal: autoApproveOn ? null : 'auto-approve is off for this repository.',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (String(_url).startsWith('/api/hooks')) {
      if (method === 'PUT') {
        return new Response(JSON.stringify({ trusted: JSON.parse(String(init?.body ?? '{}')).trusted }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(hooksBody ?? { events: [], blocking: [], declared: {}, trusted: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(_url).startsWith('/api/permissions')) {
      const text =
        '{\n  "version": 1,\n  "default": "allow",\n  "denyStreak": 3,\n  "deny": [],\n  "ask": [],\n  "allow": []\n}\n';
      if (method === 'PUT') {
        return new Response(
          JSON.stringify({
            path: '.sequence/permissions.json',
            document: JSON.parse((body as { text?: string })?.text ?? text),
            text: (body as { text?: string })?.text ?? text,
            warnings: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          path: '.sequence/permissions.json',
          exists: false,
          document: {
            version: 1,
            default: 'allow',
            denyStreak: 3,
            deny: [],
            ask: [],
            allow: [],
          },
          text,
          warnings: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (String(_url).startsWith('/api/mcp')) {
      const text = '{\n  "servers": {}\n}\n';
      if (method === 'PUT') {
        const putText = (body as { text?: string })?.text ?? text;
        const document = JSON.parse(putText) as { servers: Record<string, unknown> };
        return new Response(
          JSON.stringify({
            path: '.sequence/mcp.json',
            document,
            text: putText,
            warnings: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          path: '.sequence/mcp.json',
          exists: false,
          document: { servers: {} },
          text,
          warnings: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (method === 'PUT') {
      return new Response(JSON.stringify(putBody ?? { configured: true, provider: 'anthropic', model: 'm', apiKey: '••••abcd' }), {
        status: putStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(get), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, client: createSettingsClient(fetchImpl) };
}

const CONFIGURED: GetAiConfigResponse = {
  configured: true,
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKey: '••••9f3a',
} as GetAiConfigResponse;

const UNCONFIGURED = { configured: false } as GetAiConfigResponse;

const DEFAULT_MODE = {
  configured: true,
  mode: 'default',
  model: 'free-default',
  gatewayLive: false,
} as unknown as GetAiConfigResponse;

describe('SettingsPanel', () => {
  /* ═══ the key never reaches the screen ══════════════════════════════════ */

  it('never puts a key in the field, not even the masked one', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel client={client} />);
    await screen.findByTestId('settings-current');

    const field = screen.getByTestId('settings-apikey') as HTMLInputElement;
    /*
     * Empty, and that is load-bearing twice over. The wire carries a MASK, and a
     * masked value sitting in an editable field would be submitted verbatim by
     * the next Save — storing the literal string "••••9f3a" as someone's API
     * key.
     */
    expect(field.value).toBe('');
    expect(field.type).toBe('password');
  });

  it('recommends a faster model for design sketching without auto-switching (A2.9)', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel client={client} />);
    await screen.findByTestId('settings-current');
    const hint = screen.getByTestId('settings-design-model-hint');
    expect(hint.textContent).toMatch(/faster model/i);
    expect(hint.textContent).toMatch(/does not switch models/i);
  });

  it('says a key is stored, and how to keep it', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel client={client} />);
    /* "Why is this box empty" is the first question anyone opening this panel
       has, so it is answered before they ask it. Wait for CONFIGURED hydrate —
       the hint mounts immediately with the no-key sentence, then swaps. */
    await screen.findByTestId('settings-current');
    const hint = await screen.findByTestId('settings-key-hint');
    expect(hint.textContent).toMatch(/never sent back/i);
    expect(hint.textContent).not.toMatch(/written to disk and never returned/i);
    expect(screen.getByTestId('settings-apikey').getAttribute('placeholder')).toMatch(/9f3a/);
  });

  it('an empty key field leaves the stored key alone — it does not clear it', async () => {
    const { calls, client } = recorder(CONFIGURED);
    render(<SettingsPanel client={client} />);
    await screen.findByTestId('settings-current');

    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'claude-opus-5' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    /*
     * `apiKey` is OMITTED, not empty. Sending `''` would ask the server to store
     * an empty key — a working setup wiped by someone who opened the panel to
     * change the model name.
     */
    expect(Object.prototype.hasOwnProperty.call(put.body as object, 'apiKey')).toBe(false);
    expect((put.body as { model: string }).model).toBe('claude-opus-5');
  });

  it('sends the key when one is typed', async () => {
    const { calls, client } = recorder(CONFIGURED);
    render(<SettingsPanel client={client} />);
    await screen.findByTestId('settings-current');

    fireEvent.change(screen.getByTestId('settings-apikey'), { target: { value: 'sk-new-key' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect((calls.find((c) => c.method === 'PUT')!.body as { apiKey: string }).apiKey).toBe('sk-new-key');
  });

  /* ═══ the states, each a different sentence ═════════════════════════════ */

  it('an unconfigured install separates model-free diagrams from chat setup', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel client={client} />);
    const note = await screen.findByTestId('settings-unconfigured');
    /* This is read immediately after chat refused a question. It must say
       which work is model-free and name both honest ways chat can run. */
    expect(note.textContent).toBe(
      'Scanning and diagrams do not need a model. Chat needs either a model running on this machine or an API key.',
    );
  });

  it('default mode with gateway down says not live yet (not “unreachable infra”)', async () => {
    const { client } = recorder(DEFAULT_MODE);
    render(<SettingsPanel client={client} />);
    const note = await screen.findByTestId('settings-default-mode');
    expect(note.textContent).toMatch(/free-default/);
    expect(note.textContent).toMatch(/not live yet/i);
    expect(note.textContent).not.toMatch(/not reachable/i);
    expect(note.textContent).toMatch(/add your own API key/i);
  });

  it('reports the SERVER’s refusal verbatim', async () => {
    const { client } = recorder(CONFIGURED, 400, { error: 'model must be a non-empty string' });
    render(<SettingsPanel client={client} />);
    await screen.findByTestId('settings-current');

    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    const failure = await screen.findByTestId('settings-failure');
    /* Rewriting it would hide the one sentence that says what to fix. */
    expect(failure.textContent).toBe('model must be a non-empty string');
    expect(screen.queryByTestId('settings-saved')).toBeNull();
  });

  it('re-renders from the RESPONSE after a save, not from the draft', async () => {
    const { client } = recorder(UNCONFIGURED, 200, {
      configured: true,
      provider: 'openai',
      model: 'gpt-x',
      apiKey: '••••1234',
    });
    render(<SettingsPanel client={client} />);
    await screen.findByTestId('settings-unconfigured');

    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'gpt-x' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    /* What is on screen is what is STORED — the PUT answers with the view a GET
       would give, `gatewayLive` stamp included, so a just-connected user is not
       told "not live" on a deploy where the gateway is. */
    const current = await screen.findByTestId('settings-current');
    expect(current.textContent).toMatch(/openai/);
    expect(await screen.findByTestId('settings-saved')).toBeTruthy();
  });

  it('Save is a different object when it is unavailable, and it is unavailable without a model', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel client={client} />);
    await screen.findByTestId('settings-unconfigured');
    /* Sheet 12.4's ruling about the send button, which holds for every control:
       disabled is not a faded accent. An unnamed model is not nearly anything. */
    expect((screen.getByTestId('settings-save') as HTMLButtonElement).disabled).toBe(true);
  });

  /* ═══ hooks — the consent that made the feature reachable ═══════════════ */

  it('no hooks declared means no consent control — a question about nothing', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel client={client} />);
    await screen.findByTestId('settings-current');
    /* A consent control for a feature nothing is using asks about a thing that
       is not happening. */
    expect(screen.queryByTestId('settings-hooks')).toBeNull();
  });

  it('declared hooks are NAMED, with what they can do', async () => {
    const { client } = recorder(CONFIGURED, 200, undefined, {
      events: ['pre-write', 'pre-commit', 'post-tool'],
      blocking: ['pre-write', 'pre-commit'],
      live: ['pre-write', 'pre-commit'],
      declared: {
        'pre-commit': [{ command: ['pnpm', 'lint'] }],
        'post-tool': [{ command: ['./log.sh'] }],
      },
      trusted: false,
    });
    render(<SettingsPanel pane="hooks" client={client} />);

    const rows = await screen.findAllByTestId('settings-hook-row');
    /*
     * NAMED, not counted. "2 hooks" is a number; the COMMANDS are what a person
     * is being asked to consent to running on their machine.
     */
    expect(rows.map((r) => r.textContent).join(' ')).toContain('pnpm lint');
    expect(rows.map((r) => r.textContent).join(' ')).toContain('./log.sh');
    /* And which of them can stop what you were doing — only LIVE blocking events. */
    expect(rows.find((r) => r.textContent?.includes('pnpm lint'))!.textContent).toContain('can block');
    expect(rows.find((r) => r.textContent?.includes('./log.sh'))!.textContent).not.toContain(
      'can block',
    );
    expect(rows.find((r) => r.textContent?.includes('./log.sh'))!.textContent).toContain(
      'does not fire yet',
    );
  });

  it('names unfired declared events instead of implying they run (B5.1)', async () => {
    const warning = 'pre-tool is configured but never fires yet.';
    const { client } = recorder(CONFIGURED, 200, undefined, {
      events: ['pre-tool', 'pre-write'],
      blocking: ['pre-tool', 'pre-write'],
      live: ['pre-write', 'pre-commit'],
      unfired: warning,
      declared: {
        'pre-tool': [{ command: ['./gate.sh'] }],
        'pre-write': [{ command: ['./check.sh'] }],
      },
      trusted: false,
    });
    render(<SettingsPanel pane="hooks" client={client} />);
    expect((await screen.findByTestId('settings-hooks-unfired')).textContent).toBe(warning);
    const rows = await screen.findAllByTestId('settings-hook-row');
    expect(rows.find((r) => r.textContent?.includes('./gate.sh'))!.textContent).toContain(
      'does not fire yet',
    );
    expect(rows.find((r) => r.textContent?.includes('./gate.sh'))!.textContent).not.toContain(
      'can block',
    );
    expect(rows.find((r) => r.textContent?.includes('./check.sh'))!.textContent).toContain(
      'can block',
    );
  });

  it('says the sentence a person needs before saying yes', async () => {
    const { client } = recorder(CONFIGURED, 200, undefined, {
      events: ['pre-commit'],
      blocking: ['pre-commit'],
      live: ['pre-write', 'pre-commit'],
      declared: { 'pre-commit': [{ command: ['pnpm', 'lint'] }] },
      trusted: false,
    });
    render(<SettingsPanel pane="hooks" client={client} />);
    const hint = await screen.findByTestId('settings-hooks-hint');
    /* Live-only consent — dead events must not be sold as running. */
    expect(hint.textContent).toMatch(/Only live hooks/i);
    expect(hint.textContent).toMatch(/pre-write/);
    expect(hint.textContent).toMatch(/committed/);
    expect(hint.textContent).toMatch(/repository you trust/i);
  });

  it('granting and revoking both work — consent is not a one-way door', async () => {
    const { calls, client } = recorder(CONFIGURED, 200, undefined, {
      events: ['pre-commit'],
      blocking: ['pre-commit'],
      declared: { 'pre-commit': [{ command: ['pnpm', 'lint'] }] },
      trusted: false,
    });
    render(<SettingsPanel pane="hooks" client={client} />);

    const button = await screen.findByTestId('settings-hooks-trust');
    expect(button.textContent).toMatch(/Allow them to run/);
    expect((await screen.findByTestId('settings-hooks-state')).textContent).toMatch(/Not running/);

    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId('settings-hooks-state').textContent).toMatch(/Enabled/),
    );
    expect(calls.some((c) => c.method === 'PUT' && (c.body as { trusted: boolean }).trusted === true)).toBe(true);

    fireEvent.click(screen.getByTestId('settings-hooks-trust'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-hooks-state').textContent).toMatch(/Not running/),
    );
  });

  /* ═══ notifications — asked for, never sprung ═══════════════════════════ */

  it('NO PROMPT is raised by opening Settings', async () => {
    let asked = 0;
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'default',
      requestPermission: async () => {
        asked += 1;
        return 'granted';
      },
    };
    try {
      const { client } = recorder(CONFIGURED);
      render(<SettingsPanel pane="notifications" client={client} />);
      await screen.findByTestId('settings-notify');
      /*
       * THE WHOLE RULING THIS WAS BLOCKED ON. A denial persists past the session
       * and the prompt is one-shot; springing it on open spends a permission we
       * cannot ask for twice, at the moment the reader is least willing to
       * grant it. Reading `Notification.permission` raises nothing.
       */
      expect(asked).toBe(0);
      expect(screen.getByTestId('settings-notify-detail').textContent).toMatch(
        /ask for permission once/i,
      );
    } finally {
      delete (globalThis as { Notification?: unknown }).Notification;
    }
  });

  it('the prompt is raised by the CLICK, and granting turns it on', async () => {
    let asked = 0;
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'default',
      requestPermission: async () => {
        asked += 1;
        return 'granted';
      },
    };
    try {
      const { client } = recorder(CONFIGURED);
      render(<SettingsPanel pane="notifications" client={client} />);
      fireEvent.click(await screen.findByTestId('settings-notify-toggle'));

      await waitFor(() => expect(asked).toBe(1));
      /* Granting IS the intention behind the click; asking them to click twice
         for one intention would be a second question they already answered. */
      await waitFor(() =>
        expect(screen.getByTestId('settings-notify-toggle').textContent).toMatch(/Stop telling me/),
      );
    } finally {
      delete (globalThis as { Notification?: unknown }).Notification;
    }
  });

  it('a browser that blocked us says where to undo it, and offers no dead switch', async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'denied',
      requestPermission: async () => 'denied',
    };
    try {
      const { client } = recorder(CONFIGURED);
      render(<SettingsPanel pane="notifications" client={client} />);
      const detail = await screen.findByTestId('settings-notify-detail');
      expect(detail.textContent).toMatch(/site settings/i);
      /* A switch that cannot turn on is one a reader clicks until they conclude
         the feature is broken. */
      expect((screen.getByTestId('settings-notify-toggle') as HTMLButtonElement).disabled).toBe(true);
    } finally {
      delete (globalThis as { Notification?: unknown }).Notification;
    }
  });

  it('a browser without notifications says so rather than offering nothing', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel pane="notifications" client={client} />);
    const detail = await screen.findByTestId('settings-notify-detail');
    expect(detail.textContent).toMatch(/does not support/i);
  });

  it('a failed read is reported rather than shown as an empty form', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'no repository is attached' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    render(<SettingsPanel client={createSettingsClient(fetchImpl)} />);
    const failure = await screen.findByTestId('settings-failure');
    expect(failure.textContent).toMatch(/no repository is attached/);
  });
});

/**
 * THE PANE THE CALLER ASKED FOR.
 *
 * `ShellOverlay` has carried `{ kind: 'settings'; pane }` from the beginning
 * and every caller passes one — the failure strip's "Open Settings" dispatches
 * `pane: 'provider'`, which is now the single most likely reason anyone opens
 * this panel at all. THE PANEL NEVER READ IT, so a reader landed at the top of
 * a long scroll instead.
 */
describe('opening on a pane', () => {
  it('shows the one that was asked for, and not the others', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="notifications" client={client} />);

    await screen.findByTestId('settings-notify');
    expect(screen.queryByTestId('settings-provider')).toBeNull();
  });

  it('uses a left sidebar nav and one scrolling body box', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel client={client} />);

    const nav = await screen.findByTestId('settings-nav');
    const body = screen.getByTestId('settings-body');
    expect(nav.classList.contains('settings-nav')).toBe(true);
    expect(body.classList.contains('settings-body')).toBe(true);
    expect(nav.querySelector('.settings-nav-item')).toBeTruthy();
    expect(nav.querySelector('.settings-tab')).toBeNull();
  });

  it('defaults to the provider pane', async () => {
    /* The honest default: with no model configured the assistant cannot
       answer at all, so it is the one that blocks everything else. */
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel client={client} />);

    await screen.findByTestId('settings-nav');
    expect(screen.getByTestId('settings-nav-provider').getAttribute('aria-selected')).toBe('true');
  });

  it('lets a reader move between panes without leaving', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel client={client} />);

    await screen.findByTestId('settings-nav');
    fireEvent.click(screen.getByTestId('settings-nav-notifications'));

    expect(screen.getByTestId('settings-nav-notifications').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('settings-nav-provider').getAttribute('aria-selected')).toBe('false');
    await screen.findByTestId('settings-notify');
    expect(screen.getByTestId('settings-body').contains(screen.getByTestId('settings-notify'))).toBe(true);
  });

  it('an unknown pane opens provider rather than an empty frame', async () => {
    const { client } = recorder(UNCONFIGURED);
    /* The old union named 'appearance'. A panel opened on a pane that does not
       exist showing nothing would be worse than ignoring the request. */
    render(<SettingsPanel pane={'appearance' as never} client={client} />);

    await screen.findByTestId('settings-nav');
    expect(screen.getByTestId('settings-nav-provider').getAttribute('aria-selected')).toBe('true');
  });

  it('keeps one compact frame size when switching panes', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel client={client} />);
    const panel = await screen.findByTestId('settings-panel');
    await screen.findByTestId('settings-provider');

    const frameSize = () => ({
      width: resolvedStyle(panel, 'width'),
      height: resolvedStyle(panel, 'height'),
      maxWidth: resolvedStyle(panel, 'max-width'),
      maxHeight: resolvedStyle(panel, 'max-height'),
    });

    const before = frameSize();
    expect(before.width).toBe('calc(320px * 2 + 56px)');
    expect(before.height).toBe('calc(30px * 21)');

    fireEvent.click(screen.getByTestId('settings-nav-notifications'));
    await screen.findByTestId('settings-notify');

    expect(frameSize()).toEqual(before);
  });
});

/**
 * THE PANEL ASKS WHICH HOST IT IS IN.
 *
 * `notifyModel` now words its sentences for a desktop app or a browser tab,
 * and a pure-function test proves it does. That is exactly the half that keeps
 * dying in this codebase: deleting the panel's `{ desktop: isDesktop() }` left
 * every one of those tests green, because none of them asserted THE CALL.
 *
 * Sequence is downloaded and run locally, so the desktop wording is the one a
 * real user reads.
 */
describe('notification copy in a desktop build', () => {
  afterEach(() => {
    delete (window as unknown as { sequence?: unknown }).sequence;
  });

  /** The shape `isDesktop` actually tests for — a bridge that can open a repo. */
  function installBridge() {
    (window as unknown as { sequence?: unknown }).sequence = {
      openRepo: async () => null,
    };
  }

  it('never tells a desktop reader to open browser site settings', async () => {
    installBridge();
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: Object.assign(function () {}, { permission: 'denied' }),
    });

    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="notifications" client={client} />);

    const detail = await screen.findByTestId('settings-notify-detail');
    expect(detail.textContent).not.toMatch(/browser/i);
    expect(detail.textContent).toMatch(/system notification settings/i);
  });

  it('keeps the browser wording when there is no bridge', async () => {
    /* Sequence also runs in a tab from `sequence app`, and there "your
       browser's site settings" is the correct instruction. */
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: Object.assign(function () {}, { permission: 'denied' }),
    });

    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="notifications" client={client} />);

    const detail = await screen.findByTestId('settings-notify-detail');
    expect(detail.textContent).toMatch(/browser/i);
  });
});

describe('P3 permissions editor', () => {
  it('shows Tool permissions on Workspace while the GET is still pending', async () => {
    /* Seat Gate 2: gating the whole section on permExists !== null hid it
       forever after a failed/aborted first fetch until a full reload. */
    const { client } = recorder(UNCONFIGURED);
    const slow = {
      ...client,
      permissions: () => new Promise(() => {}) as ReturnType<typeof client.permissions>,
    };
    render(<SettingsPanel pane="workspace" client={slow} />);
    expect(await screen.findByTestId('settings-permissions')).toBeTruthy();
    expect(screen.getByTestId('settings-permissions-loading').textContent).toMatch(/Loading/);
  });

  it('loads permissions text on Workspace and Save posts PUT /api/permissions', async () => {
    const { client, calls } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="workspace" client={client} />);

    const area = await screen.findByTestId('settings-permissions-text');
    expect((area as HTMLTextAreaElement).value).toContain('"default"');
    expect(screen.getByTestId('settings-permissions-deny-streak-hint').textContent).toMatch(
      /denyStreak|circuit breaker/i,
    );

    fireEvent.change(area, {
      target: {
        value: JSON.stringify({
          version: 1,
          default: 'deny',
          denyStreak: 3,
          deny: [],
          ask: [],
          allow: ['read_file'],
        }),
      },
    });
    fireEvent.click(screen.getByTestId('settings-permissions-save'));

    await screen.findByTestId('settings-permissions-saved');
    const put = calls.find((c) => c.method === 'PUT' && (c.body as { text?: string })?.text?.includes('"deny"'));
    expect(put, 'expected a PUT with permissions text').toBeTruthy();
  });
});

/*
 * AUTO-APPROVE — the unattended autonomy mode, from the user's seat.
 *
 * The engine locks live in `packages/analyzer/src/test/auto-approve.test.ts`.
 * These two cover the half a user actually meets: the switch is REFUSED on an
 * untrusted repository and says why, and on a trusted one it grants for the
 * session through the wire rather than into localStorage.
 */
describe('auto-approve (unattended mode)', () => {
  it('is disabled on an untrusted repository, and names trust as the reason', async () => {
    const { client, calls } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="workspace" client={client} />);

    const row = await screen.findByTestId('settings-autonomy-autoapprove');
    const box = row.querySelector('input') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled, 'an untrusted repo must not offer the grant').toBe(true);
    expect(row.textContent).toMatch(/Trust this repository first/);
    /* And nothing was written: the panel may not send a grant it knows is
       refused, and the GET is the only call this row makes on load. */
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('grants for the session on a trusted repository, through the wire', async () => {
    const { client, calls } = recorder(UNCONFIGURED, 200, undefined, undefined, true);
    render(<SettingsPanel pane="workspace" client={client} />);

    const row = await screen.findByTestId('settings-autonomy-autoapprove');
    const box = row.querySelector('input') as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(false);

    fireEvent.click(box);

    await waitFor(() => {
      expect(
        (screen.getByTestId('settings-autonomy-autoapprove').querySelector('input') as HTMLInputElement)
          .checked,
      ).toBe(true);
    });
    const put = calls.find((c) => c.method === 'PUT' && (c.body as { on?: boolean })?.on === true);
    expect(put, 'the grant must go to the server, not to localStorage').toBeTruthy();
    /* SESSION-SCOPED: nothing about it may be written where a reload could read
       it back. A remembered `on` would be the panel claiming an autonomy the
       server drops on restart. */
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i) ?? '';
      expect(key).not.toMatch(/auto-?approve/i);
      expect(window.localStorage.getItem(key) ?? '').not.toMatch(/auto-?approve/i);
    }
  });
});

describe('C2.2 MCP config editor', () => {
  it('loads mcp.json on Workspace and Save posts PUT /api/mcp', async () => {
    const { client, calls } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="workspace" client={client} />);

    const area = await screen.findByTestId('settings-mcp-text');
    expect((area as HTMLTextAreaElement).value).toContain('"servers"');

    fireEvent.change(screen.getByTestId('settings-mcp-add-name'), { target: { value: 'demo' } });
    fireEvent.change(screen.getByTestId('settings-mcp-add-command'), { target: { value: 'node' } });
    fireEvent.change(screen.getByTestId('settings-mcp-add-args'), { target: { value: 'server.js' } });
    fireEvent.click(screen.getByTestId('settings-mcp-add-btn'));
    expect((area as HTMLTextAreaElement).value).toMatch(/"demo"/);

    fireEvent.click(screen.getByTestId('settings-mcp-save'));
    await screen.findByTestId('settings-mcp-saved');
    const put = calls.find(
      (c) => c.method === 'PUT' && (c.body as { text?: string })?.text?.includes('"demo"'),
    );
    expect(put, 'expected a PUT with mcp.json text').toBeTruthy();
  });
});
