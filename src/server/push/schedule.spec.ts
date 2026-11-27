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

describe('dueToday com janela (rotina pesada só de madrugada)', () => {
  const base = { utcOffsetMinutes: -180, hour: 3, windowHours: 4, lastRunDay: null as string | null };
  it('dentro da janela (3h às 7h, Brasília) roda', () => {
    expect(dueToday({ ...base, now: at('2026-11-26T06:30:00Z') }).due).toBe(true); // 03:30
    expect(dueToday({ ...base, now: at('2026-11-26T09:59:00Z') }).due).toBe(true); // 06:59
  });
  it('depois da janela não roda, mesmo sem ter rodado hoje (reiniciar à tarde não dispara a coleta)', () => {
    expect(dueToday({ ...base, now: at('2026-11-26T10:00:00Z') }).due).toBe(false); // 07:00
    expect(dueToday({ ...base, now: at('2026-11-26T22:50:00Z') }).due).toBe(false); // 19:50
  });
  it('antes da janela não roda', () => {
    expect(dueToday({ ...base, now: at('2026-11-26T05:59:00Z') }).due).toBe(false); // 02:59
  });
  it('já rodou hoje: não repete dentro da janela', () => {
    expect(dueToday({ ...base, now: at('2026-11-26T07:00:00Z'), lastRunDay: '2026-11-26' }).due).toBe(false);
  });
  it('sem janela, o comportamento antigo continua (qualquer hora depois da marcada)', () => {
    expect(dueToday({ now: at('2026-11-26T22:50:00Z'), utcOffsetMinutes: -180, hour: 3, lastRunDay: null }).due).toBe(true);
  });
});
