export function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) (out[fn(x)] ??= []).push(x);
  return out;
}
