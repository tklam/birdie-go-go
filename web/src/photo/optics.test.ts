import { describe, expect, it } from 'vitest';
import { FOCUS_TIME_MS, SHUTTER_THRESHOLD, weatherOptics } from './optics';

const clear = { cloud: 0, precip: 0, temp: 25, fog: 0, wind: 0, windDir: 0, uv: 8 };

describe('weatherOptics', () => {
  it('uses the defaults without weather or in clear weather', () => {
    expect(weatherOptics(null)).toEqual({ focusTimeMs: FOCUS_TIME_MS, shutterThreshold: SHUTTER_THRESHOLD });
    expect(weatherOptics(clear)).toEqual({ focusTimeMs: FOCUS_TIME_MS, shutterThreshold: SHUTTER_THRESHOLD });
  });

  it('slows focus in cloud and fog and lowers sharpness in rain', () => {
    const murky = weatherOptics({ ...clear, cloud: 1, fog: 1, precip: 1 });
    expect(murky.focusTimeMs).toBe(Math.round(FOCUS_TIME_MS * 1.9));
    expect(murky.shutterThreshold).toBe(Math.round(SHUTTER_THRESHOLD * 0.6));
  });
});
