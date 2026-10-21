export function retry(fn, times) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return fn(i); } catch (e) { last = e; }
  }
  throw last;
}
