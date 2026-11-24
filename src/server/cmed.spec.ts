import { describe, it, expect } from 'vitest';
import { createCmedIndex, findCeiling, parsePresentation, pharmacyMatchContext, type CmedRow } from './cmed.js';

const row = (s: string, p: string, a: string, pmc: number | null, t = 'Genérico'): CmedRow => ({ s, p, a, t, pmc });

const ROWS: CmedRow[] = [
  row('DIPIRONA MONOIDRATADA', 'NOVALGINA', '500 MG COM CT BL AL PLAS TRANS X 10', 17.12, 'Referência'),
  row('DIPIRONA MONOIDRATADA', 'DIPIRONA MONOIDRATADA', '500 MG COM CT BL AL PLAS TRANS X 10', 6.8),
  row('DIPIRONA MONOIDRATADA', 'DIPIRONA MONOIDRATADA', '500 MG COM CT BL AL PLAS TRANS X 20', 11.4),
  row('DIPIRONA MONOIDRATADA', 'DIPIRONA MONOIDRATADA', '1 G COM CT BL AL PLAS TRANS X 10', 12.5),
  row('DIPIRONA MONOIDRATADA', 'DIPIRONA MONOIDRATADA', '500 MG/ML SOL OR GTS CT FR GOT PLAS OPC X 10 ML', 4.2),
  row('DIPIRONA MONOIDRATADA;CITRATO DE ORFENADRINA;CAFEÍNA', 'DORFLEX', '300 MG + 35 MG + 50 MG COM CT BL AL PLAS INC X 36', 23.5, 'Referência'),
  row('PARACETAMOL', 'TYLENOL', '750 MG COM REV CT BL AL PLAS TRANS X 20', 22.1, 'Referência'),
  row('PARACETAMOL', 'PARACETAMOL', '750 MG COM REV CT BL AL PLAS TRANS X 20', 9.6),
  row('OMEPRAZOL', 'OMEPRAZOL', '20 MG CAP GEL DURA LIB RETARD CT BL AL AL X 28', 15.3),
  row('ÁCIDO ASCÓRBICO', 'REDOXON', '1 G COM EFERV CT TB PLAS TRANS X 30', 31.9, 'Referência'),
  row('DIPIRONA MONOIDRATADA', 'DUZOR', '500 MG COM CT BL AL PLAS TRANS X 10 (EMB MULT)', 99.9),
  row('DIPIRONA MONOIDRATADA', 'DIPIMED', '500 MG COM CT BL AL PLAS TRANS X 10 (EMB FRAC)', 88.8),
  row('DIPIRONA MONOIDRATADA', 'MAXALGINA', '500 MG COM CT DISP 10 BL AL PLAS TRANS X 10', 92.9),
  row('OMEPRAZOL', 'OMEPRAZOL', '20 MG CAP DURA CT 50 FR PLAS OPC X 28', 1309.4),
  row('DIPIRONA MONOIDRATADA', 'DIPIDOR', '500 MG COM CX BL AL PLAS TRANS X 10', 80),
  row('OMEPRAZOL;AMOXICILINA;CLARITROMICINA', 'KIT H', '20 MG CAP CT BL X 28', 999),
  row('PARACETAMOL', 'SEM PREÇO', '500 MG COM CT BL AL PLAS TRANS X 20', null),
];
const index = createCmedIndex(ROWS);

describe('parsePresentation', () => {
  it('lê dosagem, quantidade e forma da apresentação oficial', () => {
    expect(parsePresentation('500 MG COM CT BL AL PLAS TRANS X 10')).toEqual({ strengths: ['500mg'], count: 10, form: 'comprimido' });
    expect(parsePresentation('20 MG CAP GEL DURA LIB RETARD CT BL AL AL X 28')).toEqual({ strengths: ['20mg'], count: 28, form: 'capsula' });
  });
  it('1 G vira 1000mg (a mesma dosagem escrita de outro jeito)', () => {
    expect(parsePresentation('1 G COM CT BL AL PLAS TRANS X 10').strengths).toEqual(['1000mg']);
  });
  it('várias dosagens (associações) e vírgula decimal', () => {
    expect(parsePresentation('300 MG + 35 MG + 50 MG COM CT BL X 36').strengths).toEqual(['300mg', '35mg', '50mg']);
    expect(parsePresentation('0,5 MG COM CT BL X 30').strengths).toEqual(['0.5mg']);
  });
  it('gotas e líquidos: a quantidade ("X 10 ML") não é contagem de comprimidos', () => {
    const p = parsePresentation('500 MG/ML SOL OR GTS CT FR GOT PLAS OPC X 10 ML');
    expect(p.form).toBe('gotas');
    expect(p.count).toBeNull();
  });
  it('sem quantidade reconhecível, count é null', () => {
    expect(parsePresentation('SOL INJ CT 1 FA').count).toBeNull();
  });
});

