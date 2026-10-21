export function makeBatcher(flush) {
  const items = [];
  return {
    add(x) { items.push(x); },
    done() { flush(items); },
  };
}
