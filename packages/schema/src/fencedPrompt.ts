/**
 * The fenced block in a model's answer: where a skill that "writes the rewritten prompt in a single fenced
 * block" (be-ambitious) puts its result. PURE and total: never throws, returns null when there is no complete block.
 *
 * Line-based, like CommonMark: a fence opens with three or more backticks (or tildes) and closes on a line of the
 * same character at least as long and nothing else, so a four-backtick block can hold a three-backtick example.
 * The LAST complete block wins: the analysis before the rewrite may quote code, the rewrite is what comes last.
 * An unclosed fence (a truncated answer) is not a block.
 */
export function extractFencedPrompt(text: string): string | null {
  if (typeof text !== 'string' || text === '') return null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let last: string | null = null;
  let open: { ch: string; len: number; start: number } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (open === null) {
      const m = /^ {0,3}(`{3,}|~{3,})[^`]*$/.exec(line);
      if (m) open = { ch: m[1]![0]!, len: m[1]!.length, start: i + 1 };
    } else {
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1]![0] === open.ch && m[1]!.length >= open.len) {
        const body = lines.slice(open.start, i).join('\n').trim();
        if (body !== '') last = body;
        open = null;
      }
    }
  }
  return last;
}