describe('findCeiling (preço máximo ao consumidor, CMED)', () => {
  it('mesma substância, dosagem, quantidade e forma: o teto dos genéricos (que é o que interessa a quem compra o mais barato)', () => {
    expect(findCeiling(index, 'Dipirona 500mg 10 comprimidos')).toEqual({ minBRL: 6.8, maxBRL: 6.8, n: 1, generic: true });
  });
  it('dosagem diferente (1g) acha só a apresentação de 1g', () => {
    expect(findCeiling(index, 'Dipirona 1g 10 comprimidos')).toEqual({ minBRL: 12.5, maxBRL: 12.5, n: 1, generic: true });
  });
  it('quantidade diferente (20) acha só a de 20', () => {
    expect(findCeiling(index, 'Dipirona 500mg 20 comprimidos')).toEqual({ minBRL: 11.4, maxBRL: 11.4, n: 1, generic: true });
  });
  it('acha pelo nome comercial (Dorflex) mesmo sem citar a substância', () => {
    expect(findCeiling(index, 'Dorflex 36 comprimidos')).toEqual({ minBRL: 23.5, maxBRL: 23.5, n: 1, generic: false });
  });
  it('ignora acento, caixa e a forma escrita no plural', () => {
    expect(findCeiling(index, 'OMEPRAZOL 20MG 28 CÁPSULAS')).toEqual({ minBRL: 15.3, maxBRL: 15.3, n: 1, generic: true });
  });
  it('forma pedida filtra: "gotas" não traz comprimido', () => {
    expect(findCeiling(index, 'Dipirona 500mg gotas')).toEqual({ minBRL: 4.2, maxBRL: 4.2, n: 1, generic: true });
  });
  it('1g da consulta casa com 1 G da lista, e "Vitamina C" casa com ácido ascórbico não (sem o nome) mas Redoxon sim', () => {
    expect(findCeiling(index, 'Redoxon 1g 30 comprimidos')).toEqual({ minBRL: 31.9, maxBRL: 31.9, n: 1, generic: false });
  });
  it('consulta vaga (sem dosagem nem quantidade) não mostra teto: a faixa seria enganosa', () => {
    expect(findCeiling(index, 'Dipirona')).toBeNull();
    expect(findCeiling(index, 'Dipirona comprimidos')).toBeNull();
  });
  it('produto que não é remédio ou não está na lista = null', () => {
    expect(findCeiling(index, 'Fralda Pampers M')).toBeNull();
    expect(findCeiling(index, 'Protetor solar FPS 50')).toBeNull();
    expect(findCeiling(index, 'Ibuprofeno 600mg 20 comprimidos')).toBeNull();
  });
  it('linha sem preço (medicamento sem PMC) não entra na faixa', () => {
    expect(findCeiling(index, 'Paracetamol 500mg 20 comprimidos')).toBeNull();
    expect(findCeiling(index, 'Paracetamol 750mg 20 comprimidos')).toEqual({ minBRL: 9.6, maxBRL: 9.6, n: 1, generic: true });
  });
  it('todas as palavras do nome precisam estar presentes (Dipirona Dorflex não casa só com Dipirona)', () => {
    expect(findCeiling(index, 'Dipirona Tylenol 500mg 10 comprimidos')).toBeNull();
  });
  it('consulta vazia ou só números = null, sem quebrar', () => {
    for (const q of ['', '   ', '500mg 10 comprimidos']) expect(findCeiling(index, q)).toBeNull();
  });
});

