import type { GameState } from '../systems/state';
import { season } from '../systems/state';
import { overlay } from './overlay';

const SLOT = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' } as const;
const SEASON = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' } as const;

/** The overworld status window: day, time slot, season and money. */
export class Hud {
  private readonly el: HTMLDivElement;
  private last = '';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'window hud';
    overlay().appendChild(this.el);
  }

  update(state: GameState, weather = ''): void {
    const text = `Day ${state.day} ${SLOT[state.slot]} · ${SEASON[season(state.day)]}\n$${state.money}${weather ? `  ${weather}` : ''}`;
    if (text === this.last) return;
    this.last = text;
    this.el.textContent = text;
  }

  destroy(): void {
    this.el.remove();
  }
}
