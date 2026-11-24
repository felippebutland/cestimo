import { describe, it, expect } from 'vitest';
import { WELCOME_KEY, shouldWelcome, sourcesSummary } from './welcome.js';

describe('shouldWelcome', () => {
  it('mostra na primeira visita e some depois de dispensar', () => {
    expect(shouldWelcome(null)).toBe(true);
    expect(shouldWelcome('')).toBe(true);
    expect(shouldWelcome('1')).toBe(false);
  });
  it('chave de armazenamento estável', () => {
    expect(WELCOME_KEY).toBe('cestimo:bemvindo');
  });
});

describe('sourcesSummary', () => {
  it('uma linha por categoria com as lojas', () => {
    expect(sourcesSummary([{ label: 'Mercados', sources: ['Comper', 'Royal'] }, { label: 'Farmácias', sources: ['São João'] }])).toEqual([
      { label: 'Mercados', names: 'Comper, Royal' },
      { label: 'Farmácias', names: 'São João' },
    ]);
  });
  it('ignora categoria sem lojas', () => {
    expect(sourcesSummary([{ label: 'Mercados', sources: [] }])).toEqual([]);
  });
});