describe('findCeiling: só embalagem de varejo e a substância pedida', () => {
  it('embalagem hospitalar/múltipla/fracionável ("EMB MULT", "EMB FRAC") não entra: não é o que a farmácia vende', () => {
    expect(findCeiling(index, 'Dipirona 500mg 10 comprimidos')).toEqual({ minBRL: 6.8, maxBRL: 6.8, n: 1, generic: true });
  });
  it('associação de substâncias (kit com omeprazol) não entra quando se pede só o omeprazol', () => {
    expect(findCeiling(index, 'Omeprazol 20mg 28 cápsulas')).toEqual({ minBRL: 15.3, maxBRL: 15.3, n: 1, generic: true });
  });
  it('mas a associação entra quando o pedido é pelo nome do produto (Dorflex é dipirona + orfenadrina + cafeína)', () => {
    expect(findCeiling(index, 'Dorflex 36 comprimidos')?.n).toBe(1);
  });
});

describe('findCeiling: caixa com várias cartelas ou frascos é embalagem de clínica', () => {
  it('"CT 50 FR", "CT DISP 10 BL" e "CX" (caixa) não entram; "CT BL" e "CT FR" (um só) entram', () => {
    expect(findCeiling(index, 'Dipirona 500mg 10 comprimidos')).toEqual({ minBRL: 6.8, maxBRL: 6.8, n: 1, generic: true });
    expect(findCeiling(index, 'Omeprazol 20mg 28 cápsulas')).toEqual({ minBRL: 15.3, maxBRL: 15.3, n: 1, generic: true });
  });
});

describe('findCeiling: genérico x marca', () => {
  it('sem genérico na lista (só a marca), mostra a faixa de todas as apresentações e avisa que não é de genérico', () => {
    expect(findCeiling(index, 'Redoxon 1g 30 comprimidos')?.generic).toBe(false);
  });
  it('com genérico e marca, a faixa é só dos genéricos (a marca é bem mais cara e esconderia o número)', () => {
    const idx = createCmedIndex([
      row('LOSARTANA', 'LOSARTANA', '50 MG COM CT BL X 30', 16.4),
      row('LOSARTANA', 'LOSARTANA', '50 MG COM CT BL X 30', 21),
      row('LOSARTANA', 'COZAAR', '50 MG COM CT BL X 30', 47.9, 'Referência'),
    ]);
    expect(findCeiling(idx, 'Losartana 50mg 30 comprimidos')).toEqual({ minBRL: 16.4, maxBRL: 21, n: 2, generic: true });
  });
});

describe('pharmacyMatchContext (remédio pelo princípio ativo: marca e laboratório não pesam)', () => {
  const ctxOf = pharmacyMatchContext(index);

  it('pedido só com o princípio ativo, dosagem e quantidade tem contexto', () => {
    expect(ctxOf('Dipirona 500mg 10 comprimidos')).toBeDefined();
    expect(ctxOf('Paracetamol 750mg 20 comprimidos')).toBeDefined();
    expect(ctxOf('omeprazol 20mg')).toBeDefined();
  });
  it('pedido com marca, ou que não é remédio da lista, não tem contexto (nada muda)', () => {
    expect(ctxOf('Novalgina 500mg 10 comprimidos')).toBeUndefined();
    expect(ctxOf('Dorflex 36 comprimidos')).toBeUndefined();
    expect(ctxOf('Fralda Pampers M')).toBeUndefined();
    expect(ctxOf('Protetor solar FPS 50')).toBeUndefined();
    expect(ctxOf('500mg 10 comprimidos')).toBeUndefined();
  });
  it('marca e laboratório são ignoráveis; substâncias e formas, não', () => {
    const { ignorable } = ctxOf('Dipirona 500mg 10 comprimidos')!;
    for (const marca of ['novalgina', 'ems', 'prati', 'generico', 'medley']) expect(ignorable!(marca)).toBe(true);
    for (const outra of ['dipirona', 'orfenadrina', 'cafeina', 'gotas', 'xarope', 'solucao', 'gel']) expect(ignorable!(outra)).toBe(false);
  });
  it('o sal da própria substância (dipirona monoidratada/sódica) não pesa contra: é o mesmo remédio', () => {
    const { ignorable } = ctxOf('Dipirona 500mg 10 comprimidos')!;
    expect(ignorable!('monoidratada')).toBe(true);
    // mas "monoidratada" não vira desculpa para associação: a outra substância continua pesando
    expect(ignorable!('orfenadrina')).toBe(false);
  });
});
