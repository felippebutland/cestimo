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
  m.define('visits_by_client_total', 'counter', 'Visitas por dispositivo, sistema e navegador (categorias genéricas, sem robôs)');
  m.define('bot_visits_total', 'counter', 'Visitas de robôs (monitores, buscadores, scripts), fora das visitas humanas');
  m.define('ui_events_total', 'counter', 'Ações na interface, por evento (copy_item, copy_store, print_*, tab_*, pick_store, example)');
  m.define('compare_category_total', 'counter', 'Comparações por categoria (mercados, farmacias)');
  m.define('list_items_total', 'counter', 'Itens buscados, por resultado (found = com preço confiável, missing = sem)');
  m.define('push_events_total', 'counter', 'Avisos de queda de preço, por evento (subscribe, unsubscribe, drop, sent, gone, failed)');
  m.define('source_probe_total', 'counter', 'Teste automático de cada mercado (busca fixa, de hora em hora), por resultado (ok, falha)');
  m.define('savings_brl_total', 'counter', 'Economia estimada em R$: preço médio menos o mais barato, somado por produto');
  return m;
}
