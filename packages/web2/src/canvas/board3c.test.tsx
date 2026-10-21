import { describe, expect, it } from 'vitest';

import { chipFor } from './AgentOverlay';
import { middleEllipsis, shouldAutoRefit } from './Board';
import { FIT_INSET, fitViewport } from './camera';
import { isTestFile } from './composite';
import { chatWidthBesideAgents } from '../v3/V3Shell';
import { providerPill } from '../onboarding/onboardingClient';
import type { AgentNode } from '../agents/agentTypes';

/* STREAM 3b polish: each describe locks one fix from the round 2 review. */

describe('test files roll into a "tests (n)" chip', () => {
  it('knows a test file by name or folder, and only files', () => {
    expect(isTestFile({ kind: 'file', label: 'plan-mode.test.ts', path: 'packages/acp/src/test/plan-mode.test.ts' })).toBe(true);
    expect(isTestFile({ kind: 'file', label: 'x.spec.tsx', path: 'a/x.spec.tsx' })).toBe(true);
    expect(isTestFile({ kind: 'file', label: 'test_api.py', path: 'svc/test_api.py' })).toBe(true);
    expect(isTestFile({ kind: 'file', label: 'gateway.ts', path: 'packages/gateway/src/gateway.ts' })).toBe(false);
    expect(isTestFile({ kind: 'module', label: 'tests', path: 'tests/' })).toBe(false);
  });
});

describe('one label size per group, shortened in the middle', () => {
  const mono = (t: string) => t.length * 8;
  it('keeps both ends of a name that does not fit', () => {
    const out = middleEllipsis('graphQueryDepth.test.ts', 80, mono);
    expect(mono(out)).toBeLessThanOrEqual(80);
    expect(out.startsWith('graph')).toBe(true);
    expect(out.endsWith('.ts')).toBe(true);
    expect(out).toContain('…');
  });
  it('leaves a name that fits alone', () => {
    expect(middleEllipsis('index.ts', 80, mono)).toBe('index.ts');
  });
});

describe('the Agents panel takes its width from the chat first', () => {
  it('chat keeps at most 45% of the shared room, never below 320', () => {
    expect(chatWidthBesideAgents(580, 832)).toBe(374);
    expect(chatWidthBesideAgents(580, 600)).toBe(320);
    expect(chatWidthBesideAgents(300, 1200)).toBe(320);
    expect(chatWidthBesideAgents(400, 1200)).toBe(400);
    expect(chatWidthBesideAgents(580, 0)).toBe(580);
  });
});

describe('first run: Signed out is a fact, not a call to action', () => {
  it('draws the Signed out pill neutral, not in the accent', () => {
    expect(providerPill({ id: 'claude', label: 'Claude Code', state: 'signIn' } as never)).toEqual({ text: 'Needs sign-in', tone: 'neutral' });
  });
});

describe('a fit too tall for the floor keeps its top below the controls band', () => {
  it('pins the top under the band instead of centring past it', () => {
    const v = fitViewport({ x: 0, y: 0, width: 400, height: 6000 }, { width: 460, height: 620 }, null, { top: 40, bottom: 50 })!;
    expect(v.y).toBe(40 + FIT_INSET);
  });
  it('a fit that fits is still centred', () => {
    const v = fitViewport({ x: 0, y: 0, width: 100, height: 100 }, { width: 460, height: 620 }, null, null)!;
    expect(v.y).toBeGreaterThan(FIT_INSET);
  });
});

describe('the board refits by itself only onto a finished arrangement', () => {
  const at = { x: 10, y: 20, zoom: 0.5 };
  const frame = { width: 400, height: 600 };
  it('refits while the camera is where the last auto fit left it and ELK has answered', () => {
    expect(shouldAutoRefit(at, at, 'idle', true, frame)).toBe(true);
  });
  it('never onto seed positions or a running layout (opening the Agents panel left codeforge at 100%)', () => {
    expect(shouldAutoRefit(at, at, 'idle', false, frame)).toBe(false);
    expect(shouldAutoRefit(at, at, 'laying-out', true, frame)).toBe(false);
  });
  it('never once the reader has moved the camera', () => {
    expect(shouldAutoRefit(at, { ...at, zoom: 0.6 }, 'idle', true, frame)).toBe(false);
    expect(shouldAutoRefit(null, at, 'idle', true, frame)).toBe(false);
  });
});

describe('the agent chip names the agent and its action', () => {
  const node = (over: Partial<AgentNode>): AgentNode =>
    ({ id: 'x', sessionId: 's', parentId: null, rootId: 's', kind: 'tool_call', status: 'running', title: '', toolKind: 'Edit', stepKind: 'edit', locations: [], startedAt: 0, endedAt: null, ...over }) as AgentNode;
  it('uses the nearest subagent, the verb and the file name', () => {
    const nodes = new Map<string, AgentNode>([
      ['s', node({ id: 's', kind: 'session' })],
      ['sub', node({ id: 'sub', kind: 'subagent', parentId: 's', title: 'Explore' })],
    ]);
    const hit = { path: 'packages\\acp\\src\\accessMode.ts', fileNodeId: 'f', moduleId: null, serviceId: 'svc:acp', serviceLabel: 'acp', touchedEdgeIds: [], liftedEdges: [] };
    expect(chipFor(node({ parentId: 'sub', locations: [hit] }), nodes, 'svc:acp')).toBe('Explore: editing accessMode.ts');
    expect(chipFor(node({ parentId: 's', stepKind: 'read', locations: [hit] }), nodes, 'svc:acp')).toBe('Main agent: reading accessMode.ts');
  });
});

describe('the toast avoids the board toolbar and the zoom row (S4)', () => {
  it('marks both with data-toast-avoid, and the canvas no longer lifts anything itself', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const controls = fs.readFileSync(path.resolve(__dirname, 'BoardControls.tsx'), 'utf8');
    const board = fs.readFileSync(path.resolve(__dirname, 'Board.tsx'), 'utf8');
    expect(controls).toMatch(/className="board-controls"[^>]*data-toast-avoid=""/);
    expect(board).toMatch(/className="boardfurniture" data-toast-avoid=""/);
    expect(fs.existsSync(path.resolve(__dirname, 'toastLift.ts'))).toBe(false);
    const css = fs.readFileSync(path.resolve(__dirname, 'board.css'), 'utf8');
    expect(css).not.toMatch(/--toast-lift/);
  });
});
