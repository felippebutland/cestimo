import { describe, it, expect } from 'vitest';
import { createAbuseGuard } from './abuseGuard.js';

const mk = (t = { now: 1_000_000 }) => ({ t, g: createAbuseGuard({ maxStrikes: 2, blockMs: 60_000, now: () => t.now }) });

describe('createAbuseGuard', () => {
  it('até 2 buscas inválidas só avisam; a 3ª bloqueia o IP', () => {
    const { g } = mk();
    expect(g.strike('1.1.1.1')).toEqual({ blocked: false, strikes: 1 });
    expect(g.strike('1.1.1.1')).toEqual({ blocked: false, strikes: 2 });
    expect(g.isBlocked('1.1.1.1')).toBe(0);
    const third = g.strike('1.1.1.1');
    expect(third.blocked).toBe(true);
    expect(g.isBlocked('1.1.1.1')).toBe(60_000);
  });
  it('cada IP tem a sua conta', () => {
    const { g } = mk();
    for (let i = 0; i < 3; i++) g.strike('1.1.1.1');
    expect(g.isBlocked('1.1.1.1')).toBeGreaterThan(0);
    expect(g.isBlocked('2.2.2.2')).toBe(0);
    expect(g.strike('2.2.2.2').blocked).toBe(false);
  });
  it('o bloqueio acaba depois do prazo, e a contagem recomeça do zero', () => {
    const { g, t } = mk();
    for (let i = 0; i < 3; i++) g.strike('1.1.1.1');
    t.now += 60_001;
    expect(g.isBlocked('1.1.1.1')).toBe(0);
    expect(g.strike('1.1.1.1')).toEqual({ blocked: false, strikes: 1 });
  });
  it('tentativas antigas (fora da janela) não contam', () => {
    const { g, t } = mk();
    g.strike('1.1.1.1');
    g.strike('1.1.1.1');
    t.now += 60_001;
    expect(g.strike('1.1.1.1')).toEqual({ blocked: false, strikes: 1 });
  });
  it('mostra quanto falta durante o bloqueio', () => {
    const { g, t } = mk();
    for (let i = 0; i < 3; i++) g.strike('1.1.1.1');
    t.now += 10_000;
    expect(g.isBlocked('1.1.1.1')).toBe(50_000);
  });
  it('não cresce sem limite: IPs antigos são esquecidos', () => {
    const { g, t } = mk();
    for (let i = 0; i < 50; i++) g.strike(`9.9.9.${i}`);
    t.now += 200_000;
    g.strike('1.1.1.1');
    expect(g.size()).toBe(1);
  });
});
