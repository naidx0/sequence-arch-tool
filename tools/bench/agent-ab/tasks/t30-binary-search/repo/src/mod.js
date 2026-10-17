export function binarySearch(a, x) {
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] === x) return mid;
    if (a[mid] < x) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
