import { HOST, DEFAULT_PORT } from './config.js';

export function describe() {
  return 'http://' + HOST + ':' + DEFAULT_PORT;
}
