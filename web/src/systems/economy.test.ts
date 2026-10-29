import { describe, expect, it } from 'vitest';
import type { Bill, EnergyRules } from '../core/types.gen';
import { activityCost, billsDue, crossedLow, payBills, walkCost } from './economy';

const bills: Bill[] = [
  { name: 'Electricity', amount: 12, everyDays: 1 },
  { name: 'Rent', amount: 150, everyDays: 7 },
];
const rules: EnergyRules = {
  walkPerMin: 0.05,
  indoorRecoveryPerMin: 0.1,
  photoSession: 12,
  lesson: 10,
  lowWarning: 25,
  lowWarningText: 'Hungry',
  tooTiredText: 'Tired',
};

describe('bills', () => {
  it('are due on their days', () => {
    expect(billsDue(bills, 2).map((b) => b.name)).toEqual(['Electricity']);
    expect(billsDue(bills, 14).map((b) => b.name)).toEqual(['Electricity', 'Rent']);
    expect(billsDue(undefined, 7)).toEqual([]);
  });

  it('never take money below zero', () => {
    const s = { money: 100 };
    expect(payBills(s, bills)).toEqual({ total: 162, unpaid: 62 });
    expect(s.money).toBe(0);
    const rich = { money: 500 };
    expect(payBills(rich, bills)).toEqual({ total: 162, unpaid: 0 });
    expect(rich.money).toBe(338);
  });
});

describe('energy rules', () => {
  it('cost activities and walking, scaled by area effort', () => {
    expect(activityCost(rules, 'photo')).toBe(12);
    expect(activityCost(undefined, 'lesson')).toBe(0);
    expect(walkCost(rules, undefined, 60)).toBeCloseTo(3);
    expect(walkCost(rules, { walkEffort: 2.5 }, 60)).toBeCloseTo(7.5);
    expect(walkCost(undefined, { walkEffort: 2 }, 60)).toBe(0);
  });

  it('warns once when Energy drops below the low level', () => {
    expect(crossedLow(rules, 26, 24)).toBe(true);
    expect(crossedLow(rules, 24, 23)).toBe(false);
    expect(crossedLow(undefined, 26, 0)).toBe(false);
  });
});
