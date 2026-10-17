export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '-');
}
