export function capitalize(s) {
  if (s === '') return '';
  return s[0].toUpperCase() + s.slice(1);
}
