export function fmtMoney(cents) {
  return '$' + (cents / 100).toFixed(2);
}
