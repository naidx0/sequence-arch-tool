import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolvedStyle } from '../../test/support/css';

import '../tokens/graphite.css';
import './settings.css';
import settingsCss from './settings.css?raw';

import { SettingsPanel } from './SettingsPanel';
import { resetToolDetailForTest, writeToolDetail } from './toolDetailPreference';
import { createSettingsClient } from './settingsClient';
import type { GetAiConfigResponse } from '@sequence/api-types';

it('changes Light, Dark and System through a segmented picker and remembers the exact seq.theme key', async () => {
  const { client } = recorder(CONFIGURED);
  const view = render(<SettingsPanel pane="app" client={client} />);
  const group = await screen.findByRole('radiogroup', { name: 'Theme' });
  /* One control, three equal segments, each an icon and a label. */
  const radios = within(group).getAllByRole('radio');
  expect(radios.map((r) => r.textContent)).toEqual(['Light', 'Dark', 'System']);
  expect(radios.map((r) => r.querySelector('svg')?.getAttribute('data-icon'))).toEqual(['sun', 'moon', 'monitor']);
  expect(screen.queryByRole('combobox', { name: 'Theme' })).toBeNull();
  fireEvent.click(radios[0]!);
  expect(localStorage.getItem('seq.theme')).toBe('light');
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(within(group).getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
  expect(within(group).getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('false');
  view.unmount();
  render(<SettingsPanel pane="app" client={client} />);
  const again = await screen.findByRole('radiogroup', { name: 'Theme' });
  expect(within(again).getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.click(within(again).getByRole('radio', { name: 'System' }));
  expect(localStorage.getItem('seq.theme')).toBe('system');
});

it('the theme radios are one tab stop and the arrow keys move and select, wrapping', async () => {
  localStorage.setItem('seq.theme', 'dark');
  const { client } = recorder(CONFIGURED);
  render(<SettingsPanel pane="app" client={client} />);
  const group = await screen.findByRole('radiogroup', { name: 'Theme' });
  const r = () => within(group).getAllByRole('radio');
  expect(r().map((x) => x.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  fireEvent.keyDown(r()[1]!, { key: 'ArrowRight' });
  expect(localStorage.getItem('seq.theme')).toBe('system');
  expect(r().map((x) => x.getAttribute('tabindex'))).toEqual(['-1', '-1', '0']);
  expect(document.activeElement).toBe(r()[2]);
  fireEvent.keyDown(r()[2]!, { key: 'ArrowDown' });
  expect(localStorage.getItem('seq.theme')).toBe('light');
  fireEvent.keyDown(r()[0]!, { key: 'ArrowLeft' });
  expect(localStorage.getItem('seq.theme')).toBe('system');
  fireEvent.keyDown(r()[2]!, { key: 'ArrowUp' });
  expect(localStorage.getItem('seq.theme')).toBe('dark');
});

it('lays the theme segments out as equal-width columns in one font', () => {
  const css = settingsCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim() === sel).map((m) => m[2]).join(';');
  const track = rule('.settings-scope .sb-seg');
  expect(track).toMatch(/grid-auto-columns:\s*1fr/);
  const seg = rule('.settings-scope .sb-seg button');
  expect(seg).toMatch(/font:\s*inherit/);
  expect(seg).toMatch(/min-width:/);
});

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

/** The add-a-model form belongs to the API key choice: nothing of it is drawn until that door is opened. */
function openApiKey() {
  const door = screen.getAllByTestId('settings-choice').find((c) => c.getAttribute('data-choice') === 'key')!;
  fireEvent.click(door.querySelector('[data-testid="settings-choice-toggle"]')!);
}

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
  /* `GET /api/skills` — what the harness reads before it answers. A
     default that is VALID and EMPTY, so every test that does not care
     still exercises the narrowing rather than the failure path. */
  skillsBody: unknown = { dir: '.sequence/skills', skills: [], warnings: [], trusted: false, instructions: null },
) {
  const calls: Call[] = [];
  /* The session grant this fixture's server remembers, so a PUT changes what
     the next GET says — the round trip is the thing under test. */
  let autoApproveOn = false;
  /* Trust can be GRANTED through the wire now, and the next auto-approve read
     reports it — the round trip the Trust button exists for. */
  let repoTrusted = autoApproveTrusted;
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, body });
    if (String(_url).startsWith('/api/repo-trust')) {
      if (method === 'PUT') repoTrusted = (body as { trusted?: boolean } | null)?.trusted === true;
      return new Response(JSON.stringify({ root: '/repo', trusted: repoTrusted }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(_url).startsWith('/api/auto-approve')) {
      if (method === 'PUT') {
        const wanted = (body as { on?: boolean } | null)?.on === true;
        if (wanted && !repoTrusted) {
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
          trusted: repoTrusted,
          on: autoApproveOn,
          refusal: autoApproveOn ? null : 'auto-approve is off for this repository.',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (String(_url).startsWith('/api/skills')) {
      return new Response(JSON.stringify(skillsBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
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
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findByTestId('settings-current');
    openApiKey();

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
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findByTestId('settings-current');
    const hint = screen.getByTestId('settings-design-model-hint');
    expect(hint.textContent).toMatch(/faster model/i);
    expect(hint.textContent).toMatch(/does not switch models/i);
  });

  it('says a key is stored, and how to keep it', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);
    /* "Why is this box empty" is the first question anyone opening this panel
       has, so it is answered before they ask it. Wait for CONFIGURED hydrate —
       the hint mounts immediately with the no-key sentence, then swaps. */
    await screen.findByTestId('settings-current');
    openApiKey();
    const hint = await screen.findByTestId('settings-key-hint');
    expect(hint.textContent).toMatch(/never sent back/i);
    expect(hint.textContent).not.toMatch(/written to disk and never returned/i);
    expect(screen.getByTestId('settings-apikey').getAttribute('placeholder')).toMatch(/9f3a/);
  });

  it('an empty key field leaves the stored key alone — it does not clear it', async () => {
    const { calls, client } = recorder(CONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findByTestId('settings-current');
    openApiKey();

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
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findByTestId('settings-current');
    openApiKey();

    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'claude-opus-5' } });
    fireEvent.change(screen.getByTestId('settings-apikey'), { target: { value: 'sk-new-key' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect((calls.find((c) => c.method === 'PUT')!.body as { apiKey: string }).apiKey).toBe('sk-new-key');
  });

  /* ═══ the states, each a different sentence ═════════════════════════════ */

  it('an unconfigured install separates model-free diagrams from chat setup', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);
    const note = await screen.findByTestId('settings-unconfigured');
    /* This is read immediately after chat refused a question. It must say
       which work is model-free and name both honest ways chat can run. */
    expect(note.textContent).toBe(
      'Chat needs a model. Scanning and diagrams do not.',
    );
  });

  it('default mode with gateway down says not live yet (not “unreachable infra”)', async () => {
    const { client } = recorder(DEFAULT_MODE);
    render(<SettingsPanel pane="models" client={client} />);
    const note = await screen.findByTestId('settings-default-mode');
    expect(note.textContent).toMatch(/free-default/);
    expect(note.textContent).toMatch(/not live yet/i);
    expect(note.textContent).not.toMatch(/not reachable/i);
    expect(note.textContent).toMatch(/add your own API key/i);
  });

  it('reports the SERVER’s refusal verbatim', async () => {
    const { client } = recorder(CONFIGURED, 400, { error: 'model must be a non-empty string' });
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findByTestId('settings-current');
    openApiKey();

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
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findByTestId('settings-unconfigured');
    openApiKey();

    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'gpt-x' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    /* What is on screen is what is STORED — the PUT answers with the view a GET
       would give, `gatewayLive` stamp included, so a just-connected user is not
       told "not live" on a deploy where the gateway is. */
    const current = await screen.findByTestId('settings-current');
    expect(current.textContent).toMatch(/^Using gpt-x$/);
    expect(current.textContent).not.toMatch(/openai-compatible|anthropic:/);
    expect(await screen.findByTestId('settings-saved')).toBeTruthy();
  });

  it('Save is a different object when it is unavailable, and it is unavailable without a model', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findByTestId('settings-unconfigured');
    openApiKey();
    /* Sheet 12.4's ruling about the send button, which holds for every control:
       disabled is not a faded accent. An unnamed model is not nearly anything. */
    expect((screen.getByTestId('settings-save') as HTMLButtonElement).disabled).toBe(true);
  });

  /* ═══ hooks — the consent that made the feature reachable ═══════════════ */

  it('no hooks declared means no consent control — a question about nothing', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);
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
    expect(hint.textContent).toMatch(/project you trust/i);
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

  it('General holds ONE control for a run that finishes: the attention switches, no second "Run notification" card', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel pane="notifications" client={client} />);
    /* AttentionSetting is a lazy chunk: its first import can outlast the 1 s default while the whole suite runs. */
    await screen.findByTestId('settings-attention', undefined, { timeout: 10_000 });
    expect(screen.queryByTestId('settings-notify')).toBeNull();
    expect(screen.queryByTestId('settings-notify-toggle')).toBeNull();
    const body = screen.getByTestId('settings-body').textContent ?? '';
    expect(body.match(/when (a|an) (run|agent)[^.]*(finishes|ends)/gi) ?? []).toHaveLength(1);
    expect(body).not.toMatch(/Notification when a run finishes/);
  });

  it('a browser without notifications says so rather than offering dead switches in silence', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel pane="notifications" client={client} />);
    const note = await screen.findByTestId('settings-attention-unsupported', undefined, { timeout: 10_000 });
    expect(note.textContent).toMatch(/not available/i);
    expect((screen.getByTestId('settings-attention-turns').querySelector('input') as HTMLInputElement).disabled).toBe(true);
  });

  it('NO PROMPT is raised by opening Settings; the click on a switch raises it once and granting turns it on', async () => {
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
      const row = await screen.findByTestId('settings-attention-turns');
      expect(asked).toBe(0);
      fireEvent.click(row.querySelector('input')!);
      await waitFor(() => expect(asked).toBe(1));
      await waitFor(() => expect((row.querySelector('input') as HTMLInputElement).checked).toBe(true));
    } finally {
      delete (globalThis as { Notification?: unknown }).Notification;
    }
  });

  it('a browser that blocked us offers no dead switch', async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'denied',
      requestPermission: async () => 'denied',
    };
    try {
      const { client } = recorder(CONFIGURED);
      render(<SettingsPanel pane="notifications" client={client} />);
      const row = await screen.findByTestId('settings-attention-turns');
      expect((row.querySelector('input') as HTMLInputElement).disabled).toBe(true);
      expect(screen.getByTestId('settings-attention-denied').textContent).toMatch(/blocked.*site settings/i);
    } finally {
      delete (globalThis as { Notification?: unknown }).Notification;
    }
  });

  it('a failed read is reported rather than shown as an empty form', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'no repository is attached' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    render(<SettingsPanel pane="models" client={createSettingsClient(fetchImpl)} />);
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

    await screen.findByTestId('settings-attention');
    expect(screen.queryByTestId('settings-presets')).toBeNull();
  });

  it('uses a left sidebar nav and one scrolling body box', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);

    const nav = await screen.findByTestId('settings-nav');
    const body = screen.getByTestId('settings-body');
    /* Decision 49: B's nav, rows with an icon and a word, beside one
       scrolling body; still no top tab bar. */
    expect(nav.classList.contains('sb-nav')).toBe(true);
    expect(body.classList.contains('sb-body')).toBe(true);
    const item = nav.querySelector('.sb-nav-it')!;
    expect(item.querySelector('svg[data-icon]')).toBeTruthy();
    /* Round 7 (A9): six short stops, the connect flow first. */
    expect([...nav.querySelectorAll('.sb-nav-it')].map((b) => b.textContent)).toEqual(['Agents', 'Models', 'Skills', 'General', 'Safety', 'Workspace']);
    expect(item.textContent).toBe('Agents');
    expect(nav.querySelector('.settings-tab')).toBeNull();
  });

  it('defaults to the provider pane', async () => {
    /* The honest default: with no model configured the assistant cannot
       answer at all, so it is the one that blocks everything else. */
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);

    await screen.findByTestId('settings-nav');
    expect(screen.getByTestId('settings-nav-models').getAttribute('aria-selected')).toBe('true');
  });

  it('lets a reader move between panes without leaving', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);

    await screen.findByTestId('settings-nav');
    fireEvent.click(screen.getByTestId('settings-nav-app'));

    expect(screen.getByTestId('settings-nav-app').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('settings-nav-models').getAttribute('aria-selected')).toBe('false');
    await screen.findByTestId('settings-attention');
    expect(screen.getByTestId('settings-body').contains(screen.getByTestId('settings-attention'))).toBe(true);
  });

  it('switching panes opens the new one at its top, not at the previous scroll offset', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findByTestId('settings-nav');
    const body = screen.getByTestId('settings-body');
    body.scrollTop = 480;
    expect(body.scrollTop).toBe(480);
    fireEvent.click(screen.getByTestId('settings-nav-workspace'));
    await screen.findByTestId('settings-mcp');
    expect(body.scrollTop).toBe(0);
    body.scrollTop = 300;
    fireEvent.click(screen.getByTestId('settings-nav-app'));
    await screen.findByTestId('settings-attention');
    expect(body.scrollTop).toBe(0);
  });

  it('each of the stops shows its own rows and none of the others', async () => {
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findByTestId('settings-nav');
    const where: Record<string, string[]> = {
      models: ['settings-presets'],
      app: ['settings-attention', 'settings-appearance'],
      safety: ['settings-autonomy', 'settings-permissions'],
      skills: ['settings-skills'],
      workspace: ['settings-mcp'],
    };
    for (const [tab, ids] of Object.entries(where)) {
      fireEvent.click(screen.getByTestId(`settings-nav-${tab}`));
      for (const id of ids) expect(await screen.findByTestId(id), `${id} on ${tab}`).toBeTruthy();
      for (const [other, otherIds] of Object.entries(where)) {
        if (other === tab) continue;
        for (const id of otherIds) expect(screen.queryByTestId(id), `${id} must not show on ${tab}`).toBeNull();
      }
    }
  });

  it('an unknown pane opens Agents rather than an empty frame', async () => {
    const { client } = recorder(UNCONFIGURED);
    /* The old union named 'appearance'. A panel opened on a pane that does not
       exist showing nothing would be worse than ignoring the request. */
    render(<SettingsPanel pane={'appearance' as never} client={client} />);

    await screen.findByTestId('settings-nav');
    expect(screen.getByTestId('settings-nav-agents').getAttribute('aria-selected')).toBe('true');
  });

  it('keeps one compact frame size when switching panes', async () => {
    const { client } = recorder(CONFIGURED);
    render(<SettingsPanel pane="models" client={client} />);
    const panel = await screen.findByTestId('settings-panel');
    await screen.findByTestId('settings-presets');

    const frameSize = () => ({
      width: resolvedStyle(panel, 'width'),
      height: resolvedStyle(panel, 'height'),
      maxWidth: resolvedStyle(panel, 'max-width'),
      maxHeight: resolvedStyle(panel, 'max-height'),
    });

    const before = frameSize();
    expect(before.width).toBe('calc(320px * 2 + 56px)');
    expect(before.height).toBe('calc(30px * 21)');

    fireEvent.click(screen.getByTestId('settings-nav-app'));
    await screen.findByTestId('settings-attention');

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

    const section = await screen.findByTestId('settings-attention');
    expect(section.textContent).not.toMatch(/browser/i);
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
    const section = await screen.findByTestId('settings-attention');
    expect(section.textContent).toMatch(/browser.s site settings/i);
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
    render(<SettingsPanel pane="safety" client={slow} />);
    expect(await screen.findByTestId('settings-permissions')).toBeTruthy();
    expect(screen.getByTestId('settings-permissions-loading').textContent).toMatch(/Loading/);
  });

  it('the architecture-map setting is lazy-loaded and renders when Workspace opens', async () => {
    const { client } = recorder(UNCONFIGURED);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) =>
      String(url) === '/api/agent-settings'
        ? new Response(JSON.stringify({ includeArchitectureMap: true, map: { tokens: 602 } }), { status: 200 })
        : realFetch(url)) as typeof fetch;
    try {
      /* WAIT FOR THE CHUNK, NOT FOR TIME. React.lazy imports the module the
         first time it renders, and under load that transform outran
         findByTestId's 1s window (1.07s, coordinator 2026-10-06). Awaiting the
         same import first puts it in the module cache, so the lazy boundary
         resolves on a microtask and the wait below measures only the panel. */
      await import('./AgentMapSetting');
      render(<SettingsPanel pane="workspace" client={client} />);
      /* A separate chunk, behind React.lazy: the boot bundle carries none of it
         (tools/measure/perf-counts.mjs measures that); here it must still arrive. */
      expect(await screen.findByTestId('settings-agent-map')).toBeTruthy();
      await waitFor(() => expect(screen.getByTestId('settings-agent-map-status').textContent).toMatch(/the map is about 602 tokens/));
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('loads permissions text on Workspace and Save posts PUT /api/permissions', async () => {
    const { client, calls } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="safety" client={client} />);

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
    render(<SettingsPanel pane="safety" client={client} />);

    const row = await screen.findByTestId('settings-autonomy-autoapprove');
    const box = row.querySelector('input') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled, 'an untrusted repo must not offer the grant').toBe(true);
    expect(row.textContent).toMatch(/Trust this project first/);
    /* And nothing was written: the panel may not send a grant it knows is
       refused, and the GET is the only call this row makes on load. */
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('grants for the session on a trusted repository, through the wire', async () => {
    const { client, calls } = recorder(UNCONFIGURED, 200, undefined, undefined, true);
    render(<SettingsPanel pane="safety" client={client} />);

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

describe('trusting the repository from Settings (owner, 2026-09-22)', () => {
  it('untrusted → Trust this repository → the box enables → it can be ticked', async () => {
    /* "The run unattended auto approve trust repository check mark isn't
       letting me tick it." The V3 shell had no control that trusts a repo. */
    const { client, calls } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="safety" client={client} />);
    const row = await screen.findByTestId('settings-autonomy-autoapprove');
    expect((row.querySelector('input') as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('settings-trust-repo'));
    await waitFor(() => {
      expect(
        (screen.getByTestId('settings-autonomy-autoapprove').querySelector('input') as HTMLInputElement).disabled,
      ).toBe(false);
    });
    expect(calls.some((c) => c.method === 'PUT' && (c.body as { trusted?: boolean })?.trusted === true)).toBe(true);
    expect(screen.queryByTestId('settings-trust-repo')).toBeNull();

    fireEvent.click(screen.getByTestId('settings-autonomy-autoapprove').querySelector('input')!);
    await waitFor(() => {
      expect(
        (screen.getByTestId('settings-autonomy-autoapprove').querySelector('input') as HTMLInputElement).checked,
      ).toBe(true);
    });
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

/* ══════════════════════════════════════════════════════════════════════════
   OWNER WALK, 2026-09-19 — what the panel stops putting in your face
   ══════════════════════════════════════════════════════════════════════════ */

const WITH_LOCAL = {
  ...CONFIGURED,
  localProviders: [
    {
      name: 'Ollama',
      baseUrl: 'http://127.0.0.1:11434',
      models: ['qwen3.5:4b', 'granite4.2:3b', 'minicpm5-hermes:latest'],
    },
  ],
} as GetAiConfigResponse;

describe('nothing is offered that has nothing behind it', () => {
  it('hides the Hooks section when this repository declares none, and keeps it when it does', async () => {
    /* "Hooks is an empty thing in settings... there's no reason to just shove
       it in for empty space." The FEATURE stays; the empty promise goes. */
    const bare = recorder(CONFIGURED, 200, undefined, {
      events: [],
      blocking: [],
      declared: {},
      trusted: false,
    });
    render(<SettingsPanel pane="safety" client={bare.client} />);
    await screen.findByTestId('settings-nav-safety');
    await waitFor(() => expect(screen.queryByTestId('settings-hooks')).toBeNull());
    expect(screen.queryByTestId('settings-nav-hooks')).toBeNull();

    cleanup();
    const withHooks = recorder(CONFIGURED, 200, undefined, {
      events: ['pre-write'],
      blocking: [],
      declared: { 'pre-write': [{ command: ['npm', 'test'] }] },
      trusted: false,
    });
    render(<SettingsPanel pane="safety" client={withHooks.client} />);
    expect(await screen.findByTestId('settings-hooks')).toBeTruthy();
  });

  it('collapses the models already installed behind a disclosure that counts them', async () => {
    /* "Local models installed... this shouldn't be automatically put out, it
       should be expandable." A dev machine has a dozen; each drew a full row
       between the reader and the form below. */
    const { client } = recorder(WITH_LOCAL);
    render(<SettingsPanel pane="models" client={client} />);
    const toggle = await screen.findByTestId('settings-local-toggle');
    expect(toggle.textContent).toMatch(/Show the 3 models already installed/);
    expect(document.getElementById('settings-local-models')?.hidden).toBe(true);

    fireEvent.click(toggle);
    expect(document.getElementById('settings-local-models')?.hidden).toBe(false);
    expect(screen.getAllByTestId('settings-local-row')).toHaveLength(3);
    expect(screen.getByTestId('settings-local-toggle').textContent).toMatch(/^Hide the/);
  });
});

describe('what steers the agent is shown, not guessed at', () => {
  /* Owner, 2026-09-19: a skill dump in Workspace, and the agents file that
     "talks directly to the harness so that it reads correctly". Both already
     worked and neither was visible from inside the product. */
  function panelWith(skillsBody: unknown) {
    const { client } = recorder(CONFIGURED, 200, undefined, undefined, false, skillsBody);
    render(<SettingsPanel pane="models" client={client} />);
  }

  it('lists the skills, the ones that did not parse, and the instruction file in use', async () => {
    panelWith({
      dir: '.sequence/skills',
      skills: [{ slug: 'gate-first', name: 'Gate first', description: 'Run the gate before pushing.' }],
      warnings: ['half-written: frontmatter has no name'],
      trusted: true,
      instructions: { file: 'AGENTS.md', bytes: 4096, truncated: false },
    });
    fireEvent.click(await screen.findByTestId('settings-nav-skills'));
    const list = await screen.findByTestId('settings-skills-list');
    expect(within(list).getByText('Gate first')).toBeTruthy();
    /* 0.1.8: the row is the name and a one-line description; the slug rides on the title, not the row's text. */
    expect(within(list).getByTestId('settings-skill-row').getAttribute('title')).toBe('Gate first (gate-first)');
    /* The one that did NOT load is the one worth saying out loud: it is on
       disk, its author believes it is live, and it is not. */
    expect(screen.getByTestId('settings-skills-warnings').textContent).toMatch(/half-written/);
    expect(screen.getByTestId('settings-skills-instructions').textContent).toMatch(
      /AGENTS\.md \(4,096 bytes\) is read on every turn/,
    );
  });

  it('says an untrusted repository is not having its instructions sent', async () => {
    panelWith({
      dir: '.sequence/skills',
      skills: [],
      warnings: [],
      trusted: false,
      instructions: { file: 'CLAUDE.md', bytes: 120, truncated: false },
    });
    fireEvent.click(await screen.findByTestId('settings-nav-skills'));
    expect((await screen.findByTestId('settings-skills-instructions')).textContent).toMatch(
      /NOT being sent, because this project is not trusted/,
    );
    expect(screen.getByTestId('settings-skills-empty').textContent).toMatch(/No skills yet/);
  });

  it('a payload of the wrong shape leaves the rest of the pane standing', async () => {
    /* THE FRAGILITY THIS SECTION ALMOST SHIPPED. Reading a wire payload
       straight into JSX puts every other section — permissions, MCP,
       autonomy — behind that payload's shape, because the throw lands in the
       same component. */
    panelWith({ nonsense: true });
    fireEvent.click(await screen.findByTestId('settings-nav-skills'));
    expect((await screen.findByTestId('settings-skills-failure')).textContent).toMatch(/invalid skills list/);
    fireEvent.click(screen.getByTestId('settings-nav-safety'));
    expect(screen.getByTestId('settings-permissions')).toBeTruthy();
  });
});


/* ══════════════════════════════════════════════════════════════════════════
   THE STATUS BAR SWITCH (Jaden, 2026-10-06: "toggleable in Settings, on/off,
   default on, persisted"). It reads and writes the shell's preference module
   (shell2/statusBarPref.ts), so the bar follows the moment it flips.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the Status bar switch', () => {
  it('is on by default, flips the stored preference, and says so as a switch', async () => {
    localStorage.removeItem('sequence.statusBar');
    const { client } = recorder(UNCONFIGURED);
    render(<SettingsPanel pane="app" client={client} />);
    const row = await screen.findByTestId('settings-status-bar');
    expect(row.textContent).toContain('Status bar');
    const sw = screen.getByTestId('settings-status-bar-switch') as HTMLInputElement;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.checked).toBe(true);

    fireEvent.click(sw);
    expect(localStorage.getItem('sequence.statusBar')).toBe('0');
    expect((screen.getByTestId('settings-status-bar-switch') as HTMLInputElement).checked).toBe(false);

    fireEvent.click(screen.getByTestId('settings-status-bar-switch'));
    expect(localStorage.getItem('sequence.statusBar')).toBe('1');
    expect((screen.getByTestId('settings-status-bar-switch') as HTMLInputElement).checked).toBe(true);
  });
});

describe('paths and keys are code, never literal markdown backticks', () => {
  it.each(['app', 'agents', 'models', 'skills', 'safety', 'workspace'] as const)('the %s pane shows no backtick', async (pane) => {
    const { client } = recorder(UNCONFIGURED);
    const { container } = render(<SettingsPanel pane={pane} client={client} />);
    if (pane === 'safety') await screen.findByTestId('settings-permissions-text');
    if (pane === 'workspace') await screen.findByTestId('settings-mcp-text');
    expect(container.textContent).not.toContain('`');
  });

  it('No permissions.json yet, the deny streak key and the mcp file are in <code>', async () => {
    const { client } = recorder(UNCONFIGURED);
    const safety = render(<SettingsPanel pane="safety" client={client} />);
    await safety.findByTestId('settings-permissions-text');
    const codes = Array.from(safety.container.querySelectorAll('[data-testid="settings-permissions"] code')).map((c) => c.textContent);
    expect(codes).toContain('.sequence/permissions.json');
    expect(codes).toContain('denyStreak');
    cleanup();
    const ws = render(<SettingsPanel pane="workspace" client={client} />);
    await ws.findByTestId('settings-mcp-text');
    expect(Array.from(ws.container.querySelectorAll('[data-testid="settings-mcp"] code')).map((c) => c.textContent)).toContain('.sequence/mcp.json');
  });
});

it('General has a Focused / Detailed picker bound to the tool-detail preference, both ways', async () => {
  localStorage.removeItem('sequence.toolDetail');
  const { client } = recorder(CONFIGURED);
  render(<SettingsPanel pane="app" client={client} />);
  const group = await screen.findByRole('radiogroup', { name: 'Tool calls' });
  const focused = group.querySelector<HTMLElement>('[data-detail-choice="focused"]')!;
  const detailed = group.querySelector<HTMLElement>('[data-detail-choice="detailed"]')!;
  expect([focused.textContent, detailed.textContent]).toEqual(['Focused', 'Detailed']);
  expect(focused.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(detailed);
  expect(localStorage.getItem('sequence.toolDetail')).toBe('detailed');
  expect(detailed.getAttribute('aria-checked')).toBe('true');
  /* The shortcut and the status bar write the same key; the picker follows. */
  act(() => writeToolDetail('focused'));
  expect(focused.getAttribute('aria-checked')).toBe('true');
  act(() => resetToolDetailForTest());
  localStorage.removeItem('sequence.toolDetail');
});

it('Workspace mounts Allowed folders and Map cache (APP-13, APP-15), and General does not', async () => {
  const stub = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    const body = u.includes('allowed-folders') ? { folders: ['D:/data'] } : u.includes('map-cache') ? { bytes: 2048, entries: 3 } : null;
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', stub);
  try {
    const { client } = recorder(CONFIGURED);
    const view = render(<SettingsPanel pane="workspace" client={client} />);
    expect(await screen.findByTestId('settings-allowed-folders')).toBeTruthy();
    expect(await screen.findByTestId('settings-map-cache')).toBeTruthy();
    expect(await screen.findByText('D:/data')).toBeTruthy();
    view.unmount();
    render(<SettingsPanel pane="app" client={client} />);
    await screen.findByTestId('settings-appearance');
    expect(screen.queryByTestId('settings-allowed-folders')).toBeNull();
    expect(screen.queryByTestId('settings-map-cache')).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
