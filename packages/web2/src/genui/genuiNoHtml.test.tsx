// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { UISpec } from '@sequence/genui';

import { GenUISavedSurface } from './GenUISavedSurface';

/* The inline renderer draws catalog components and nothing else. Agent HTML (a fence, a prop, a title) is text,
   never markup. Out-of-catalog UI is a later, separate tier in a sandboxed iframe (MCP Apps), not this renderer. */

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RENDERERS = ['GenUISurface.tsx', 'GenUISavedSurface.tsx', 'GenUIFence.tsx'];

/** What would let a string become markup or a frame. */
const SINKS = /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|<iframe|<object|<embed|srcDoc|srcdoc|DOMParser/;

describe('no agent HTML in the inline renderer', () => {
  it('the renderer sources contain no HTML sink (and the scan finds a planted one)', () => {
    expect(SINKS.test('el.innerHTML = agent'), 'positive control').toBe(true);
    expect(SINKS.test('<div dangerouslySetInnerHTML={{ __html: x }} />'), 'positive control').toBe(true);
    for (const f of RENDERERS) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8');
      expect(SINKS.test(text), `${f} has an HTML sink`).toBe(false);
    }
  });

  afterEach(() => cleanup());

  it('markup in every text-bearing prop is drawn as text: no element is created from it', () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><b>bold</b>';
    const short = '<b onclick=1>Go</b>';
    const spec: UISpec = {
      root: 'card',
      state: {},
      actions: { go: { description: evil } },
      meta: {},
      elements: {
        card: { type: 'Card', props: { title: evil, subtitle: evil }, children: ['h', 't', 'tl', 'kv', 'co', 'acts'] },
        h: { type: 'Heading', props: { text: evil } },
        t: { type: 'Text', props: { text: evil } },
        tl: { type: 'Timeline', props: {}, children: ['i'] },
        i: { type: 'TimelineItem', props: { title: evil, detail: evil, status: 'done' } },
        kv: { type: 'KeyValue', props: { items: [{ key: short, value: evil }] } },
        co: { type: 'Callout', props: { text: evil, tone: 'info' } },
        acts: { type: 'Actions', props: {}, children: ['go'] },
        go: { type: 'Button', props: { label: short, action: { name: 'go' } } },
      },
    };
    const { container } = render(<GenUISavedSurface saved={{ surface: 's', spec }} />);
    expect(container.querySelector('img, script, iframe, object, embed, b')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(container.textContent).toContain('<img src=x onerror=');
    expect(container.textContent).toContain('<b>bold</b>');
    expect(container.textContent).toContain(short);
    /* every one of them drew (a skeleton would pass the checks above for the wrong reason) */
    expect(container.querySelector('.gu-skel')).toBeNull();
  });

  it('an element type or prop that is not in the catalog is never drawn', () => {
    const spec: UISpec = {
      root: 'card',
      state: {},
      actions: {},
      meta: {},
      elements: {
        card: { type: 'Card', props: { title: 'ok' }, children: ['x', 'y'] },
        x: { type: 'Html', props: { html: '<h1>pwn</h1>' } },
        y: { type: 'Text', props: { text: 'fine', dangerouslySetInnerHTML: '<h1>pwn</h1>', style: 'position:fixed' } },
      },
    };
    const { container } = render(<GenUISavedSurface saved={{ surface: 's', spec }} />);
    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).not.toContain('pwn');
    expect(container.querySelector('[style*="fixed"]')).toBeNull();
  });
});
