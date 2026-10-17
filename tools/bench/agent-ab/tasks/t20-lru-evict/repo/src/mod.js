export class LRU {
  constructor(cap) { this.cap = cap; this.m = new Map(); }
  get(k) { return this.m.get(k); }
  set(k, v) {
    this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.cap) this.m.delete(this.m.keys().next().value);
  }
}
