export function retry(fn, times) {
  for (let i = 0; i <= times; i++) {
    try { return fn(i); } catch {}
  }
}
