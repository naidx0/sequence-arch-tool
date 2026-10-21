import type { Mark } from './mark';
import { PROVIDER_MARKS } from './providerMarks';

/** A models.dev provider's packaged mark by its id, or undefined (the page then draws its initial). */
export function providerMark(id: string): Mark | undefined {
  return PROVIDER_MARKS[id];
}
