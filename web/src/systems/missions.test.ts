import { describe, expect, it } from 'vitest';
import type { ContentBundle, Mission } from '../core/types.gen';
import { activeMissions, completeMission, doneFlag, lessonMissionsMet, photoMissionsMet, reminderMission, startMission } from './missions';
import { newGame } from './state';

const egret: Mission = {
  id: 'egret_cover',
  giver: 'editor',
  title: 'Cover Star',
  description: '',
  objective: { type: 'photograph', species: 'little_egret', minRating: 'great', area: 'tko_waterfront' },
  reward: { money: 400, items: ['sunscreen'] },
};
const recital: Mission = {
  id: 'mei_recital',
  giver: 'mei',
  title: 'Recital',
  description: '',
  objective: { type: 'lesson', student: 'mei', minScore: 70 },
  reward: { money: 300, items: [] },
};
const content = { missions: [egret, recital] };
const fresh = () => newGame({ game: { title: '', contentVersion: '0.0.0', startMap: 'world', startSpawn: 's' } } as ContentBundle, 1);

describe('missions', () => {
  it('reminders take turns among active missions', () => {
    const s = fresh();
    expect(reminderMission(s, content, 0)).toBeNull();
    startMission(s, 'egret_cover');
    startMission(s, 'mei_recital');
    expect([0, 1, 2].map((t) => reminderMission(s, content, t)?.id)).toEqual(['egret_cover', 'mei_recital', 'egret_cover']);
  });

  it('starts once and lists active missions', () => {
    const s = fresh();
    expect(startMission(s, 'egret_cover')).toBe(true);
    expect(startMission(s, 'egret_cover')).toBe(false);
    expect(activeMissions(s, content).map((m) => m.id)).toEqual(['egret_cover']);
  });

  it('photograph objectives need species, rating and area', () => {
    const s = fresh();
    startMission(s, 'egret_cover');
    const at = (rating: 'good' | 'great' | 'perfect', area = 'tko_waterfront', species = 'little_egret') => [{ species, rating, area }];
    expect(photoMissionsMet(s, content, at('good'))).toEqual([]);
    expect(photoMissionsMet(s, content, at('great', 'tko_town'))).toEqual([]);
    expect(photoMissionsMet(s, content, at('perfect', 'tko_waterfront', 'red_whiskered_bulbul'))).toEqual([]);
    expect(photoMissionsMet(s, content, at('perfect')).map((m) => m.id)).toEqual(['egret_cover']);
  });

  it('lesson objectives need the student and a score', () => {
    const s = fresh();
    startMission(s, 'mei_recital');
    expect(lessonMissionsMet(s, content, 'mei', 69)).toEqual([]);
    expect(lessonMissionsMet(s, content, 'ann', 99)).toEqual([]);
    expect(lessonMissionsMet(s, content, 'mei', 70).map((m) => m.id)).toEqual(['mei_recital']);
  });

  it('completing pays out, sets the done flag and cannot be restarted', () => {
    const s = fresh();
    startMission(s, 'egret_cover');
    const money = s.money;
    completeMission(s, egret);
    expect(s.money).toBe(money + 400);
    expect(s.items.sunscreen).toBe(1);
    expect(s.flags[doneFlag('egret_cover')]).toBe(true);
    expect(activeMissions(s, content)).toEqual([]);
    expect(startMission(s, 'egret_cover')).toBe(false);
  });
});
