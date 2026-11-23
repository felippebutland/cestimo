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
  return m;
}
