export function maxBy(arr, fn) {
  let best = arr[0];
  for (const x of arr) if (fn(x) < fn(best)) best = x;
  return best;
}
