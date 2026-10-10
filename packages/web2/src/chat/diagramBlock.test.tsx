import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DIAGRAM_THROTTLE_MS } from './DiagramBlock';
import { ProseMessage } from './ProseMessage';
import { proseBlocks } from './proseBlocks';
import { mermaidNode, sanitizeSvg } from './svgSanitize';

describe('sanitizeSvg', () => {
  it('keeps shapes and text, adds the namespace when missing', () => {
    const r = sanitizeSvg('<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="red"/><text x="1" y="9">hi</text></svg>');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.svg).toContain('<rect');
      expect(r.svg).toContain('hi');
    }
  });

  it('strips script, handlers, foreignObject, external hrefs and url() references', () => {
    const r = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><div>x</div></foreignObject>
        <rect onclick="evil()" width="4" height="4" fill="url(https://evil.test/x.svg#a)"/>
        <circle r="2" style="fill:url(#g)" id="ok"/>
        <a href="javascript:alert(1)"><text>x</text></a>
        <image href="https://evil.test/p.png"/>
        <use xlink:href="https://evil.test/s.svg#x" xmlns:xlink="http://www.w3.org/1999/xlink"/>
        <set attributeName="href" to="javascript:alert(1)"/>
      </svg>`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const bad of ['script', 'alert', 'foreignObject', 'onclick', 'onload', 'evil.test', 'javascript', '<image', '<use', '<set']) expect(r.svg).not.toContain(bad);
    expect(r.svg).toContain('style="fill:url(#g)"');
  });

  it('refuses what is not an svg or does not parse', () => {
    expect(sanitizeSvg('<div/>').ok).toBe(false);
    expect(sanitizeSvg('<svg><rect></svg>').ok).toBe(false);
  });
});

const PAYLOADS: Record<string, string> = {
  comment: '<svg><!--><img src=x onerror=alert(1)>--></svg>',
  pi: '<svg><?x ><img src=x onerror=alert(1)>?></svg>',
  cdata: '<svg><desc><![CDATA[ x><img src=x onerror=alert(1)> ]]></desc></svg>',
  formaction: '<svg><p/><form><button formaction="java&#9;script:alert(1)">Click</button></form></svg>',
  htmlImg: '<svg><img src="https://evil/pixel"/></svg>',
  cssEscape: '<svg><rect width="4" height="4" style="fill:u\\72l(https://evil/x)"/></svg>',
  imageSet: `<svg><rect width="4" height="4" style="cursor:image-set('https://evil/i' 1x)"/></svg>`,
  xlinkJs: '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="javascript:alert(1)"/></svg>',
  externalUse: '<svg><use href="https://evil/s.svg#x"/></svg>',
  styleImport: '<svg><style>@import url(https://evil/a.css);</style><rect style="fill:red;@import url(https://evil/b.css)"/></svg>',
  animate: '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a><set attributeName="onmouseover" to="alert(1)"/></svg>',
  upperOn: '<svg ONLOAD="alert(1)"><rect OnClick="alert(1)" width="3" height="3"/></svg>',
  entityHref: '<svg><a href="&#106;avascript:alert(1)"><text>x</text></a></svg>',
  aHref: '<svg><a href="https://evil/"><text>x</text></a></svg>',
  dataUri: '<svg><image href="data:text/html,<script>alert(1)</script>"/><rect fill="url(data:image/svg+xml,x)"/></svg>',
  foreign: '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)></body></foreignObject></svg>',
  nested: '<svg><svg onload="alert(1)" width="4"><script>alert(1)</script><rect onclick="x()"/></svg></svg>',
};

describe('sanitizeSvg payloads', () => {
  for (const [name, payload] of Object.entries(PAYLOADS)) {
    it(`neutralises ${name}`, () => {
      const r = sanitizeSvg(payload);
      if (!r.ok) return; /* refusing it outright is also safe */
      const host = document.createElement('div');
      host.appendChild(document.importNode(r.node, true));
      expect(host.querySelector('img, form, button, script, foreignObject, image, a, style, animate, set')).toBeNull();
      for (const el of Array.from(host.querySelectorAll('*'))) {
        for (const a of Array.from(el.attributes)) {
          expect(a.name.toLowerCase().startsWith('on')).toBe(false);
          expect(/javascript|evil|data:|image-set|@import/i.test(a.value)).toBe(false);
        }
      }
      expect(r.svg).not.toMatch(/onerror|<img|<form|evil|javascript/i);
    });
  }

  it('keeps a local-only use and a sanitised style, drops the rest', () => {
    const r = sanitizeSvg('<svg><defs><g id="a"><rect width="2" height="2"/></g></defs><use href="#a"/><rect style="fill:red;cursor:pointer;stroke:url(#g)" width="1" height="1"/></svg>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain('<use href="#a"');
    expect(r.svg).toContain('style="fill:red;stroke:url(#g)"');
  });

  it('a rendered payload leaves no html img or form in the page', async () => {
    for (const payload of [PAYLOADS.comment!, PAYLOADS.pi!, PAYLOADS.cdata!, PAYLOADS.formaction!, PAYLOADS.htmlImg!]) {
      const { container, unmount } = render(<ProseMessage text={'```svg\n' + payload + '\n```'} />);
      /* Wait for the diagram itself to paint (it renders lazily), not a fixed 30 ms that loses the race under load. */
      await waitFor(() => expect(container.querySelector('.dgm-art')).not.toBeNull(), { timeout: 3000 });
      expect(container.querySelector('img, form, button.x')).toBeNull();
      expect(container.querySelector('.dgm-art')!.querySelector('img, form, button')).toBeNull();
      unmount();
    }
  });
});

describe('proseBlocks diagrams', () => {
  it('marks an unclosed fence open, and reads a raw <svg> block as an svg block', () => {
    expect(proseBlocks('```mermaid\ngraph TD\nA-->B')).toEqual([{ kind: 'code', text: 'graph TD\nA-->B', language: 'mermaid', open: true }]);
    expect(proseBlocks('```mermaid\ngraph TD\nA-->B\n```')[0]).toEqual({ kind: 'code', text: 'graph TD\nA-->B', language: 'mermaid' });
    expect(proseBlocks('before\n<svg width="4"><rect/></svg>\nafter').map((b) => b.kind)).toEqual(['para', 'code', 'para']);
    expect((proseBlocks('<svg>\n<rect/>\n</svg>')[0] as { language: string }).language).toBe('svg');
  });
});

