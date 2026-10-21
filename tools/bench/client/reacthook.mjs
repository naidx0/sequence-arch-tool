/* A React DevTools hook stand-in, injected into the renderer BEFORE the app loads (page.addInitScript), for the
   profiling build only (react-dom aliased to react-dom/profiling: a production build records no durations).
   Per commit it walks the fibers that re-rendered (DevTools' own rule: a subtree whose first child is the same
   object as its alternate's did not render) and adds, per component name, renders, self ms and total ms.
   window.__rc.reset() / window.__rc.dump(). Used only by `run.mjs --reacthook`; never present in a normal run. */
export function reactHook() {
  if (window.__rc) return;
  const acc = new Map();
  let commits = 0;
  let commitMs = 0;
  const FN = new Set([0, 1, 11, 14, 15]);
  const nameOf = (f) => {
    const t = f.type;
    if (!t) return null;
    if (typeof t === 'function') return t.displayName || t.name || 'Anonymous';
    if (t.displayName) return t.displayName;
    if (t.render) return t.render.displayName || t.render.name || 'ForwardRef';
    if (t.type) return (typeof t.type === 'function' && (t.type.displayName || t.type.name)) || 'Memo';
    return null;
  };
  const visit = (f) => {
    for (let c = f; c; c = c.sibling) {
      const alt = c.alternate;
      if (FN.has(c.tag) && (c.flags & 1) === 1 && (alt || true)) {
        const n = nameOf(c) ?? 'Unknown';
        let kids = 0;
        for (let k = c.child; k; k = k.sibling) if (k.alternate && k.child !== k.alternate.child) kids += k.actualDuration || 0;
        const e = acc.get(n) ?? { renders: 0, selfMs: 0, totalMs: 0, mounts: 0 };
        e.renders += 1;
        if (!alt) e.mounts += 1;
        e.totalMs += c.actualDuration || 0;
        e.selfMs += Math.max(0, (c.actualDuration || 0) - kids);
        acc.set(n, e);
      }
      if (c.child && (!alt || c.child !== alt.child)) visit(c.child);
    }
  };
  window.__rc = {
    reset() {
      acc.clear();
      commits = 0;
      commitMs = 0;
    },
    dump() {
      return { commits, commitMs, components: [...acc].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.selfMs - a.selfMs) };
    },
  };
  let id = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(r) {
      this.renderers.set(++id, r);
      return id;
    },
    checkDCE() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      try {
        commits += 1;
        commitMs += root.current.actualDuration || 0;
        visit(root.current.child);
      } catch {
        /* a bad walk never breaks the app */
      }
    },
  };
}
