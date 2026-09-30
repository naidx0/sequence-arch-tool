import { describe, expect, it } from 'vitest';

import { isGlanceNoise } from './glanceLine';

/* The line `serviceInterior.moduleRole` writes for a module card has to get
   past the glance filter, or the macro level shows six cards with no words
   (builder's report on the ML Harness scan, 2026-09-22). The inventory line it
   is made from is dropped, as it should be. */
describe('a module card\'s glance line', () => {
  it('keeps "Defines …" and drops the inventory it came from', () => {
    expect(isGlanceNoise('Defines abort, run, ready (17 ts files in web)')).toBe(false);
    expect(isGlanceNoise('17 ts files in web, defining abort, run, ready.')).toBe(true);
  });
});
