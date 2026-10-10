/**
 * THE FIVE ADVANTAGE DRAWINGS. Each is one self-contained SVG React component
 * that takes `progress` (0..1) and draws exactly that frame, so a scroll
 * driver can set it every frame; `progress` omitted is the finished drawing.
 * The numbers on TokensArt and SpeedArt are props; pass DEPTH_MEASURED.
 */
export { SystemDesignArt } from './SystemDesignArt';
export { TokensArt, type TokensArtProps } from './TokensArt';
export { SpeedArt, type SpeedArtProps } from './SpeedArt';
export { AccuracyArt } from './AccuracyArt';
export { ModelsArt } from './ModelsArt';
export type { ArtProps } from './shared';