describe('mermaidNode', () => {
  it('drops foreignObject, scripts, images and handlers; keeps the theme style and svg text', () => {
    const n = mermaidNode('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><style>.a{fill:red}</style><foreignObject><div onclick="x()"><span>Client</span><img src=x onerror="x()"></div></foreignObject><script>x()</script><a href="https://evil/"><rect/></a><g><text>Client</text></g></svg>')!;
    expect(n.querySelector('foreignObject, span, div')).toBeNull();
    expect(n.querySelector('style')?.textContent).toBe('.a{fill:red}');
    expect(n.querySelector('script, img, a')).toBeNull();
    expect(n.querySelector('text')?.textContent).toBe('Client');
    expect(n.outerHTML).not.toMatch(/onload|onclick|onerror/i);
  });

  it('drops image, feImage and external references; keeps url(#id) and local use', () => {
    const n = mermaidNode(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><filter id="f"><feImage href="https://evil.example/f"/><feGaussianBlur stdDeviation="2"/></filter><marker id="m"><path d="M0 0"/></marker></defs>' +
        '<image href="https://evil.example/s"/><use href="https://evil.example/u#a"/><use href="#m"/><path marker-end="url(#m)" fill="url(https://evil.example/p)" style="background-image:url(https://evil.example/b);stroke:red"/></svg>',
    )!;
    const html = n.outerHTML;
    expect(html).not.toMatch(/evil|<image|feImage/i);
    expect(n.querySelector('feGaussianBlur')).not.toBeNull();
    expect(n.querySelector('use')?.getAttribute('href')).toBe('#m');
    expect(n.querySelector('path[marker-end]')?.getAttribute('marker-end')).toBe('url(#m)');
  });

  it('drops a theme stylesheet that can fetch anything, keeps one that cannot', () => {
    const bad = [
      'g{background-image:url(https://evil.example/x)} text{cursor:url(https://evil.example/c),auto}',
      '@import "https://evil.example/a.css";',
      '.a{background:u\\72l(https://evil.example/b)}',
      '.a{cursor:image-set("https://evil.example/i" 1x)}',
      '@font-face{src:url(//evil.example/f.woff)}',
      '.a{background:url(data:image/png;base64,AAAA)}',
    ];
    for (const css of bad) expect(mermaidNode(`<svg xmlns="http://www.w3.org/2000/svg"><style>${css}</style><g/></svg>`)!.querySelector('style')).toBeNull();
    const ok = mermaidNode('<svg xmlns="http://www.w3.org/2000/svg"><style>#d .edge{marker-end:url(#arrow);fill:red;font-family:Inter,sans-serif}</style></svg>')!;
    expect(ok.querySelector('style')?.textContent).toContain('url(#arrow)');
  });
});

