/* ══════════════════════════════════════════════════════════════════════════
   A LAYOUT FOR jsdom, ENOUGH FOR A VIRTUALIZED LIST
   packages/web2/test/support/fakeLayout.ts

   jsdom lays nothing out, so a virtualized list measures every row at zero
   and draws none. This gives it a world: the transcript's scroller
   ([data-transcript-scroller]) is VIEW px tall, every row ([data-row-key]) is
   ROW px, anything else is as tall as the rows inside it. Sizes reach the
   list the ways it asks (getBoundingClientRect, clientHeight, a
   ResizeObserver that answers at once). An IntersectionObserver says an
   element is on screen while it is in the page, which is all the toasts'
   check needs. Everything is put back by the returned function.
   ══════════════════════════════════════════════════════════════════════════ */

export const ROW = 40;
export const VIEW = 600;

function sizeOf(el: Element): number {
  if (el.hasAttribute?.('data-transcript-scroller')) return VIEW;
  const rows = el.matches?.('[data-row-key]') ? 1 : (el.querySelectorAll?.('[data-row-key]').length ?? 0);
  return rows * ROW;
}

function rect(h: number): DOMRect {
  return { height: h, width: 800, top: 0, left: 0, bottom: h, right: 800, x: 0, y: 0, toJSON() {} } as DOMRect;
}

export function installFakeLayout(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = {
    RO: g.ResizeObserver,
    IO: g.IntersectionObserver,
    rect: Element.prototype.getBoundingClientRect,
    ch: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
    cw: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  };
  class RO {
    constructor(private cb: ResizeObserverCallback) {}
    observe(el: Element) {
      const h = sizeOf(el);
      queueMicrotask(() => this.cb([{ target: el, contentRect: rect(h) } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver));
    }
    unobserve() {}
    disconnect() {}
  }
  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      queueMicrotask(() => this.cb([{ target: el, isIntersecting: el.isConnected, intersectionRatio: el.isConnected ? 1 : 0 } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver));
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  g.ResizeObserver = RO;
  g.IntersectionObserver = IO;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return rect(sizeOf(this));
  };
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return sizeOf(this);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  return () => {
    g.ResizeObserver = saved.RO;
    g.IntersectionObserver = saved.IO;
    Element.prototype.getBoundingClientRect = saved.rect;
    if (saved.ch) Object.defineProperty(HTMLElement.prototype, 'clientHeight', saved.ch);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    if (saved.cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', saved.cw);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  };
}
