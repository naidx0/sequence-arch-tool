export function range(start, end, step = 1) {
  const out = [];
  if (step === 0) return out;
  for (let i = start; step > 0 ? i < end : i > end; i += step) out.push(i);
  return out;
}