describe('an unclosed raw <svg>', () => {
  const text = '<svg width="10">\n<rect/>\nprose\n\n## Heading';
  it('final text: ends at the first blank line, so the heading renders', () => {
    const blocks = proseBlocks(text);
    expect(blocks.map((b) => b.kind)).toEqual(['code', 'heading']);
    expect((blocks[0] as { open?: boolean }).open).toBeUndefined();
  });
  it('streaming: stays an open diagram', () => {
    const blocks = proseBlocks('<svg width="10">\n<rect/>\n\nmore', true);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as { open?: boolean }).open).toBe(true);
  });
  it('a closed svg with a blank line inside is still one block', () => {
    expect(proseBlocks('<svg>\n<rect/>\n\n<circle/>\n</svg>\nafter').map((b) => b.kind)).toEqual(['code', 'para']);
  });
});

describe('DiagramBlock in an answer', () => {
  afterEach(() => vi.useRealTimers());
  const SVG = '```svg\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n```';

  it('draws an svg fence, toggles to source and back', async () => {
    render(<ProseMessage text={SVG} />);
    expect(await screen.findByTestId('chat-diagram-art')).toBeTruthy();
    expect(screen.getByTestId('chat-diagram-art').innerHTML).toContain('<circle');
    fireEvent.click(screen.getByTestId('chat-diagram-toggle'));
    expect(screen.queryByTestId('chat-diagram-art')).toBeNull();
    expect(screen.getByTestId('chat-code').textContent).toContain('<circle');
    fireEvent.click(screen.getByTestId('chat-diagram-toggle'));
    expect(screen.getByTestId('chat-diagram-art')).toBeTruthy();
  });

  it('a finished block that does not parse shows its code and a note', async () => {
    render(<ProseMessage text={'```svg\n<svg><rect></svg>\n```'} />);
    expect(await screen.findByTestId('chat-diagram-note')).toBeTruthy();
    expect(screen.getByTestId('chat-diagram-note').textContent).toMatch(/didn't parse/);
    expect(screen.getByTestId('chat-code')).toBeTruthy();
  });

  it('while streaming, the last good drawing stays and no error is shown for a half-written fence', async () => {
    vi.useFakeTimers();
    const good = '```svg\n<svg viewBox="0 0 10 10"><circle r="4"/></svg>\n```';
    const { rerender } = render(<ProseMessage text={good} streaming />);
    await act(async () => {
      vi.advanceTimersByTime(5);
    });
    expect(screen.getByTestId('chat-diagram-art')).toBeTruthy();
    /* The answer grows into a different, still-open drawing that does not parse yet. */
    rerender(<ProseMessage text={'```svg\n<svg viewBox="0 0 10 10"><circle r="4"/><rect'} streaming />);
    await act(async () => {
      vi.advanceTimersByTime(DIAGRAM_THROTTLE_MS + 10);
    });
    expect(screen.getByTestId('chat-diagram').getAttribute('data-state')).toBe('drawn');
    expect(screen.queryByTestId('chat-diagram-note')).toBeNull();
    expect(screen.getByTestId('chat-diagram-art')).toBeTruthy();
  });
});

describe('DiagramBlock throttle', () => {
  afterEach(() => vi.useRealTimers());
  it('a steadily streaming fence redraws several times, not once at the end', async () => {
    vi.useFakeTimers();
    const rect = (n: number) => Array.from({ length: n }, (_, i) => `<rect x="${i}" width="1" height="1"/>`).join('');
    const { rerender, getByTestId } = render(<ProseMessage text={'```svg\n<svg viewBox="0 0 30 5">' + rect(1) + '</svg>\n```'} streaming />);
    const seen = new Set<number>();
    for (let i = 2; i <= 21; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      rerender(<ProseMessage text={'```svg\n<svg viewBox="0 0 30 5">' + rect(i) + '</svg>\n```'} streaming />);
      await act(async () => {
        await Promise.resolve();
      });
      const art = document.querySelector('[data-testid="chat-diagram-art"]');
      if (art) seen.add(art.querySelectorAll('rect').length);
    }
    expect(getByTestId('chat-diagram')).toBeTruthy();
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});
