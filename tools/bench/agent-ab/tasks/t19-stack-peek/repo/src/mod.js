export class Stack {
  #a = [];
  push(x) { this.#a.push(x); }
  pop() { return this.#a.pop(); }
  peek() { return this.#a.pop(); }
  get size() { return this.#a.length; }
}
