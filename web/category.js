/** Categorias da comparação: supermercados e farmácias. Textos e chaves de armazenamento de cada uma. */

export const CATEGORY_TEXT = {
  mercados: {
    examples: ['Arroz Tio João 5kg', 'Feijão preto 1kg', 'Leite integral 1L', 'Ovos 30un', 'Café 500g'],
    placeholder: 'Arroz Tio João 5kg\nFeijão preto 1kg\nLeite integral 1L\nOvos 30un',
    hint: 'um produto por linha, com o tamanho (ex.: Ovos 30un, Arroz 5kg)',
    loading: 'Consultando os mercados…',
    filterLabel: 'Mercado',
    filterAll: 'Todos os mercados',
    tagline: 'Comparador de preços de supermercados',
  },
  farmacias: {
    examples: ['Dipirona 500mg 10 comprimidos', 'Paracetamol 750mg 20 comprimidos', 'Dorflex 36 comprimidos', 'Protetor solar FPS 50', 'Fralda Pampers M'],
    placeholder: 'Dipirona 500mg 10 comprimidos\nParacetamol 750mg 20 comprimidos\nProtetor solar FPS 50\nFralda Pampers M',
    hint: 'um produto por linha, com a dosagem e a quantidade (ex.: Dipirona 500mg 10 comprimidos)',
    loading: 'Consultando as farmácias…',
    filterLabel: 'Farmácia',
    filterAll: 'Todas as farmácias',
    tagline: 'Comparador de preços de farmácias',
  },
};

/** Mantém a categoria só se a configuração do servidor a oferece; senão, mercados. */
export const normalizeCategory = (raw, categories) => (categories.some((c) => c.id === raw) && raw in CATEGORY_TEXT ? raw : 'mercados');

/** Chave da última lista no navegador. Mercados mantém a chave antiga, para ninguém perder a lista salva. */
export const savedKey = (category) => (category === 'farmacias' ? 'cestimo:ultima:farmacias' : 'cestimo:ultima');

export const sourcesFor = (categories, id) => categories.find((c) => c.id === id)?.sources ?? [];
