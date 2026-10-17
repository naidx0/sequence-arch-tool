export function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) out[fn(x)] = [x];
  return out;
}
