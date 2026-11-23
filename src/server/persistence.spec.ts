import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDailyStats } from './dailyStats.js';
import { createMetrics, createTopList } from './metrics.js';
import { createStateFile } from './persistence.js';

describe('createMetrics: snapshot e restore', () => {
  const build = () => {
    const m = createMetrics();
    m.define('c_total', 'counter', 'c');
    m.define('d_seconds', 'histogram', 'd', [1, 5]);
    return m;
  };
  it('restaura contadores e histogramas e continua somando', () => {
    const a = build();
    a.inc('c_total', { source: 'A' }, 3);
    a.observe('d_seconds', 2, { source: 'A' });
    const b = build();
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    b.inc('c_total', { source: 'A' });
    b.observe('d_seconds', 4, { source: 'A' });
    expect(b.counterSummary('c_total')).toEqual([{ labels: { source: 'A' }, value: 4 }]);
    expect(b.histogramSummary('d_seconds')).toEqual([{ labels: { source: 'A' }, count: 2, sum: 6, avg: 3 }]);
    expect(b.render()).toContain('d_seconds_bucket{le="5",source="A"} 2');
  });
  it('ignora métricas que não existem mais e dados malformados', () => {
    const b = build();
    expect(() => b.restore({ counters: { velha_total: [{ labels: {}, value: 9 }] }, hists: { d_seconds: [{ labels: {}, counts: [1], sum: 1, count: 1 }] } })).not.toThrow();
    expect(b.counterSummary('velha_total')).toEqual([]);
    expect(b.histogramSummary('d_seconds')).toEqual([]);
    expect(() => b.restore(null)).not.toThrow();
    expect(() => b.restore('lixo')).not.toThrow();
  });
});

describe('createTopList: snapshot e restore', () => {
  it('restaura o ranking', () => {
    const a = createTopList(10);
    ['ovos', 'ovos', 'leite'].forEach((q) => a.record(q));
    const b = createTopList(10);
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    b.record('leite'); b.record('leite');
    expect(b.top(2)).toEqual([{ term: 'leite', count: 3 }, { term: 'ovos', count: 2 }]);
  });
  it('dados malformados são ignorados', () => {
    const t = createTopList(10);
    expect(() => t.restore([['x'], 'y', null, ['ok', 2, 0]])).not.toThrow();
    expect(t.top(5)).toEqual([{ term: 'ok', count: 2 }]);
  });
});

describe('createDailyStats', () => {
  const day = (iso: string) => Date.parse(`${iso}T15:00:00Z`);
  it('soma eventos no dia corrente (fuso de Brasília por padrão)', () => {
    let t = day('2026-11-23');
    const d = createDailyStats({ now: () => t });
    d.add('compare'); d.add('compare'); d.add('items', 5);
    t = day('2026-11-24');
    d.add('compare');
    const series = d.series(2);
    expect(series).toEqual([
      { date: '2026-11-23', values: { compare: 2, items: 5 } },
      { date: '2026-11-24', values: { compare: 1 } },
    ]);
  });
  it('o dia vira conforme o fuso configurado', () => {
    const t = Date.parse('2026-11-24T01:30:00Z');
    expect(createDailyStats({ now: () => t, utcOffsetMinutes: -180 }).series(1)[0]!.date).toBe('2026-11-23');
    expect(createDailyStats({ now: () => t, utcOffsetMinutes: 0 }).series(1)[0]!.date).toBe('2026-11-24');
  });
  it('series inclui dias sem eventos como vazios', () => {
    let t = day('2026-11-20');
    const d = createDailyStats({ now: () => t });
    d.add('compare');
    t = day('2026-11-23');
    expect(d.series(4).map((s) => s.date)).toEqual(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']);
    expect(d.series(4)[1]!.values).toEqual({});
  });
  it('guarda só os últimos N dias', () => {
    let t = day('2026-01-01');
    const d = createDailyStats({ now: () => t, keepDays: 3 });
    for (let i = 0; i < 6; i++) { d.add('compare'); t += 86_400_000; }
    expect(Object.keys(d.snapshot())).toHaveLength(3);
  });
  it('snapshot e restore preservam os dias', () => {
    const t = day('2026-11-23');
    const a = createDailyStats({ now: () => t });
    a.add('copy', 4);
    const b = createDailyStats({ now: () => t });
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    b.add('copy');
    expect(b.series(1)[0]!.values).toEqual({ copy: 5 });
  });
  it('total soma um evento em todos os dias', () => {
    let t = day('2026-11-22');
    const d = createDailyStats({ now: () => t });
    d.add('copy', 2); t = day('2026-11-23'); d.add('copy', 3);
    expect(d.total('copy')).toBe(5);
  });
});

describe('createStateFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-'));
  it('salva e carrega o estado', () => {
    const f = createStateFile(join(dir, 'a', 'state.json'));
    f.save({ x: 1 });
    expect(f.load()).toEqual({ x: 1 });
  });
  it('arquivo inexistente ou corrompido retorna null', () => {
    expect(createStateFile(join(dir, 'nao-existe.json')).load()).toBeNull();
    const bad = join(dir, 'ruim.json');
    writeFileSync(bad, '{ não é json');
    expect(createStateFile(bad).load()).toBeNull();
  });
  it('grava de forma atômica (sem arquivo temporário sobrando)', () => {
    const p = join(dir, 'atomic.json');
    createStateFile(p).save({ ok: true });
    expect(existsSync(`${p}.tmp`)).toBe(false);
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ ok: true });
  });
  it('erro ao gravar não derruba o app', () => {
    const f = createStateFile('/proc/nao-pode-gravar/state.json');
    expect(() => f.save({ x: 1 })).not.toThrow();
  });
});
