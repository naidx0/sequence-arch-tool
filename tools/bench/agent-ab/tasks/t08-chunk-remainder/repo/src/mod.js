export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i + n <= arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
