import { describe, it, expect } from 'vitest';
import { graphqlErrorMessage, parseMercafacilCards } from './mercafacil.js';

const card = (text: string, href = '/avenida/produto/m/arroz-branco-peruchi-5kg-144280') => ({ href, text });

describe('parseMercafacilCards', () => {
  it('extrai título e preço do texto do card', () => {
    const [o] = parseMercafacilCards([card('+3+5+10AddArroz Branco Peruchi 5kgR$ 19,99 /un')], 'Brasão', 'https://www.brasao.com.br');
    expect(o).toMatchObject({ source: 'Brasão', title: 'Arroz Branco Peruchi 5kg', priceBRL: 19.99 });
    expect(o).not.toHaveProperty('url');
  });
  it('ignora o peso "5.0 kg" depois do preço e mantém o primeiro preço (atual)', () => {
    const [o] = parseMercafacilCards([card('+3+5+10AddArroz Branco Panelaço 5kgR$ 19,99 /un5.0 kg')], 'B', 'https://x');
    expect(o).toMatchObject({ title: 'Arroz Branco Panelaço 5kg', priceBRL: 19.99 });
  });
  it('com desconto, usa o preço atual e não o "de"', () => {
    const [o] = parseMercafacilCards([card('+3+5+10AddInseticida Raid 420mlR$ 19,99 /un- 17%R$ 23,99')], 'B', 'https://x');
    expect(o!.priceBRL).toBe(19.99);
  });
  it('remove o prefixo "Clube" do título (Unicooper)', () => {
    const [o] = parseMercafacilCards([card('Clube+3+5+10AddARROZ PARBOILIZADO SAFRA 5KGR$ 17,99 /un')], 'U', 'https://x');
    expect(o!.title).toBe('ARROZ PARBOILIZADO SAFRA 5KG');
  });
  it('preço com milhar', () => {
    const [o] = parseMercafacilCards([card('AddTV 50 polegadasR$ 1.299,90 /un')], 'B', 'https://x');
    expect(o!.priceBRL).toBe(1299.9);
  });
  it('descarta card sem preço ou sem título', () => {
    expect(parseMercafacilCards([card('Indisponível'), card('R$ 5,00')], 'B', 'https://x')).toEqual([]);
  });
});

describe('graphqlErrorMessage (site com backend fora do ar)', () => {
  it('devolve a mensagem do primeiro erro da API', () => {
    expect(graphqlErrorMessage({ data: null, errors: [{ message: 'Request failed with status code 503' }] })).toBe(
      'Request failed with status code 503',
    );
  });
  it('resposta normal não tem erro', () => {
    expect(graphqlErrorMessage({ data: { ecommerceProducts: { products: [] } } })).toBeNull();
  });
  it('payloads inesperados não geram erro', () => {
    expect(graphqlErrorMessage(null)).toBeNull();
    expect(graphqlErrorMessage('x')).toBeNull();
    expect(graphqlErrorMessage({ errors: [] })).toBeNull();
    expect(graphqlErrorMessage({ errors: [{}] })).toBeNull();
  });
});

