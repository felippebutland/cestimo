import { describe, it, expect } from 'vitest';
import { createMetrics, createTopList, normalizeQuery } from './metrics.js';

describe('createMetrics', () => {
  it('conta por tags (labels) e renderiza no formato Prometheus', () => {
    const m = createMetrics();
    m.define('source_searches_total', 'counter', 'Buscas por mercado');
    m.inc('source_searches_total', { source: 'Comper', status: 'ok' });
    m.inc('source_searches_total', { source: 'Comper', status: 'ok' });
    m.inc('source_searches_total', { source: 'Royal', status: 'erro' });
    const out = m.render();
    expect(out).toContain('# HELP source_searches_total Buscas por mercado');
    expect(out).toContain('# TYPE source_searches_total counter');
    expect(out).toContain('source_searches_total{source="Comper",status="ok"} 2');
    expect(out).toContain('source_searches_total{source="Royal",status="erro"} 1');
  });
  it('ordena os labels e escapa aspas e barras', () => {
    const m = createMetrics();
    m.define('x_total', 'counter', 'x');
    m.inc('x_total', { b: '2', a: 'diz "oi"\\' });
    expect(m.render()).toContain('x_total{a="diz \\"oi\\"\\\\",b="2"} 1');
  });
  it('contador sem tags', () => {
    const m = createMetrics();
    m.define('up_total', 'counter', 'x');
    m.inc('up_total', undefined, 3);
    expect(m.render()).toContain('up_total 3');
  });
  it('histograma gera buckets acumulados, soma e contagem', () => {
    const m = createMetrics();
    m.define('dur_seconds', 'histogram', 'duração', [0.5, 1, 5]);
    m.observe('dur_seconds', 0.3, { source: 'A' });
    m.observe('dur_seconds', 0.7, { source: 'A' });
    m.observe('dur_seconds', 9, { source: 'A' });
    const out = m.render();
    expect(out).toContain('dur_seconds_bucket{le="0.5",source="A"} 1');
    expect(out).toContain('dur_seconds_bucket{le="1",source="A"} 2');
    expect(out).toContain('dur_seconds_bucket{le="5",source="A"} 2');
    expect(out).toContain('dur_seconds_bucket{le="+Inf",source="A"} 3');
    expect(out).toContain('dur_seconds_sum{source="A"} 10');
    expect(out).toContain('dur_seconds_count{source="A"} 3');
  });
  it('métrica não definida é ignorada (não quebra o app)', () => {
    const m = createMetrics();
    expect(() => m.inc('nao_existe')).not.toThrow();
    expect(() => m.observe('nao_existe', 1)).not.toThrow();
  });
  it('resumo por tag: totais e média de tempo', () => {
    const m = createMetrics();
    m.define('dur_seconds', 'histogram', 'd', [1]);
    m.observe('dur_seconds', 1, { source: 'A' });
    m.observe('dur_seconds', 3, { source: 'A' });
    expect(m.histogramSummary('dur_seconds')).toEqual([{ labels: { source: 'A' }, count: 2, sum: 4, avg: 2 }]);
  });
  it('resumo de contador por tags', () => {
    const m = createMetrics();
    m.define('c_total', 'counter', 'c');
    m.inc('c_total', { source: 'A', status: 'ok' }, 2);
    expect(m.counterSummary('c_total')).toEqual([{ labels: { source: 'A', status: 'ok' }, value: 2 }]);
  });
});

describe('normalizeQuery', () => {
  it('minúsculas, sem espaços extras, limitado a 60 caracteres', () => {
    expect(normalizeQuery('  Arroz   TIO João 5KG ')).toBe('arroz tio joão 5kg');
    expect(normalizeQuery('x'.repeat(100))).toHaveLength(60);
  });
});

describe('createTopList', () => {
  it('ranking dos termos mais buscados', () => {
    const t = createTopList(10);
    ['ovos', 'leite', 'ovos', 'ovos', 'leite', 'café'].forEach((q) => t.record(q));
    expect(t.top(2)).toEqual([{ term: 'ovos', count: 3 }, { term: 'leite', count: 2 }]);
  });
  it('tem limite de tamanho e descarta o menos buscado', () => {
    const t = createTopList(2);
    ['a', 'a', 'b', 'b', 'c'].forEach((q) => t.record(q));
    expect(t.top(10).map((x) => x.term)).toEqual(['a', 'b']);
  });
  it('desempate por ordem de chegada', () => {
    const t = createTopList(5);
    ['x', 'y'].forEach((q) => t.record(q));
    expect(t.top(2).map((x) => x.term)).toEqual(['x', 'y']);
  });
});
