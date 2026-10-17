export function makeBatcher(flush) {
  let items = [];
  return {
    add(x) { items.push(x); },
    done() { const out = items; items = []; flush(out); },
  };
}
