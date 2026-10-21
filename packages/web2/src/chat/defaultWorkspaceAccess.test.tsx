import source from '../v3/V3Chat.tsx?raw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useAccessSwitch } from './AccessControl';

it('V3Chat uses the default workspace when no attached repository grounds consent', () => {
  expect(source).toMatch(/projectKey:\s*groundedRepoRoot\(state\)\s*\?\?\s*workspaceRoot/);
});

it('two default workspaces do not share the page consent cache', async () => {
  const state = vi.fn().mockResolvedValue({ ok: true, confirmed: true, prompt: 'Confirm' });
  const onAccess = vi.fn();
  const client = { state, confirm: state };
  const hook = renderHook(({ workspace }) => useAccessSwitch({ access: 'autoEdit', onAccess, projectKey: workspace, client }), { initialProps: { workspace: 'C:/workspaces/one' } });
  act(() => hook.result.current.request('full'));
  await waitFor(() => expect(onAccess).toHaveBeenCalledWith('full'));
  act(() => hook.result.current.request('full'));
  expect(state).toHaveBeenCalledTimes(1);
  hook.rerender({ workspace: 'C:/workspaces/two' });
  act(() => hook.result.current.request('full'));
  await waitFor(() => expect(state).toHaveBeenCalledTimes(2));
  hook.rerender({ workspace: 'C:/workspaces/one' });
  act(() => hook.result.current.request('full'));
  expect(state).toHaveBeenCalledTimes(2);
});
