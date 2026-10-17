/**
 * The Add REA row: off until clicked, shows what it will download before it downloads, installs only on the second click,
 * adds REA to the project when the install finishes, and survives a server that has never heard of REA.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReaComponentRow } from './ReaComponentRow';
import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';
import type { ReaAnswer, ReaClient, ReaDoctorView, ReaJobView, ReaPlanView, ReaStatusView, ReaView } from './reaClient';

const COMMIT = '0a51b246c632a36b24c121282aeb51fda1ddb461';
const PIN = { name: 'Reverse Engineer Anything (REA)', repo: 'https://github.com/morluto/rea', commit: COMMIT, version: '6.5.0', licence: 'MIT', node: '^22.19.0', downloadMb: 115, diskMb: 185 };
const PLAN: ReaPlanView = {
  installDir: 'C:/Users/dev/.sequence/components/rea/' + COMMIT,
  addon: { package: 'rea-agents', version: '6.5.0', source: 'https://registry.npmjs.org/rea-agents/6.5.0', files: ['native/windows/build/manifest.json', 'native/windows/build/rea-windows-x64.node'], downloadMb: 6 },
  totalDownloadMb: 121,
  totalDiskMb: 186,
  steps: [
    { id: 'fetch', label: 'Download the pinned commit 0a51b24 from https://github.com/morluto/rea', command: 'git fetch --depth 1 origin ' + COMMIT },
    { id: 'install', label: "Install REA's locked dependencies, running none of their install scripts", command: 'npm ci --ignore-scripts' },
    { id: 'build', label: 'Build it (the one build step checked)', command: 'npm run compile' },
    { id: 'prune', label: 'Drop the build tools again', command: 'npm prune --omit=dev --ignore-scripts' },
    { id: 'addon', label: "Download rea-agents@6.5.0 from npm, check it against the registry's integrity value, and take its two Windows native files", command: 'GET https://registry.npmjs.org/rea-agents/6.5.0, then tar -xzf (two named files only)' },
    { id: 'verify', label: 'Check that it starts and reports the pinned version', command: 'node scripts/rea.mjs --version' },
  ],
  requirements: [
    { name: 'git', ok: true, detail: 'git version 2.51' },
    { name: 'node', ok: true, detail: 'v24.13.0' },
    { name: 'npm', ok: true, detail: 'npm 11.6.2' },
  ],
  limitations: ['Deep native analysis needs Hopper, Ghidra or IDA that you install yourself; Sequence installs none of them and needs no admin rights.'],
  ready: true,
};
const OFF: ReaStatusView = { installed: false, version: null, commit: null, installDir: PLAN.installDir, registration: 'absent', sizeMb: null };
const DOCTOR: ReaDoctorView = {
  checkedAt: '2026-10-17T09:00:00.000Z',
  ran: true,
  staticAnalysis: true,
  windowsNative: 'present',
  engines: ['Hopper', 'Ghidra', 'IDA', 'JADX'].map((name) => ({ id: name.toLowerCase(), name, installed: false, hint: 'Not installed.' })),
  lines: [
    'Static JavaScript and Electron analysis: available.',
    'Listing what is inside an .asar or archive: available.',
    'Hopper: Not installed. Install Hopper yourself if you want it.',
    'Ghidra: Not installed. Install Ghidra yourself and set GHIDRA_INSTALL_DIR.',
    'IDA: Not installed. Install IDA yourself if you have a licence.',
    'JADX: Not installed. Install JADX and Java yourself for Android apps.',
  ],
};
const ADDED: ReaStatusView = { installed: true, version: '6.5.0', commit: COMMIT, installDir: PLAN.installDir, registration: 'ours', sizeMb: 212, addon: 'present', doctor: DOCTOR };

const view = (status: ReaStatusView, job: ReaJobView = { state: 'idle', steps: {} }, plan?: ReaPlanView): ReaView => ({ pin: PIN, status, job, readOnlyTools: 112, ...(plan ? { plan } : {}) });
const ok = <T,>(body: T): ReaAnswer<T> => ({ ok: true, body });

function fake(initial: ReaView) {
  let current = initial;
  const calls: string[] = [];
  const client: ReaClient = {
    view: vi.fn(async (withPlan: boolean) => (calls.push(`view${withPlan ? ':plan' : ''}`), ok({ ...current, ...(withPlan ? { plan: PLAN } : {}) }))),
    install: vi.fn(async (commit: string) => {
      calls.push(`install:${commit}`);
      current = view(OFF, { state: 'running', steps: { fetch: 'running' } }, PLAN);
      return ok(current);
    }),
    register: vi.fn(async () => (calls.push('register'), ok({}))),
    remove: vi.fn(async () => (calls.push('remove'), ok({}))),
  };
  return { client, calls, set: (v: ReaView) => (current = v) };
}

afterEach(cleanup);

describe('the REA row: Off or Start', () => {
  it('is Off by default, with exactly two choices, and a look at it downloads nothing', async () => {
    const f = fake(view(OFF));
    render(<ReaComponentRow client={f.client} />);
    expect((await screen.findByTestId('settings-rea-state')).textContent).toBe('Off');
    expect(screen.getByTestId('settings-rea-sub').textContent).toContain('Off until you start it');
    const choice = screen.getByTestId('settings-rea-choice');
    expect(within(choice).getAllByRole('button').map((b) => b.textContent)).toEqual(['Off', 'Start']);
    expect(screen.getByTestId('settings-rea-choice-off').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('settings-rea-install')).toBeNull();
    expect(f.client.install).not.toHaveBeenCalled();
    expect(f.client.register).not.toHaveBeenCalled();
    expect(f.calls).toEqual(['view']);
  });

  it('choosing Start shows the whole plan (GitHub at the commit, the npm package, the total size, the folder, no admin) and downloads nothing; Off closes it', async () => {
    const f = fake(view(OFF));
    render(<ReaComponentRow client={f.client} />);
    fireEvent.click(await screen.findByTestId('settings-rea-choice-start'));
    const plan = await screen.findByTestId('settings-rea-plan');
    expect(within(plan).getByTestId('settings-rea-repo').textContent).toBe('github.com/morluto/rea');
    expect(within(plan).getByTestId('settings-rea-commit').textContent).toContain('0a51b24');
    expect(within(plan).getByTestId('settings-rea-npm').textContent).toContain('rea-agents@6.5.0');
    expect(within(plan).getByTestId('settings-rea-npm').textContent).toContain('sha512');
    expect(within(plan).getByTestId('settings-rea-size').textContent).toBe('About 121 MB to download, about 186 MB on disk');
    expect(plan.textContent).toContain(PLAN.installDir);
    expect(plan.textContent).toContain('No admin rights');
    expect(plan.textContent).toContain('Hopper, Ghidra or IDA');
    expect(plan.textContent).toContain('rea doctor');
    expect(screen.getByTestId('settings-rea-install').className).toBe('s2-btn s2-blue');
    expect(screen.getByTestId('settings-rea-install').textContent).toBe('Download and start');
    expect(f.client.install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('settings-rea-choice-off'));
    expect(screen.queryByTestId('settings-rea-plan')).toBeNull();
    expect(screen.getByTestId('settings-rea-state').textContent).toBe('Off');
    expect(f.client.install).not.toHaveBeenCalled();
  });

  it('where the source build already has the native files (not Windows) the plan names no npm download', async () => {
    const f = fake(view(OFF));
    f.client.view = vi.fn(async (withPlan: boolean) => ok({ ...view(OFF), ...(withPlan ? { plan: { ...PLAN, addon: null, totalDownloadMb: 115, totalDiskMb: 185 } } : {}) }));
    render(<ReaComponentRow client={f.client} />);
    fireEvent.click(await screen.findByTestId('settings-rea-choice-start'));
    const plan = await screen.findByTestId('settings-rea-plan');
    expect(within(plan).queryByTestId('settings-rea-npm')).toBeNull();
    expect(within(plan).getByTestId('settings-rea-size').textContent).toBe('About 115 MB to download, about 185 MB on disk');
  });

  it('Download and start sends the pinned commit once, shows each step, adds REA to the project when done, and says what works', async () => {
    const f = fake(view(OFF));
    const onChanged = vi.fn();
    render(<ReaComponentRow client={f.client} onChanged={onChanged} pollMs={20} />);
    fireEvent.click(await screen.findByTestId('settings-rea-choice-start'));
    fireEvent.click(await screen.findByTestId('settings-rea-install'));
    const steps = await screen.findByTestId('settings-rea-steps');
    expect(screen.getByTestId('settings-rea-state').textContent).toBe('Starting');
    expect(within(steps).getAllByRole('listitem').map((li) => li.getAttribute('data-state'))).toEqual(['running', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
    expect(within(steps).getByText(/Download rea-agents@6.5.0 from npm/)).toBeTruthy();
    expect((screen.getByTestId('settings-rea-choice-off') as HTMLButtonElement).disabled).toBe(true);
    expect(f.client.install).toHaveBeenCalledTimes(1);
    expect(f.client.install).toHaveBeenCalledWith(COMMIT);
    f.set(view(ADDED, { state: 'done', steps: { fetch: 'done', install: 'done', build: 'done', prune: 'done', addon: 'done', verify: 'done', doctor: 'done' } }));
    await waitFor(() => expect(f.client.register).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('settings-rea-state').textContent).toBe('On'));
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByTestId('settings-rea-installed').textContent).toContain('112 read-only tools');
    expect(screen.getByTestId('settings-rea-installed').textContent).toContain('212 MB on disk');
    const lines = within(screen.getByTestId('settings-rea-caplist')).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines[0]).toBe('Static JavaScript and Electron analysis: available.');
    expect(lines.filter((l) => /Not installed/.test(l ?? '')).length).toBe(4);
    await act(async () => new Promise((r) => setTimeout(r, 80)));
    expect(f.client.register).toHaveBeenCalledTimes(1);
  });

  it('a step that fails says which one in plain words, that nothing was installed, and Start can be chosen again', async () => {
    const g = fake(view(OFF, { state: 'failed', steps: { fetch: 'done', install: 'done', build: 'done', prune: 'done', addon: 'failed' }, failedStep: 'addon', error: 'The rea-agents@6.5.0 download does not match the integrity value npm published for it.' }, PLAN));
    render(<ReaComponentRow client={g.client} />);
    expect((await screen.findByTestId('settings-rea-state')).textContent).toBe('Failed');
    const err = screen.getByTestId('settings-rea-error').textContent ?? '';
    expect(err).toContain('Start stopped at');
    expect(err).toContain('Nothing was installed.');
    expect(err).toContain('integrity');
    fireEvent.click(screen.getByTestId('settings-rea-choice-start'));
    expect(await screen.findByTestId('settings-rea-install')).toBeTruthy();
  });

  it('a missing requirement is named and the download button is off', async () => {
    const f = fake(view(OFF));
    const missingGit = { name: 'git' as const, ok: false, detail: 'git was not found on PATH' };
    f.client.view = vi.fn(async (withPlan: boolean) => ok({ ...view(OFF), ...(withPlan ? { plan: { ...PLAN, ready: false, requirements: [missingGit, ...PLAN.requirements.slice(1)] } } : {}) }));
    render(<ReaComponentRow client={f.client} />);
    fireEvent.click(await screen.findByTestId('settings-rea-choice-start'));
    expect((await screen.findByTestId('settings-rea-missing')).textContent).toBe('git was not found on PATH');
    expect((screen.getByTestId('settings-rea-install') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Off, once started, asks before it deletes, then removes and re-reads the MCP file', async () => {
    const f = fake(view(ADDED));
    const onChanged = vi.fn();
    render(<ReaComponentRow client={f.client} onChanged={onChanged} />);
    fireEvent.click(await screen.findByTestId('settings-rea-choice-off'));
    expect(f.client.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('settings-rea-keep'));
    expect(screen.queryByTestId('settings-rea-remove')).toBeNull();
    fireEvent.click(screen.getByTestId('settings-rea-choice-off'));
    fireEvent.click(screen.getByTestId('settings-rea-remove'));
    await waitFor(() => expect(f.client.remove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('an install made before the native files existed says so, offers only those, and runs two steps', async () => {
    const OLD: ReaStatusView = { ...ADDED, addon: 'missing', doctor: { ...DOCTOR, staticAnalysis: false, lines: ['Static JavaScript and Electron analysis: not available, because the Windows native files are missing.', ...DOCTOR.lines.slice(1)] } };
    const f = fake(view(OLD));
    f.client.install = vi.fn(async () => ok(view(OLD, { state: 'running', steps: { addon: 'running' } }, PLAN)));
    render(<ReaComponentRow client={f.client} pollMs={20} />);
    expect((await screen.findByTestId('settings-rea-nativemissing')).textContent).toContain('Start adds them from npm');
    expect(within(screen.getByTestId('settings-rea-caplist')).getAllByRole('listitem')[0]!.getAttribute('data-ok')).toBe('false');
    fireEvent.click(screen.getByTestId('settings-rea-addnative'));
    const plan = await screen.findByTestId('settings-rea-plan');
    expect(within(within(plan).getByTestId('settings-rea-plan-steps')).getAllByRole('listitem').length).toBe(2);
    fireEvent.click(screen.getByTestId('settings-rea-install'));
    const steps = await screen.findByTestId('settings-rea-steps');
    expect(within(steps).getAllByRole('listitem').length).toBe(2);
  });

  it('installed but not in this project offers Add to this project; a hand-written rea server is called out, not replaced', async () => {
    const f = fake(view({ ...ADDED, registration: 'absent' }));
    render(<ReaComponentRow client={f.client} />);
    fireEvent.click(await screen.findByTestId('settings-rea-register'));
    await waitFor(() => expect(f.client.register).toHaveBeenCalledTimes(1));
    cleanup();
    const g = fake(view({ ...ADDED, registration: 'other' }));
    render(<ReaComponentRow client={g.client} />);
    expect((await screen.findByTestId('settings-rea-installed')).textContent).toContain('already has an MCP server named rea that Sequence did not add');
    expect(screen.queryByTestId('settings-rea-register')).toBeNull();
  });

  it('Check again asks the server to run the doctor again', async () => {
    const f = fake(view(ADDED));
    f.client.recheck = vi.fn(async () => ok(view(ADDED)));
    render(<ReaComponentRow client={f.client} />);
    fireEvent.click(await screen.findByTestId('settings-rea-recheck'));
    await waitFor(() => expect(f.client.recheck).toHaveBeenCalledTimes(1));
  });

  it('a server that has never heard of REA leaves a quiet row and no choice, and nothing throws', async () => {
    const client: ReaClient = {
      view: vi.fn(async () => ({ ok: false as const, status: 404, message: 'The server answered 404.' })),
      install: vi.fn(),
      register: vi.fn(),
      remove: vi.fn(),
    };
    render(<ReaComponentRow client={client} />);
    await waitFor(() => expect(client.view).toHaveBeenCalled());
    expect(screen.getByTestId('settings-rea').getAttribute('data-state')).toBe('unknown');
    expect(screen.queryByTestId('settings-rea-choice')).toBeNull();
  });
});

describe('the row in Settings, MCP servers', () => {
  it('appears at the top of the MCP card, beside the editor', async () => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.startsWith('/api/mcp')) return json({ path: '.sequence/mcp.json', exists: false, document: { servers: {} }, text: '{\n  "servers": {}\n}\n', warnings: [] });
      if (u.startsWith('/api/rea')) return json(view(OFF));
      return json({}, 404);
    }) as typeof fetch;
    vi.stubGlobal('fetch', fetchImpl);
    try {
      render(<SettingsPanel pane="mcp" client={createSettingsClient(fetchImpl)} />);
      const row = await screen.findByTestId('settings-rea');
      const card = screen.getByTestId('settings-mcp');
      expect(card.contains(row)).toBe(true);
      expect(await screen.findByTestId('settings-rea-choice-start')).toBeTruthy();
      expect(await screen.findByTestId('settings-mcp-text')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
