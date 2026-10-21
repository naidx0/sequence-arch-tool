/* The code that runs INSIDE the renderer. Kept as plain functions so the runner can pass them to page.evaluate,
   and so what is measured is read in one place. Every time is performance.now() in the page: one clock for the
   action and for the paint it is waiting for. */

/** Install window.__b. Idempotent. */
export function install() {
  if (window.__b) return true;
  const visible = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return false;
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };
  const b = (window.__b = { visible, frameDeltas: [], long: [], events: [], keys: [] });

  /* Action to first meaningful paint: run the action, then wait for a frame in which the marker is on screen;
     the paint of that frame is done when the NEXT frame's callback runs. Null when it never showed. */
  b.openTime = (kind, markerSel, absentSel = null, timeoutMs = 20000) =>
    new Promise((resolve) => {
      const t0 = performance.now();
      try {
        b.action(kind);
      } catch (e) {
        resolve({ error: String(e) });
        return;
      }
      const tick = () => {
        if (visible(markerSel) && !(absentSel && document.querySelector(absentSel))) {
          requestAnimationFrame((t) => resolve({ ms: t - t0 }));
          return;
        }
        if (performance.now() - t0 > timeoutMs) {
          resolve({ ms: null });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  const click = (sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    const el = els.find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!el) throw new Error(`nothing visible for ${sel}`);
    el.click();
  };
  const key = (k, mods = {}) => {
    const init = { key: k, bubbles: true, cancelable: true, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', init));
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keyup', init));
  };
  const setValue = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const MOD = { ctrl: !/Mac/i.test(navigator.platform), meta: /Mac/i.test(navigator.platform) };
  b.action = (kind) => {
    switch (kind) {
      case 'settings':
        return click('[data-testid="v3-rail-settings"], [data-testid="s2-iconrail-settings"]');
      case 'help':
      case 'search':
        /* the palette is already open and filtered to the row (see prepare): the timed action is Enter */
        return key('Enter');
      case 'files':
      case 'architecture':
      case 'whiteboard':
      case 'terminal':
        return click(`[data-testid="s2-tab-${kind}"]`);
      default:
        throw new Error(`unknown action ${kind}`);
    }
  };
  /* Steps that are not timed: open the palette on its row, so the timed action is only Enter. */
  const PALETTE_QUERY = { search: 'Search this project', help: 'What can I do here' };
  b.prepare = async (kind) => {
    if (!PALETTE_QUERY[kind]) return true;
    key('k', MOD);
    for (let i = 0; i < 100; i++) {
      const input = document.querySelector('[data-testid="command-field"]');
      if (input) {
        setValue(input, PALETTE_QUERY[kind]);
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 200));
    return true;
  };
  /* n open/close cycles inside the page (no harness round trip per cycle); how many opens never showed the marker */
  b.cycles = async (kind, markerSel, absentSel, n) => {
    let failed = 0;
    for (let i = 0; i < n; i++) {
      await b.prepare(kind);
      const r = await b.openTime(kind, markerSel, absentSel, 8000);
      if (r.ms == null) failed += 1;
      await b.closeAny();
    }
    return failed;
  };
  b.closeAny = async () => {
    for (let i = 0; i < 3; i++) {
      key('Escape');
      await new Promise((r) => setTimeout(r, 120));
    }
    for (let i = 0; i < 40; i++) {
      if (!document.querySelector('.v3-overlay-scrim')) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  /* frame recorder: rAF deltas between start() and stop() */
  let rec = null;
  b.startFrames = () => {
    b.frameDeltas = [];
    let last = null;
    rec = { on: true };
    const tick = (t) => {
      if (!rec?.on) return;
      if (last !== null) b.frameDeltas.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  b.stopFrames = () => {
    if (rec) rec.on = false;
    return b.frameDeltas.slice();
  };

  /* long tasks and event timing for the whole session */
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) b.long.push(e.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* not supported */
  }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) b.events.push({ name: e.name, start: e.startTime, duration: e.duration, interactionId: e.interactionId || 0 });
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch {
    /* not supported */
  }

  /* keystroke to paint: every keydown in the page; after the next frame commits and its paint is done */
  b.watchKeys = (on) => {
    if (on) {
      b.keys = [];
      b._kd = (e) => {
        const t = e.timeStamp;
        requestAnimationFrame(() => requestAnimationFrame((now) => b.keys.push(now - t)));
      };
      window.addEventListener('keydown', b._kd, true);
    } else if (b._kd) {
      window.removeEventListener('keydown', b._kd, true);
    }
  };

  /* the scrollable element of a pane: the deepest-first element inside `root` that scrolls vertically the most */
  b.scroller = (rootSel) => {
    const root = document.querySelector(rootSel);
    if (!root) return null;
    let best = null;
    for (const el of root.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll)/.test(cs.overflowY)) continue;
      const room = el.scrollHeight - el.clientHeight;
      if (room > 200 && (!best || room > best.scrollHeight - best.clientHeight)) best = el;
    }
    if (!best) return null;
    best.setAttribute('data-bench-scroller', '1');
    const r = best.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, room: best.scrollHeight - best.clientHeight, scrollTop: best.scrollTop };
  };
  b.scrollTop = () => document.querySelector('[data-bench-scroller]')?.scrollTop ?? null;

  b.memory = () => ({ usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null, nodes: document.getElementsByTagName('*').length });
  return true;
}
