export function omit(obj, keys) {
  for (const k of keys) delete obj[k];
  return obj;
}
