export function maxBy(arr, fn) {
  let best;
  for (const x of arr) if (best === undefined || fn(x) > fn(best)) best = x;
  return best;
}
