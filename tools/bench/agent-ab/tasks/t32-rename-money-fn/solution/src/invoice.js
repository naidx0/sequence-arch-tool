import { formatMoney } from './money.js';

export function line(name, cents) {
  return name + ': ' + formatMoney(cents);
}
