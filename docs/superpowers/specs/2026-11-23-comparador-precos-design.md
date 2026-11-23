# Comparador de preços Chapecó × Mercado Livre × Amazon — design

Data: 2026-11-23 · Status: aguardando aprovação

## Intenção
Dada uma lista de produtos, descobrir onde comprar mais barato: mercados de Chapecó, Mercado Livre ou Amazon. Para cada produto, mostrar o mais barato, o preço médio e a diferença de valor entre as fontes. É uso pessoal do Felippe, para decidir compras.

## Metas
- Entrada: TXT colado ou enviado, um produto por linha (ex.: `Arroz Tio João 5kg`).
- Saída por produto: preço em cada fonte, **fonte mais barata**, **preço médio**, **diferença** (R$ e %) entre a mais cara e a mais barata.
- Saída da lista: total da cesta por fonte e qual fecha mais barata.
- Mostrar o título do item encontrado ao lado do preço, para conferir o match.
- Interface: web app.

## Não metas
- Login, carrinho, compra, histórico de preços, agendamento.
- Mercados sem e-commerce em Chapecó: Fort, Via Atacadista, Alberti, Moura, Kross (ver `spike/FINDINGS.md`). Leitura de encarte por OCR fica para uma v2.
- Anti-meta: preço errado apresentado com confiança. Match incerto deve aparecer como incerto, nunca como certo.

## Restrições
- Sem APIs oficiais: busca pública via navegador (Playwright). A osuper bloqueia `curl` puro (Cloudflare); não contornar com headers falsos.
- Fontes são frágeis: cada uma isolada, e falha de uma não derruba as outras.
- Código: TypeScript, TDD, programação funcional (funções puras, imutabilidade), menor complexidade possível (Map/Set, evitar O(n²)), SOLID com dependências injetadas.

## Abordagens consideradas
1. **Adaptador por plataforma + Playwright (escolhida).** Três adaptadores de mercado (osuper, Mercafacil, VIP Commerce) parametrizados por loja, mais ML e Amazon. Cobre 5 mercados com pouco código; reaproveita a lógica quando surgir outra loja da mesma plataforma.
2. **Adaptador por mercado.** Mais isolado, mas duplica a mesma lógica em Comper e Royal, e em Brasão e Unicooper.
3. **API direta sem navegador.** Mais rápida, mas bloqueada na osuper e exige credencial de sessão no VIP Commerce. Descartada.

## Arquitetura
```
Web UI ── POST /api/compare (lista) ──> Fastify
                                         │ orquestrador (injeta fontes)
                       ┌─────────────────┼───────────────────┐
                 osuper(Comper,Royal)  Mercafacil(Brasão,Unicooper)  VIP(Passarela)  ML  Amazon
                       └──────── cada fonte: search(termo) -> Oferta[] ────────┘
                                         │
              normalização (kg/L/un) → match → estatísticas → resposta
```
- **Interface comum `PriceSource`:** `search(query): Promise<Offer[]>`; `Offer = { source, title, priceBRL, unit?, quantity?, url? }`.
- **Funções puras (testáveis sem rede):** `parseList`, `extractQuantity` (5kg, 500g, 1L, 12un), `unitPrice`, `scoreMatch` (similaridade de tokens + tamanho compatível), `pickBest`, `computeStats` (min, média, diferença), `basketTotals`.
- **Orquestrador:** roda fontes em paralelo com timeout; fonte que falha vira `status: erro` no resultado, sem derrubar a resposta.
- **Pastas:** `src/domain` (puro), `src/sources/*`, `src/server`, `web/`; specs ao lado do código.

## Regras de comparação
- Match: escolhe o item de maior `scoreMatch` por fonte. Abaixo de um limiar vira "sem match confiável" (não entra na média).
- Tamanho diferente do pedido: compara por **preço por kg/L/un**, e marca a diferença.
- Média: sobre as fontes com match confiável. Diferença: máximo − mínimo, em R$ e % do mínimo.
- Total da cesta: soma apenas dos produtos presentes em todas as fontes comparadas; exibe também cobertura (ex.: 8/10 produtos).

## Pontos em aberto (para o builder, não mudam o escopo)
- Mercafacil: onde vem o preço (listagem ou query dedicada). Passarela: selecionar loja "Chapecó" e achar a busca. Royal e Unicooper: testar a busca. ML e Amazon: sondar a busca pública. Tudo isso é a primeira tarefa do plano, antes de escrever adaptadores.
- Limiar de match e tratamento de marca: calibrar com uma lista real de teste (calls do builder).
- Cache de resultados por busca (ex.: 10 min) para não martelar os sites: decisão do builder, dentro das metas.
- Eventual bloqueio/CAPTCHA em ML ou Amazon: se ocorrer, a fonte fica `indisponível`; não se tenta burlar.

## Teste
TDD com Vitest. Domínio puro com unit tests; adaptadores com fixtures de respostas capturadas; um teste de contrato por fonte, opcional e manual (rede real).
