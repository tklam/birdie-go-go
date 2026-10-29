import { describe, expect, it } from 'vitest';
import type { AreaWeather, Hazard, WeatherDay } from '../core/types.gen';
import { closureReason, closures, hazardForecast, warningAnnouncement, warningTag, warningsAt } from './warnings';

const day = { day: 1, areas: [], forecast: [], typhoonSignal: [0, 8, 3], rainstorm: ['amber', '', 'black'] } as WeatherDay;

describe('warnings', () => {
  it('reads the slot and decides closures', () => {
    expect(warningsAt(day, 'morning')).toEqual({ signal: 0, rainstorm: 'amber' });
    expect(closures(warningsAt(day, 'morning'))).toBe(false);
    expect(closures(warningsAt(day, 'afternoon'))).toBe(true);
    expect(closureReason(warningsAt(day, 'evening'))).toBe('Black rainstorm warning');
    expect(warningsAt(null, 'evening')).toEqual({ signal: 0, rainstorm: '' });
  });

  it('labels warnings', () => {
    expect(warningTag({ signal: 3, rainstorm: 'red' })).toBe('T3 Red rain');
    expect(warningTag({ signal: 0, rainstorm: '' })).toBe('');
    expect(warningAnnouncement({ signal: 8, rainstorm: '' })).toBe('Typhoon signal No. 8! Ferries, birding spots and lessons are off.');
    expect(warningAnnouncement({ signal: 0, rainstorm: 'amber' })).toBe('Amber rainstorm warning!');
  });

  it('forecasts hazards per area for the afternoon', () => {
    const uv = { id: 'high_uv', name: 'High UV', when: { param: 'uv', min: 8 } } as Hazard;
    const slot = (u: number) => ({ cloud: 0, precip: 0, temp: 25, fog: 0, wind: 0, windDir: 0, uv: u });
    const f = (area: string, u: number) => ({ area, slots: [slot(0), slot(u), slot(0)], named: ['', '', ''] }) as AreaWeather;
    expect(hazardForecast([uv], [f('a', 9), f('b', 3)], (id) => id.toUpperCase())).toEqual(['High UV warning: A.']);
  });
});
