import { describe, it, expect } from 'vitest';
import { dueToday } from './schedule.js';

const at = (iso: string) => Date.parse(iso);

describe('dueToday', () => {
  it('roda na hora marcada (fuso de Brasília, -180) se ainda não rodou hoje', () => {
    expect(dueToday({ now: at('2026-11-24T11:05:00Z'), utcOffsetMinutes: -180, hour: 8, lastRunDay: '2026-11-23' })).toEqual({ due: true, day: '2026-11-24' });
  });
  it('depois da hora marcada também roda (o app ficou fora do ar na hora)', () => {
    expect(dueToday({ now: at('2026-11-24T20:00:00Z'), utcOffsetMinutes: -180, hour: 8, lastRunDay: null }).due).toBe(true);
  });
  it('antes da hora marcada não roda', () => {
    expect(dueToday({ now: at('2026-11-24T10:59:00Z'), utcOffsetMinutes: -180, hour: 8, lastRunDay: '2026-11-23' }).due).toBe(false);
  });
  it('já rodou hoje (mesmo depois de reiniciar): não repete', () => {
    expect(dueToday({ now: at('2026-11-24T15:00:00Z'), utcOffsetMinutes: -180, hour: 8, lastRunDay: '2026-11-24' }).due).toBe(false);
  });
  it('usa o dia local, não o UTC (01h UTC ainda é o dia anterior em Brasília)', () => {
    expect(dueToday({ now: at('2026-11-24T01:00:00Z'), utcOffsetMinutes: -180, hour: 0, lastRunDay: '2026-11-23' })).toEqual({ due: false, day: '2026-11-23' });
  });
});
