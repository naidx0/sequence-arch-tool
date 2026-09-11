import { describe, expect, it } from 'vitest';

import {
  loadAskHonestyFixture,
  wrapFencedSeqd,
  wrapProse,
} from '../../../analyzer/src/test/ask-honesty-corpus';
import { isToolDumpCode, stripToolProse, toolCardTitle, toolNameFromDump } from './stripToolProse';

describe('stripToolProse', () => {
  it('strips fenced sequence-tool blocks into tool cards metadata', () => {
    const text = [
      'Here is the board:',
      '```sequence-tool',
      '{"id":"d1","name":"propose_topology","args":{"title":"Org","nodes":[],"edges":[]}}',
      '```',
      'Done.',
    ].join('\n');
    const { stripped, tools } = stripToolProse(text);
    expect(tools.map((t) => t.name)).toEqual(['propose_topology']);
    expect(stripped).not.toMatch(/propose_topology/);
    expect(stripped).toMatch(/Here is the board/);
    expect(stripped).toMatch(/Done/);
  });

  it('strips bare canvas.write JSON the model dumped into prose', () => {
    const text =
      'Drawing…\n{"id":"c1","name":"canvas.write_svg","args":{"title":"TUI","svg":"<svg/>"}}\nmore';
    const { stripped, tools } = stripToolProse(text);
    expect(tools[0]?.name).toBe('canvas.write_svg');
    expect(stripped).not.toMatch(/canvas\.write_svg/);
    expect(stripped).toMatch(/Drawing/);
  });

  it('hides mid-stream incomplete propose_topology JSON (owner screenshot)', () => {
    const partial =
      'store with a vector index; skills are YAML manifests the router matches against.\n' +
      '```json\n' +
      '{"id":"d1","name":"propose_topology","args":{"title":"Hermes local agent hub","nodes":[' +
      '{"id":"proposal:core","label":"Harness Core"},{"id":"proposal:cli","label":"CLI"},' +
      '{"id":"proposal:ollama';
    const { stripped, tools } = stripToolProse(partial);
    expect(tools.some((t) => t.name === 'propose_topology')).toBe(true);
    expect(stripped).not.toMatch(/propose_topology/);
    expect(stripped).not.toMatch(/Harness Core/);
    expect(stripped).toMatch(/vector index/);
  });

  it('recognises tool-dump code fences for the renderer', () => {
    expect(isToolDumpCode('sequence-tool', '{"name":"propose_topology"}')).toBe(true);
    expect(
      isToolDumpCode(null, '{"id":"x","name":"propose_topology","args":{}}'),
    ).toBe(true);
    expect(
      isToolDumpCode(
        'json',
        '{"id":"d1","name":"propose_topology","args":{"nodes":[{"id":"proposal:ollama"',
      ),
    ).toBe(true);
    expect(toolNameFromDump('{"id":"d1","name":"propose_topology"')).toBe('propose_topology');
    expect(isToolDumpCode('ts', 'const x = 1')).toBe(false);
  });

  it('names board/canvas tools for the card title', () => {
    expect(toolCardTitle('propose_topology')).toBe('Drawing on Architecture');
    expect(toolCardTitle('canvas.write_mermaid')).toBe('Drawing on AI Canvas');
  });

  it('strips dangling canvas.write fragments that lost their opening brace', () => {
    const text =
      'Here it is.\n' +
      '":"c1","name":"canvas.write_svg","args":{"title":"GUI","content":"<svg xmlns=\'http://www.w3.org/2000/svg\'><rect/></svg>"}}\n' +
      'The right panel is where people choose.';
    const { stripped, tools } = stripToolProse(text);
    expect(tools.some((t) => t.name === 'canvas.write_svg')).toBe(true);
    expect(stripped).not.toMatch(/canvas\.write_svg/);
    expect(stripped).not.toMatch(/<svg/);
    expect(stripped).toMatch(/Here it is/);
    expect(stripped).toMatch(/right panel/);
  });

  it('strips orphan SVG when a canvas.write_* name was in the blob', () => {
    const withName =
      'x\n"name":"canvas.write_svg","args":{"content":"<svg xmlns=\'http://www.w3.org/2000/svg\'><rect/></svg>"}\ny';
    const { stripped } = stripToolProse(withName);
    expect(stripped).not.toMatch(/<svg/);
  });

  it('strips orphan canvas args that lost the tool name wrapper', () => {
    const text =
      'Here is the mockup.\n' +
      '":{"title":"GUI Routing","content":"<svg xmlns=\'http://www.w3.org/2000/svg\'><rect/></svg>"}}\n' +
      'The right panel is where people choose.';
    const { stripped, tools } = stripToolProse(text);
    expect(tools.some((t) => t.name.startsWith('canvas.write_'))).toBe(true);
    expect(stripped).not.toMatch(/<svg|GUI Routing|content/);
    expect(stripped).toMatch(/Here is the mockup/);
    expect(stripped).toMatch(/right panel/);
  });

  it('strips orphan propose_topology args without the tool name', () => {
    const text =
      'Same flow on the board:\n' +
      '":{"title":"Harness","nodes":[{"id":"a"}],"edges":[{"id":"e1"}]}}\n' +
      'Execution order, mirroring the board:';
    const { stripped, tools } = stripToolProse(text);
    expect(tools.some((t) => t.name === 'propose_topology')).toBe(true);
    expect(stripped).not.toMatch(/"nodes"|Harness/);
    expect(stripped).toMatch(/Same flow/);
    expect(stripped).toMatch(/Execution order/);
  });

  it('strips bare process-sequence SeqDiagram JSON without a tool envelope (owner dump)', () => {
    const dump = JSON.stringify({
      kind: 'process-sequence',
      title: 'Local agent harness',
      nodes: [
        { id: 'proposal:core', label: 'Harness Core', kind: 'service' },
        { id: 'proposal:ollama', label: 'Ollama', kind: 'service' },
      ],
      edges: [
        {
          id: 'e1',
          from: 'proposal:core',
          to: 'proposal:ollama',
          family: 'call',
          label: 'infer',
        },
      ],
    });
    const text = `Here is the shape:\n${dump}\nThat covers it.`;
    const { stripped, tools } = stripToolProse(text);
    expect(tools.some((t) => t.name === 'propose_topology')).toBe(true);
    expect(stripped).not.toMatch(/process-sequence|proposal:core|Harness Core/);
    expect(stripped).toMatch(/Here is the shape/);
    expect(stripped).toMatch(/That covers it/);
    expect(isToolDumpCode('json', dump)).toBe(true);
    expect(toolNameFromDump(dump)).toBe('propose_topology');
  });
});

