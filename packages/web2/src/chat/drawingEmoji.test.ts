import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMOJI_BOOTSTRAP, EMOJI_PATTERN, hasEmoji, stripEmoji, stripEmojiHtml, withEmojiFallback } from './drawingEmoji';

describe('the emoji set: strip these', () => {
  it('emoji-presentation characters, the FE0F form of any character, flags, skin tones, ZWJ sequences', () => {
    expect(stripEmoji('Ship it 🚢')).toBe('Ship it');
    expect(stripEmoji('🚀 Deploy 🎉')).toBe(' Deploy');
    expect(stripEmoji('ok ✅ warn ⚠️ hot 🔥')).toBe('ok warn hot');
    expect(stripEmoji('a 👍🏽 b')).toBe('a b');
    expect(stripEmoji('team 👩‍💻 here')).toBe('team here');
    expect(stripEmoji('flag 🇺🇸 x')).toBe('flag x');
    expect(stripEmoji('<b>🚀</b>')).toBe('<b></b>');
    expect(stripEmoji('heart ❤️ on')).toBe('heart on');
  });
});

describe('the emoji set: keep these (text-presentation symbols, arrows, scripts)', () => {
  it('arrows, dingbats, stars, hearts, gears, suns, info, ballot box, CJK, math, shapes, marks', () => {
    const keep = [
      '⬅ ⬆ ⬇ ➡ ⤴ ⤵',
      '← ↑ → ↓ ↔ ⇒',
      '✔ ✖ ★ ♥ ⚙ ☀ ℹ ☑',
      '日本語のテキスト',
      '한국어',
      '∑ x² ≤ ∞ ≠ √2 ∫',
      '▶ ■ ◆ ○',
      '© ® ™',
      'naïve café',
      'हिन्दी ‍क्‍ष',
      'Step 1: 2 > 1 *',
      '— – … “quoted”',
    ];
    for (const s of keep) expect(stripEmoji(s), s).toBe(s);
    expect(stripEmoji('➡️ and ⬅️')).toBe('➡ and ⬅');
    expect(hasEmoji('日本語 → ⬅ ✔ ★ 2')).toBe(false);
  });
});

describe('spacing: a space goes only when whitespace or the end follows the emoji', () => {
  it('"Ship X it" loses one space, "Ship Xit" keeps its space', () => {
    expect(stripEmoji('Ship 🚀 it')).toBe('Ship it');
    expect(stripEmoji('Ship 🚀it')).toBe('Ship it');
    expect(stripEmoji('go 🚀')).toBe('go');
  });
});

describe('controls', () => {
  it('positive and negative controls for the detector', () => {
    expect(hasEmoji('ready 🎉')).toBe(true);
    expect(hasEmoji('ready')).toBe(false);
    expect(stripEmoji('')).toBe('');
  });
  it('is stable on its own output', () => {
    const s = '🚀 a 🎉 b ✅';
    expect(stripEmoji(stripEmoji(s))).toBe(stripEmoji(s));
  });
});

describe('mermaid: the original is drawn when the stripped source stops parsing', () => {
  const parse = async (src: string): Promise<string> => {
    if (/\[\]|\[""\]/.test(src)) throw new Error('parse error: empty label');
    return src;
  };
  it('a source that survives stripping is drawn stripped', async () => {
    const run = vi.fn(parse);
    expect(await withEmojiFallback('flowchart TD\nA[Ship 🚀] --> B[Done]', run)).toBe('flowchart TD\nA[Ship] --> B[Done]');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('a label that was only an emoji makes the stripped source fail: the original is drawn', async () => {
    const src = 'flowchart TD\nA[🚀] --> B["✅"]';
    const run = vi.fn(parse);
    expect(await withEmojiFallback(src, run)).toBe(src);
    expect(run.mock.calls.map((c) => c[0])).toEqual(['flowchart TD\nA[] --> B[""]', src]);
  });
  it('a source with no emoji is parsed once, as written; a source that fails either way throws', async () => {
    const run = vi.fn(parse);
    await withEmojiFallback('flowchart TD\nA --> B', run);
    expect(run).toHaveBeenCalledTimes(1);
    await expect(withEmojiFallback('A[] --> B', parse)).rejects.toThrow();
  });
});

describe('html: static strip (no script can run) parses first, so entities go and script text stays', () => {
  it('strips text and alt/value, keeps script and style bodies and regex literals', () => {
    const out = stripEmojiHtml('<p>Go &#x1F680; now</p><img alt="🚀 pic"><input value="ok ✅"><script>var r=/🚀/u;var s="🚀"</script><style>.a::after{content:"🚀"}</style>');
    expect(out).toContain('<p>Go now</p>');
    expect(out).toContain('alt="pic"');
    expect(out).toContain('value="ok"');
    expect(out).toContain('var r=/🚀/u;var s="🚀"');
    expect(out).toContain('content:"🚀"');
  });
  it('a page with nothing to strip comes back byte for byte', () => {
    const src = '<div>日本語 → ok</div>';
    expect(stripEmojiHtml(src)).toBe(src);
  });
});

describe('html frame bootstrap (runs in the drawn page)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const run = (): void => {
    const code = /<script>([\s\S]*)<\/script>/.exec(EMOJI_BOOTSTRAP)![1]!;
    new Function(code)();
  };
  it('strips text nodes and alt/value/title/placeholder, never script or style, and catches later changes', async () => {
    document.body.innerHTML =
      '<p id="p">Go &#x1F680; now 🎉</p><img alt="🚀 pic"><input value="ok ✅" placeholder="type 🔥"><button title="Ship 🚢">x</button>' +
      '<script type="text/plain">var s="🚀"</script><style>.a::after{content:"🚀"}</style>';
    run();
    expect(document.getElementById('p')!.textContent).toBe('Go now');
    expect(document.querySelector('img')!.getAttribute('alt')).toBe('pic');
    expect(document.querySelector('input')!.getAttribute('value')).toBe('ok');
    expect(document.querySelector('input')!.getAttribute('placeholder')).toBe('type');
    expect(document.querySelector('button')!.getAttribute('title')).toBe('Ship');
    expect(document.querySelector('script')!.textContent).toBe('var s="🚀"');
    expect(document.querySelector('body style')!.textContent).toBe('.a::after{content:"🚀"}');
    const d = document.createElement('div');
    d.textContent = 'later 🚀 text';
    document.body.appendChild(d);
    document.getElementById('p')!.firstChild!.textContent = 'edited 🎉';
    await new Promise((r) => setTimeout(r, 20));
    expect(d.textContent).toBe('later text');
    expect(document.getElementById('p')!.textContent).toBe('edited');
  });
  it('the bootstrap embeds the same pattern stripEmoji uses', () => {
    expect(EMOJI_BOOTSTRAP).toContain(JSON.stringify(EMOJI_PATTERN));
  });
});
