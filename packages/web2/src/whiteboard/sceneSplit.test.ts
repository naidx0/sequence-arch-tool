import { describe, expect, it } from 'vitest';
import exportSrc from './exportScene.ts?raw';
import remotionSrc from './sceneRemotion.ts?raw';
import sceneSrc from './scene.ts?raw';

/* scene.ts is on the boot path (the board model imports it); the Remotion export text is ~11 KB and belongs to the Space chunk. */
describe('the scene model stays small', () => {
  it('keeps the Remotion export text out of scene.ts, and only exportScene.ts imports it', () => {
    expect(sceneSrc).not.toContain('AbsoluteFill');
    expect(remotionSrc).toContain('AbsoluteFill');
    expect(exportSrc).toContain("from './sceneRemotion'");
  });
});
