import { describe, it, expect } from 'vitest';
import { parseShareHash, shareUrl, toShareBody } from './share.js';

const match = {
  title: 'Arroz', priceBRL: 10, equivalentBRL: 10, sizeAdjusted: false, score: 1, uncertain: false,
  unitPriceBRL: 2, unit: 'kg', url: 'https://a.com/x', chosenByUser: true, lixo: 1,
};
const data = {
  products: [{
    query: 'Arroz 5kg',
    stats: { cheapest: { source: 'A', priceBRL: 10 } },
    sources: [
      { source: 'A', status: 'ok', reason: 'x', match, alternatives: [match], suggested: match },
      { source: 'B', status: 'erro', reason: 'falhou' },
    ],
  }],
  basket: {},
};

describe('toShareBody', () => {
  it('envia consulta, mercado, status e o item com o que a tela mostra', () => {
    const body = toShareBody(data);
    expect(body.products[0]!.query).toBe('Arroz 5kg');
    expect(body.products[0]!.sources[0]).toEqual({
      source: 'A', status: 'ok',
      match: { title: 'Arroz', priceBRL: 10, equivalentBRL: 10, sizeAdjusted: false, score: 1, uncertain: false, unitPriceBRL: 2, unit: 'kg', url: 'https://a.com/x', chosenByUser: true },
    });
    expect(body.products[0]!.sources[1]).toEqual({ source: 'B', status: 'erro' });
    expect(Object.keys(body.products[0]!)).toEqual(['query', 'sources']);
  });
});

describe('shareUrl / parseShareHash', () => {
  it('monta e lê o mesmo id', () => {
    const url = shareUrl('https://cestimo.butland.sbs', 'AbC_123-xyz0');
    expect(url).toBe('https://cestimo.butland.sbs/#r=AbC_123-xyz0');
    expect(parseShareHash(new URL(url).hash)).toBe('AbC_123-xyz0');
  });
  it.each(['', '#', '#r=', '#r=curto', '#x=AbC_123-xyz0', '#r=../../etc/passwd', '#r=AbC_123-xyz0&a=1', '#r=' + 'a'.repeat(80)])(
    'hash %j não é um link válido',
    (hash) => expect(parseShareHash(hash)).toBeNull(),
  );
});
