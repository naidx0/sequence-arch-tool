export function flatten(arr) {
  return arr.reduce((acc, x) => acc.concat(Array.isArray(x) ? flatten(x) : [x]), []);
}
