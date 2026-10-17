import { fmtMoney } from './money.js';

export function line(name, cents) {
  return name + ': ' + fmtMoney(cents);
}