describe('A3 honesty corpus (stripToolProse)', () => {
  it('strips fenced seqd from the golden fixture', () => {
    const text = wrapFencedSeqd(loadAskHonestyFixture('fenced-seqd'));
    const { stripped, tools } = stripToolProse(text);
    expect(tools.some((t) => t.name === 'propose_topology')).toBe(true);
    expect(stripped).not.toMatch(/proposal:ceo|service-sequence/);
    expect(stripped).toMatch(/Here is the plan/);
  });

  it('strips bare process-sequence JSON from the golden fixture', () => {
    const text = wrapProse(loadAskHonestyFixture('process-sequence-bare'));
    const { stripped, tools } = stripToolProse(text);
    expect(tools.some((t) => t.name === 'propose_topology')).toBe(true);
    expect(stripped).not.toMatch(/process-sequence|proposal:core|Harness Core/);
    expect(stripped).toMatch(/Here is the shape/);
  });

  it('strips bare propose_topology envelope from the golden fixture', () => {
    const text = wrapProse(
      loadAskHonestyFixture('propose-topology-bare'),
      'Got it — no more questions.',
      'That is the whole loop.',
    );
    const { stripped, tools } = stripToolProse(text);
    expect(tools.some((t) => t.name === 'propose_topology')).toBe(true);
    expect(stripped).not.toMatch(/propose_topology|Hermes orchestrator/);
    expect(stripped).toMatch(/Got it — no more questions/);
  });

  it('strips bare nodes JSON from the golden fixture', () => {
    const text = wrapProse(loadAskHonestyFixture('bare-nodes'));
    const { stripped, tools } = stripToolProse(text);
    expect(tools.some((t) => t.name === 'propose_topology')).toBe(true);
    expect(stripped).not.toMatch(/proposal:core|Harness Core/);
    expect(stripped).toMatch(/Here is the shape/);
    expect(isToolDumpCode('json', loadAskHonestyFixture('bare-nodes'))).toBe(true);
  });
});
