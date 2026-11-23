import { createMetrics, type Metrics } from './metrics.js';

/** Todas as métricas do app, com suas tags (labels). */
export function createAppMetrics(): Metrics {
  const m = createMetrics();
  m.define('compare_requests_total', 'counter', 'Comparações recebidas, por resultado (ok, bad_request, rate_limited, busy, error)');
  m.define('compare_items', 'histogram', 'Itens por lista de compras', [1, 2, 5, 10, 20]);
  m.define('compare_duration_seconds', 'histogram', 'Duração total de uma comparação', [2, 5, 10, 20, 45, 90, 180]);
  m.define('source_searches_total', 'counter', 'Buscas por mercado, por resultado (found, empty, erro, indisponivel)');
  m.define('source_search_duration_seconds', 'histogram', 'Duração da busca em cada mercado', [0.5, 1, 2, 5, 10, 20]);
  m.define('cache_events_total', 'counter', 'Acertos e erros do cache, por mercado (event=hit|miss)');
  m.define('page_views_total', 'counter', 'Visitas à página inicial');
  m.define('ui_events_total', 'counter', 'Ações na interface, por evento (copy_item, copy_store, print_*, tab_*, pick_store, example)');
  m.define('list_items_total', 'counter', 'Itens buscados, por resultado (found = com preço confiável, missing = sem)');
  m.define('savings_brl_total', 'counter', 'Economia estimada em R$: preço médio menos o mais barato, somado por produto');
  return m;
}
