export function formatTotal(total: number): string {
  return `$${(total / 100).toFixed(2)}`;
}
