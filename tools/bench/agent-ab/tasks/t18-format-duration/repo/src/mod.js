export function formatDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return h + 'h ' + m + 'm ' + s + 's';
}
