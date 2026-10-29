// Native 16-bit-style framebuffer size (SPEC.md §1.3).
export const GAME_WIDTH = 320;
export const GAME_HEIGHT = 180;

/**
 * Returns the Phaser zoom that scales the framebuffer by the largest whole
 * number of *device* pixels that fits the viewport, so every game pixel maps
 * to the same number of screen pixels (pixel-perfect, letterboxed).
 */
export function fitZoom(viewportWidth: number, viewportHeight: number, devicePixelRatio = 1): number {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const deviceScale = Math.max(
    1,
    Math.floor(Math.min((viewportWidth * dpr) / GAME_WIDTH, (viewportHeight * dpr) / GAME_HEIGHT)),
  );
  return deviceScale / dpr;
}
