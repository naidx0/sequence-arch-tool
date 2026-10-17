import { Profiler } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/* Every call to the block parser, with the length it was handed. */
const parsed: number[] = [];
vi.mock('./proseBlocks', async (orig) => {
  const real = await orig<typeof import('./proseBlocks')>();
  return {
    ...real,
    proseBlocks: (text: string) => {
      parsed.push(text.length);
      return real.proseBlocks(text);
    },
  };
});

const { ProseMessage } = await import('./ProseMessage');

/**
 * A long reply as a model streams it: headings, prose with em dashes (which
 * make the string two-byte), lists, maths and code fences, some of them with
 * blank lines inside. Built deterministically so the replay is the same run
 * to run.
 */
function longReply(sections = 24): string {
  const out: string[] = [];
  for (let i = 0; i < sections; i++) {
    out.push(`## Part ${i + 1} — what the orders service does`);
    out.push('');
    out.push(`The gateway calls **orders** over HTTP — see \`orders/app/main.py:${40 + i}\` — and orders writes to Postgres; the cost is $O(n)$ per request.`);
    out.push('');
    out.push('- reads the cart');
    out.push(`- writes order ${i}`);
    out.push('- publishes `order.created`');
    out.push('');
    out.push('```python');
    out.push(`def handler_${i}(req):`);
    out.push('    total = sum(line.price for line in req.lines)');
    out.push('');
    out.push('    return {"total": total}  # — two-byte comment');
    out.push('```');
    out.push('');
  }
  return out.join('\n');
}

/** Replay `text` into a ProseMessage `size` characters at a time. */
function replay(text: string, size: number) {
  parsed.length = 0;
  const durations: number[] = [];
  let commits = 0;
  const onRender = (_id: string, _phase: string, actual: number) => {
    commits += 1;
    durations.push(actual);
  };
  const view = (t: string) => (
    <Profiler id="answer" onRender={onRender}>
      <ProseMessage text={t} />
    </Profiler>
  );
  const r = render(view(''));
  let chunks = 0;
  for (let at = size; at < text.length + size; at += size) {
    r.rerender(view(text.slice(0, Math.min(at, text.length))));
    chunks += 1;
  }
  const html = r.container.innerHTML;
  r.unmount();
  const totalParsed = parsed.reduce((a, b) => a + b, 0);
  return { chunks, commits, totalParsed, html, durationMs: durations.reduce((a, b) => a + b, 0) };
}

describe('a streamed answer', () => {
  const text = longReply();
  const CHUNK = 48;

  it('parses only the unfinished tail per chunk, not the whole message', () => {
    const run = replay(text, CHUNK);
    /* One commit per chunk (plus the mount): the stream does not cause extra renders. */
    expect(run.commits).toBe(run.chunks + 1);
    /* Re-parsing the whole message each chunk is quadratic: about
       length * chunks / 2 characters. Parsing only the open segment is
       linear in the length, within a small factor. */
    const quadratic = (text.length * run.chunks) / 2;
    console.log(
      `prose stream: ${text.length} chars, ${run.chunks} chunks of ${CHUNK}; parsed ${run.totalParsed} chars ` +
        `(${(run.totalParsed / text.length).toFixed(1)}x the reply); render ${run.durationMs.toFixed(1)} ms total, ` +
        `${(run.durationMs / run.chunks).toFixed(2)} ms per chunk`,
    );
    expect(run.totalParsed).toBeLessThan(text.length * 4);
    expect(run.totalParsed).toBeLessThan(quadratic / 20);
  });

  it('draws the same thing as parsing the whole message at once', () => {
    const streamed = replay(text, CHUNK).html;
    const whole = render(<ProseMessage text={text} />);
    expect(streamed).toBe(whole.container.innerHTML);
    whole.unmount();
  });

  it('growing the pieces chunk by chunk gives the same pieces as one scan, and the same blocks as one parse', async () => {
    const real = await vi.importActual<typeof import('./proseBlocks')>('./proseBlocks');
    const t = `${text}\r\n<details><summary>x</summary>\n\na\n\n</details>\n\n~~~\n\n~~~\nend`;
    let grown: ReturnType<typeof real.growSegments> | null = null;
    for (let at = 1; at <= t.length; at += 37) {
      const prefix = t.slice(0, at);
      grown = real.growSegments(grown, prefix);
      expect(grown.segments).toEqual(real.proseSegments(prefix));
    }
    expect(real.proseSegments(t).flatMap((s) => real.proseBlocks(s))).toEqual(real.proseBlocks(t));
  });

  it('a blank line inside a fence or a details block does not cut it', () => {
    const t = '```\na\n\nb\n```\n\n<details><summary>More</summary>\n\nx\n\n</details>\n\ntail';
    const one = render(<ProseMessage text={t} />);
    expect(one.container.querySelectorAll('[data-testid="chat-code"]')).toHaveLength(1);
    expect(one.container.querySelector('[data-testid="chat-code"]')?.textContent).toBe('a\n\nb');
    expect(one.container.querySelectorAll('[data-testid="chat-details"]')).toHaveLength(1);
    one.unmount();
  });
});
