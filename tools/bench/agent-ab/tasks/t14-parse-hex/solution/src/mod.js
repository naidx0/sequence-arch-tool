export function parseHex(s) {
  return parseInt(s.replace(/^0x/i, ''), 16);
}
