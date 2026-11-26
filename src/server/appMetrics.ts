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
  m.define('push_events_total', 'counter', 'Avisos de queda de preço, por evento (subscribe, unsubscribe, drop, sent, gone, failed; account_* = avisos dos produtos acompanhados por conta)');
  m.define('source_probe_total', 'counter', 'Teste automático de cada mercado (busca fixa, de hora em hora), por resultado (ok, falha)');
  m.define('auth_events_total', 'counter', 'Contas, por evento (signup = conta nova, login_ok, login_error, logout, account_deleted)');
  m.define('panel_events_total', 'counter', 'Painel da conta, por evento (list_saved, list_deleted, track_added, track_removed)');
  m.define('tracked_refresh_total', 'counter', 'Rotina diária dos produtos acompanhados, por resultado (refreshed, skipped, failed)');
  m.define('catalog_refresh_total', 'counter', 'Coleta noturna da lista base, por resultado (collected, skipped, failed)');
  m.define('catalog_products_collected', 'gauge', 'Produtos da lista base coletados hoje, por mercado');
  m.define('catalog_seed_size', 'gauge', 'Tamanho da lista base da coleta noturna');
  m.define('catalog_last_run_timestamp_seconds', 'gauge', 'Quando a coleta noturna terminou pela última vez (segundos desde 1970)');
  m.define('accounts_total', 'gauge', 'Contas existentes');
  m.define('accounts_active', 'gauge', 'Contas com acesso na janela (window=7d ou 30d)');
  m.define('accounts_new', 'gauge', 'Contas criadas na janela (window=24h ou 7d)');
  m.define('accounts_returned', 'gauge', 'Contas que voltaram pelo menos um dia depois de criadas');
  m.define('accounts_tracking', 'gauge', 'Contas que acompanham ao menos um produto');
  m.define('saved_lists_total', 'gauge', 'Listas salvas nas contas');
  m.define('tracked_products_total', 'gauge', 'Produtos acompanhados nas contas');
  m.define('savings_brl_total', 'counter', 'Economia estimada em R$: preço médio menos o mais barato, somado por produto');
  return m;
}
