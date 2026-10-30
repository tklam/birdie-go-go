// The splash poster (SPEC.md §1.3): a full-resolution illustration of Angie,
// O Boy and Kei shown over the title screen at start. It is the one place
// the game steps outside its 16-bit look. The first tap, click or key only
// dismisses it (audio still unlocks on that gesture); nothing reaches the
// title menu underneath.

/** True once the splash is gone (or was never shown). */
export function splashDone(): boolean {
  return document.body.dataset.splash !== 'open';
}

/**
 * Shows the poster at `url` until the player taps or presses a key. Resolves
 * when it has faded out. Reduced motion (the OS setting; saved settings
 * aren't loaded yet) skips the pulse and the fade.
 */
export function showSplash(url: string, alt: string): Promise<void> {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.className = still ? 'splash still' : 'splash';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${alt}. Tap or press any key to start.`);
  el.tabIndex = 0;
  const img = document.createElement('img');
  img.src = url;
  img.alt = alt;
  img.draggable = false;
  const hint = document.createElement('div');
  hint.className = 'splash-hint';
  hint.textContent = 'Tap or press any key';
  el.append(img, hint);
  document.body.appendChild(el);
  document.body.dataset.splash = 'open';
  el.focus();

  return new Promise((resolve) => {
    const events = ['keydown', 'pointerdown', 'touchend'] as const;
    const swallow = (e: Event) => {
      // Capture on window runs before Phaser's keyboard and pointer
      // listeners; the audio unlock was registered earlier and still runs.
      e.stopImmediatePropagation();
      if (e.type === 'touchend') e.preventDefault();
    };
    const close = (e: Event) => {
      swallow(e);
      if (e.type === 'keydown' && (e as KeyboardEvent).repeat) return;
      for (const t of events) window.removeEventListener(t, close, true);
      // Swallow the rest of this gesture (keyup, click) too.
      const tail = ['keyup', 'pointerup', 'click'] as const;
      for (const t of tail) window.addEventListener(t, swallow, true);
      setTimeout(() => {
        for (const t of tail) window.removeEventListener(t, swallow, true);
      }, 300);
      el.classList.add('closing');
      setTimeout(
        () => {
          el.remove();
          document.body.dataset.splash = 'done';
          resolve();
        },
        still ? 0 : 450,
      );
    };
    for (const t of events) window.addEventListener(t, close, { capture: true, passive: false });
  });
}
