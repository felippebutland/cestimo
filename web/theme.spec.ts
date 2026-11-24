import { describe, it, expect } from 'vitest';
import { nextTheme, normalizeTheme, resolveTheme, THEME_COLOR, THEME_KEY } from './theme.js';

describe('normalizeTheme', () => {
  it('aceita auto, claro e escuro', () => {
    for (const t of ['auto', 'claro', 'escuro']) expect(normalizeTheme(t)).toBe(t);
  });
  it('qualquer outro valor (ou nada salvo) vira auto', () => {
    for (const t of [null, undefined, '', 'dark', 'Claro', 42]) expect(normalizeTheme(t)).toBe('auto');
  });
});

describe('resolveTheme', () => {
  it('auto segue o sistema', () => {
    expect(resolveTheme('auto', true)).toBe('escuro');
    expect(resolveTheme('auto', false)).toBe('claro');
  });
  it('escolha do usuário vale mais que o sistema', () => {
    expect(resolveTheme('claro', true)).toBe('claro');
    expect(resolveTheme('escuro', false)).toBe('escuro');
  });
});

describe('constantes', () => {
  it('cor da barra do navegador por tema e chave de armazenamento', () => {
    expect(THEME_COLOR).toEqual({ claro: '#f6f7f8', escuro: '#0d0f12' });
    expect(THEME_KEY).toBe('cestimo:tema');
  });
});

describe('nextTheme', () => {
  it('alterna auto → claro → escuro → auto', () => {
    expect(nextTheme('auto')).toBe('claro');
    expect(nextTheme('claro')).toBe('escuro');
    expect(nextTheme('escuro')).toBe('auto');
  });
});
