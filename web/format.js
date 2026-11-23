const nbspToSpace = (s) => s.replace(/ /g, ' ');

export const formatBRL = (n) => nbspToSpace(n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

export const formatPct = (n) => `${n.toFixed(1).replace('.', ',')}%`;
