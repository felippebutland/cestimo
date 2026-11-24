import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { rankSources, rankTotals } from './mobileOrder.js';

const ok = (price: number, uncertain = false) => ({ status: 'ok', match: { equivalentBRL: price, uncertain } });
const none = (status = 'ok') => ({ status, match: null });

describe('rankSources (ordem dos mercados no cartão do celular)', () => {
  it('mais barato primeiro; devolve a posição de cada mercado na ordem original', () => {
    expect(rankSources([ok(10), ok(8), ok(9)])).toEqual([2, 0, 1]);
  });
  it('itens incertos ficam depois dos confiáveis, mesmo sendo mais baratos', () => {
    expect(rankSources([ok(5, true), ok(9), ok(7)])).toEqual([2, 1, 0]);
  });
  it('sem resultado, erro e indisponível vão por último, na ordem original', () => {
    expect(rankSources([none(), ok(9), none('erro'), ok(7)])).toEqual([2, 1, 3, 0]);
  });
  it('empate de preço mantém a ordem original dos mercados', () => {
    expect(rankSources([ok(5), ok(5), ok(5)])).toEqual([0, 1, 2]);
  });
  it('lista vazia', () => {
    expect(rankSources([])).toEqual([]);
  });
});

describe('rankTotals (ordem dos mercados no total da cesta, no celular)', () => {
  it('o mercado destacado vem primeiro e os demais do menor para o maior total', () => {
    expect(rankTotals(['A', 'B', 'C', 'D'], { A: 120, B: 90, C: 100, D: 80 }, 'B')).toEqual([3, 0, 2, 1]);
  });
  it('mercado sem total (nenhum item com preço) vai por último', () => {
    expect(rankTotals(['A', 'B', 'C'], { B: 50 }, 'B')).toEqual([1, 0, 2]);
  });
  it('sem destaque, só ordena por total', () => {
    expect(rankTotals(['A', 'B'], { A: 20, B: 10 }, undefined)).toEqual([1, 0]);
  });
});

describe('layout do celular (guarda contra regressão)', () => {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  it('em telas estreitas a tabela vira cartões: some o cabeçalho e cada mercado mostra o próprio nome', () => {
    expect(html).toMatch(/@media \(max-width: 899px\)[\s\S]*thead \{ display: none; \}/);
    expect(html).toContain('content: attr(data-label)');
  });
  it('as células recebem o nome do mercado e a posição (data-label e --o)', () => {
    expect(app).toContain('td.dataset.label = label');
    expect(app).toContain("td.style.setProperty('--o'");
  });
  it('campo de texto com 16px no celular (abaixo disso o iPhone dá zoom ao digitar)', () => {
    expect(html).toMatch(/max-width: 600px\)[\s\S]*textarea \{ font-size: 16px/);
  });
  it('seletores de mercado empilham no celular e ocupam a largura toda (texto longo não alarga a página)', () => {
    expect(html).toMatch(/max-width: 600px\)[\s\S]*\.picker, \.filter \{ flex-direction: column/);
    expect(html).toMatch(/\.picker \.select, \.filter \.select \{ width: 100%; \}/);
  });
});
