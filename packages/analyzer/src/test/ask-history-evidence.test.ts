/**
 * B3.1 — prior chat work/evidence reaches the ask prompt.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { askHistoryBudget, parseAskHistoryTurns, renderAskHistorySection } from '../explain/explain.js';
import { askHistoryWindow } from '../server/localProviders.js';

describe('parseAskHistoryTurns + renderAskHistorySection (B3.1)', () => {
  it('keeps prose-only turns unchanged', () => {
    const turns = parseAskHistoryTurns([
      { role: 'user', text: 'what does scan.ts do' },
      { role: 'assistant', text: 'It walks the repo.' },
    ]);
    const lines = renderAskHistorySection(turns);
    assert.deepEqual(lines, [
      '--- PRIOR CHAT (same workspace; continue coherently) ---',
      'User: what does scan.ts do',
      'Assistant: It walks the repo.',
    ]);
  });

  it('renders compact work and evidence under assistant turns', () => {
    const turns = parseAskHistoryTurns([
      { role: 'user', text: 'what calls X' },
      {
        role: 'assistant',
        text: 'Gateway → orders.',
        work: ['Read the graph (orders)', 'Explored 3 files'],
        evidence: {
          filesRead: ['gateway/src/routes/orders.ts'],
          tools: ['read_file'],
          proposals: ['p1'],
        },
      },
    ]);
    const lines = renderAskHistorySection(turns);
    assert.ok(lines.includes('Assistant: Gateway → orders.'));
    assert.ok(lines.some((l) => l.includes('[work]') && l.includes('Read the graph')));
    assert.ok(lines.some((l) => l.includes('[files]') && l.includes('orders.ts')));
    assert.ok(lines.some((l) => l.includes('[tools]') && l.includes('read_file')));
    assert.ok(lines.some((l) => l.includes('[proposals]') && l.includes('p1')));
  });

  it('names memory trimmed when earlier turns were omitted', () => {
    const turns = parseAskHistoryTurns([
      { role: 'user', text: 'old' },
      { role: 'assistant', text: 'reply' },
    ]);
    const lines = renderAskHistorySection(turns, 20, { droppedTurns: 12 });
    assert.match(lines[0]!, /12 earlier turns omitted — memory trimmed/);
  });

  it('marks truncated assistant bodies as memory trimmed', () => {
    const long = 'x'.repeat(1300);
    const lines = renderAskHistorySection([{ role: 'assistant', text: long }]);
    assert.ok(lines.some((l) => l.includes('[memory trimmed]')));
  });

  it('keeps a long dictated user message whole, so its last ask reaches the next turn', () => {
    /* A 3,000-character voice message whose last ask sits past the old 1,200 cut. */
    const filler = 'so um the sidebar thing we talked about, '.repeat(70);
    const said = `${filler}and also show total tokens this week as well`;
    assert.ok(said.length > 2500);
    const lines = renderAskHistorySection([
      { role: 'user', text: said },
      { role: 'assistant', text: 'Done with the sidebar.' },
    ]);
    const user = lines.find((l) => l.startsWith('User: '))!;
    assert.ok(user.endsWith('show total tokens this week as well'), 'the last ask survives');
    assert.ok(!user.includes('[memory trimmed]'));
  });

  it('trims only the oldest user message once all user messages pass the shared budget', () => {
    const big = (c: string) => c.repeat(50_000);
    const lines = renderAskHistorySection([
      { role: 'user', text: big('a') },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: big('b') },
    ]);
    const users = lines.filter((l) => l.startsWith('User: '));
    assert.equal(users[1], `User: ${big('b')}`, 'the newest is whole');
    assert.ok(users[0]!.includes('[memory trimmed]'), 'the oldest is trimmed');
    assert.ok(users[0]!.length >= 30_000 + 'User: '.length, 'to what the budget leaves, not to 1,200');
  });

  it('drops non-string work/evidence junk from a hostile client', () => {
    const turns = parseAskHistoryTurns([
      {
        role: 'assistant',
        text: 'ok',
        work: ['real', 12, null, ''],
        evidence: { filesRead: ['a.ts', 3], tools: [{ name: 'x' }], proposals: ['p'] },
      },
    ]);
    assert.deepEqual(turns[0]!.work, ['real']);
    assert.deepEqual(turns[0]!.evidence, { filesRead: ['a.ts'], proposals: ['p'] });
  });

  it('ignores history that is not an array', () => {
    assert.deepEqual(parseAskHistoryTurns(null), []);
    assert.deepEqual(parseAskHistoryTurns({ role: 'user' }), []);
  });

  describe('sized to a local model’s real window', () => {
    /* A long thread: ten dictated user messages of 3,000 characters and ten long answers. */
    const filler = 'so um the sidebar thing we talked about, '.repeat(70);
    const thread = Array.from({ length: 10 }, (_, i) => [
      { role: 'user', text: `${filler}and also ask number ${i} at the very end` },
      { role: 'assistant', text: 'y'.repeat(3000) },
    ]).flat();
    const chars = (lines: string[]) => lines.slice(1).join('\n').length;

    it('a 4k window: prior chat stays within a quarter of it, so the prompt, rules and map keep the rest', () => {
      const lines = renderAskHistorySection(thread, 20, { contextWindow: 4096 });
      assert.ok(chars(lines) <= 4096 * 4 * 0.25 * 1.15, `history is ${chars(lines)} chars`);
      assert.ok(lines.some((l) => l.includes('[memory trimmed]') || l.includes('trimmed to fit')));
    });

    it('a 16k window: the newest dictated message is kept whole, and the total still fits the quarter', () => {
      const lines = renderAskHistorySection(thread, 20, { contextWindow: 16384 });
      assert.ok(chars(lines) <= 16384 * 4 * 0.25 * 1.15, `history is ${chars(lines)} chars`);
      const newest = lines.filter((l) => l.startsWith('User: ')).at(-1)!;
      assert.ok(newest.endsWith('ask number 9 at the very end'), 'the newest message keeps its last ask');
    });

    it('a 4k window: work and evidence lines are paid from the same quarter, so the system prompt can never be pushed out', () => {
      const long = 'packages/analyzer/src/server/some/deeply/nested/path/to/a/file-with-a-long-name.ts'.repeat(4);
      const heavy = Array.from({ length: 10 }, (_, i) => [
        { role: 'user', text: `short ask ${i}` },
        { role: 'assistant', text: 'z'.repeat(2000), work: Array.from({ length: 12 }, () => long), evidence: { filesRead: Array.from({ length: 20 }, () => long), tools: Array.from({ length: 12 }, () => long), proposals: Array.from({ length: 8 }, () => long) } },
      ]).flat();
      const lines = renderAskHistorySection(heavy, 20, { contextWindow: 4096 });
      assert.ok(lines.join('\n').length <= 4096 * 4 * 0.25, `history is ${lines.join('\n').length} chars`);
      assert.ok(lines.some((l) => l.startsWith('  [work]')), 'the newest turn still carries its work');
    });

    it('a 4k window keeps the newest message whole and trims the older ones first; one longer than the quarter keeps its end', () => {
      const lines = renderAskHistorySection(thread, 20, { contextWindow: 4096 });
      const newest = lines.filter((l) => l.startsWith('User: ') && !l.includes('trimmed to fit')).at(-1)!;
      assert.strictEqual(newest, `User: ${filler}and also ask number 9 at the very end`.trimEnd());
      const huge = [{ role: 'user', text: `${'blah '.repeat(2000)}and the last ask` }];
      const cut = renderAskHistorySection(huge, 20, { contextWindow: 4096 });
      assert.ok(cut.join('\n').length <= 4096);
      assert.ok(cut.at(-1)!.endsWith('and the last ask'), 'the end, where the last ask is, survives');
    });

    it('any local OpenAI-compatible server is local: LM Studio, a LAN Ollama, another port all get 4,096; only hosted gets 80k', async () => {
      const noFetch = (async () => {
        throw new Error('not probed');
      }) as unknown as typeof fetch;
      for (const url of ['http://127.0.0.1:1234/v1', 'http://localhost:8080/v1', 'http://192.168.1.20:11434/v1', 'http://10.0.0.5:1234', 'http://studio.local:1234/v1']) {
        assert.strictEqual(await askHistoryWindow('openai-compatible', url, 'm', noFetch), null, url);
      }
      assert.strictEqual(await askHistoryWindow('openai-compatible', 'https://api.together.xyz/v1', 'm', noFetch), undefined);
      assert.strictEqual(await askHistoryWindow('anthropic', undefined, 'm', noFetch), undefined);
      /* The loopback Ollama is still probed; an unreadable window is null too. */
      assert.strictEqual(await askHistoryWindow('openai-compatible', 'http://127.0.0.1:11434/v1', 'm', noFetch), null);
    });

    it('no num_ctx in the Modelfile: Ollama’s 4,096 default is assumed, never the hosted 80k', () => {
      assert.deepStrictEqual(askHistoryBudget(null), askHistoryBudget(4096));
      assert.ok(askHistoryBudget(null).userChars < askHistoryBudget(undefined).userChars);
    });
  });
});
