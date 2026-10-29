/** The game's pixel font (Press Start 2P, SIL OFL — web/public/fonts/OFL.txt). */
export const PIXEL_FONT = '"Press Start 2P", monospace';

/** Default Phaser text style: 8 px glyphs on the 320×180 framebuffer. */
export const TEXT = { fontFamily: PIXEL_FONT, fontSize: '8px', color: '#f0f0f0' };

/** Waits until the pixel font is ready so Phaser texts don't render a fallback. */
export async function loadPixelFont(): Promise<void> {
  try {
    await document.fonts.load(`8px ${PIXEL_FONT}`);
  } catch {
    // Fall back to monospace; the game stays playable.
  }
}
