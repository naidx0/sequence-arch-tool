export function padLeft(s, width, ch = ' ') {
  return String(s).padStart(width, ch);
}
