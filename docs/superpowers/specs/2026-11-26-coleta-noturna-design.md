# Coleta noturna de preços (base do banco de preços) — design

Data: 2026-11-26 · Status: proposto, aguardando aprovação

## Intenção
Hoje o histórico só existe para o que alguém já buscou, e guarda só o preço (não o nome do produto que casou). Para ter tendência, gráficos e avisos confiáveis, o Cestimo precisa coletar preços por conta própria, toda noite, de uma lista fixa de produtos.

## Metas
- Toda noite, consultar nos 6 mercados uma lista base (~150 a 200 produtos) e gravar o resultado.
- Guardar **o título que casou**, o preço, o preço por unidade e se o casamento foi "incerto". Assim dá para auditar e para ver quando o produto mudou.
- Não pesar nas lojas nem atrapalhar quem usa o app.
- Mostrar no Grafana e no `/admin` quantos produtos foram coletados por loja.

## Fora de escopo (por enquanto)
- Código de barras (EAN): hoje o adaptador de cada loja devolve só `{source, title, priceBRL}`. EAN entra numa v2, adaptador por adaptador.
- Mais lojas, mais cidades, farmácias (a lista base v1 é só de mercados).
- Preços enviados por usuários (foto de etiqueta). Descartado: os preços dos sites estavam certos; a diferença que vimos era de data.
- Hospedagem fora do Mac e troca do SQLite.

## Abordagens consideradas
1. **Reaproveitar `refreshTracked` (recomendada).** A rotina que já atualiza os produtos acompanhados passa a receber também a lista base. Troca só a fonte da lista e o que se grava. Cerca de 1 semana, risco baixo.
2. **Serviço de coleta separado** com fila, reintentos e agenda por loja. Mais robusto, mas 3 semanas ou mais e mais coisas para manter. Exagero para 6 lojas.

## Desenho (abordagem 1)
- **Lista base:** `config/seed-products.json`, editável à mão. Começa com os produtos mais buscados + cesta básica (arroz, feijão, óleo, leite, ovos, café, açúcar, carnes comuns...).
- **Quando:** de madrugada (padrão 03:00, `SEED_REFRESH_HOUR`), antes da rotina dos acompanhados (07:00). Produtos acompanhados continuam sendo coletados na mesma rodada, sem repetir os já feitos no dia.
- **Educação com as lojas:** lotes de 3 produtos (como hoje), pausa de alguns segundos entre lotes; se uma loja bloqueia (`BlockedError`), ela sai do resto da rodada.
- **Dados:** nova tabela `observations(day, source, product, title, price, unit_price, uncertain)` no `history.db`, chave `(day, source, product)`, mantida pelo mesmo `HISTORY_KEEP_DAYS`. O histórico atual (`prices`) continua igual.
- **Métricas:** `catalog_refresh_total{result}` e `catalog_products_collected{source}`; alerta no Grafana se uma loja chega a menos de 70% da lista base ou se a rodada não roda.
- **Privacidade:** nada pessoal; só produto, loja, dia e preço.

## Testes (TDD)
- Rotina: pula o que já tem preço do dia, respeita o lote, uma loja bloqueada não derruba as outras.
- `observations`: grava título e preço, atualiza no mesmo dia, expira pelo prazo.
- Lista base: validação do arquivo (duplicados, tamanho máximo, texto vazio).

## Decisões que são suas
1. **Lista base:** posso montar a primeira com ~150 itens (mais buscados + cesta básica) para você revisar. Ok?
2. **Horário:** 03:00 serve, ou prefere outro?
3. **Carga:** ~150 produtos × 6 lojas = cerca de 900 consultas por noite, em torno de 40 a 60 minutos. Ok para o Mac ficar fazendo isso de madrugada?

## Depois da v1
EAN por loja, farmácias, histórico por produto na tela, alertas mais finos, mais cidades.
