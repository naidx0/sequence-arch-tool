export function countWords(s) {
  const t = s.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}
