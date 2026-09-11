/**
 * Harness-plan W5 grounded Program templates — validate + checker-gated fixture runs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runProgram, validateProgram, type ArchGraph, type NodeExecutor } from './index.js';
import { buildCouncilAgainstRisksProgram } from './programs/councilAgainstRisks.js';
import {
  buildRouteByBlastRadiusProgram,
  DEFAULT_BLAST_BAND,
  HIGH_BLAST_BAND,
} from './programs/routeByBlastRadius.js';
import { buildDogfoodLoopProgram } from './programs/dogfoodLoop.js';
import { buildReviewLoopProgram } from './programs/reviewLoop.js';

const fixture: ArchGraph = {
  version: 1,
  scannedAt: '',
  repoRoot: '/fixture',
  repoName: 'fixture',
  warnings: [],
  nodes: [
    { id: 'repo', kind: 'repo', label: 'fixture' },
    { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo' },
    { id: 'svc:db', kind: 'datastore', label: 'db', parentId: 'repo' },
  ],
  edges: [],
};

describe('W5 templates', () => {
  it('review-loop remains validateProgram-clean', () => {
    assert.equal(validateProgram(buildReviewLoopProgram()).ok, true);
  });

  it('council-against-risks validates, has parallel council + checker, converges on fixture', async () => {
    const program = buildCouncilAgainstRisksProgram();
    assert.equal(validateProgram(program).ok, true);
    assert.ok(program.nodes.some((n) => n.kind === 'checker'));
    assert.ok(program.nodes.some((n) => n.kind === 'parallel'));
    assert.equal(program.edges.filter((e) => e.kind === 'parallel').length, 3);

    let proposeAttempt = 0;
    const r = await runProgram(
      program,
      {
        agent: async (node) => {
          if (node.id === 'propose') {
            proposeAttempt += 1;
            return {
              ok: true,
              value: proposeAttempt === 1 ? ['svc:ghost'] : ['svc:api'],
            };
          }
          return { ok: true, value: `note:${node.id}` };
        },
        command: async () => ({ ok: true }),
      },
      { groundedGraph: fixture },
    );
    assert.equal(r.status, 'completed');
    assert.equal(r.finalState.checkerOk, 'yes');
    assert.equal(proposeAttempt, 2);
  });

  it('route-by-blast-radius branches on blastBand and checker-gates both paths', async () => {
    const base = buildRouteByBlastRadiusProgram();
    assert.equal(validateProgram(base).ok, true);
    assert.ok(base.nodes.some((n) => n.kind === 'branch'));
    assert.ok(base.nodes.some((n) => n.kind === 'checker'));

    /** Seed blastBand like CLI `--input` — override program + state-node initials. */
    const withBand = (blastBand: string) => {
      const p = buildRouteByBlastRadiusProgram();
      return {
        ...p,
        state: {
          shape: p.state!.shape,
          initial: { ...p.state!.initial, blastBand },
        },
        nodes: p.nodes.map((n) =>
          n.kind === 'state' && n.state
            ? {
                ...n,
                state: {
                  shape: n.state.shape,
                  initial: { ...n.state.initial, blastBand },
                },
              }
            : n,
        ),
      };
    };

    const high = await runProgram(
      withBand(HIGH_BLAST_BAND),
      {
        agent: async (node) => {
          if (node.id === 'deep-route') return { ok: true, value: ['svc:api'] };
          if (node.id === 'cheap-route') return { ok: true, value: ['svc:ghost'] };
          return { ok: true, value: '' };
        },
        command: async () => ({ ok: true }),
      },
      { groundedGraph: fixture },
    );
    assert.equal(high.status, 'completed');
    assert.equal(high.finalState.checkerOk, 'yes');
    assert.ok(high.nodeResults['deep-route']);
    assert.equal(high.nodeResults['cheap-route'], undefined);

    const low = await runProgram(
      withBand(DEFAULT_BLAST_BAND),
      {
        agent: async (node) => {
          if (node.id === 'cheap-route') return { ok: true, value: ['svc:db'] };
          if (node.id === 'deep-route') return { ok: true, value: ['svc:ghost'] };
          return { ok: true, value: '' };
        },
        command: async () => ({ ok: true }),
      },
      { groundedGraph: fixture },
    );
    assert.equal(low.status, 'completed');
    assert.equal(low.finalState.checkerOk, 'yes');
    assert.ok(low.nodeResults['cheap-route']);
    assert.equal(low.nodeResults['deep-route'], undefined);
  });

  it('dogfood scout→build→gate→review validates and checker-gates on fixture', async () => {
    const program = buildDogfoodLoopProgram();
    assert.equal(validateProgram(program).ok, true);
    assert.ok(program.nodes.some((n) => n.kind === 'checker'));
    assert.ok(program.nodes.some((n) => n.id === 'scout'));
    assert.ok(program.nodes.some((n) => n.id === 'review'));

    let buildAttempt = 0;
    const r = await runProgram(
      program,
      {
        agent: async (node) => {
          if (node.id === 'scout') return { ok: true, value: 'scouted svc:api' };
          if (node.id === 'build') {
            buildAttempt += 1;
            return {
              ok: true,
              value: buildAttempt === 1 ? ['svc:ghost'] : ['svc:api'],
            };
          }
          if (node.id === 'review') return { ok: true, value: 'ship checklist ok' };
          return { ok: true, value: '' };
        },
        command: async () => ({ ok: true }),
      },
      { groundedGraph: fixture },
    );
    assert.equal(r.status, 'completed');
    assert.equal(r.finalState.checkerOk, 'yes');
    assert.equal(r.finalState.reviewNotes, 'ship checklist ok');
    assert.equal(buildAttempt, 2);
  });
});
