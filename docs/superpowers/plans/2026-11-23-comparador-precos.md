# Comparador de preços Chapecó × ML × Amazon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web app que recebe uma lista de produtos (um por linha) e mostra, por produto, o preço em 5 mercados de Chapecó, Mercado Livre e Amazon, com o mais barato, a média e a diferença.

**Architecture:** Núcleo de domínio puro (parse, quantidade, match, estatísticas) + interface `PriceSource` com adaptadores por plataforma (osuper, Mercafacil, VIP Commerce, ML, Amazon) via Playwright + orquestrador que isola falhas + Fastify + página estática.

**Tech Stack:** TypeScript (ESM), Node 24, Vitest, Playwright, Fastify, HTML/JS puro no front.

**Spec:** `docs/superpowers/specs/2026-11-23-comparador-precos-design.md` e achados em `spike/FINDINGS.md`.

## Global Constraints

- TypeScript estrito, TDD (teste falhando antes do código).
- Funções puras e imutabilidade; `Map`/`Set` em vez de busca linear aninhada; SOLID com dependências injetadas.
- Sem APIs oficiais; busca pública via Playwright. Não contornar bloqueios (headers falsos, CAPTCHA). Fonte bloqueada vira `status: "indisponivel"`.
- Falha de uma fonte nunca derruba a resposta.
- Moeda: BRL como `number` em reais (ex.: `21.79`).
- Mercados v1: Comper, Royal, Brasão, Unicooper, Passarela (loja Chapecó). Mais ML e Amazon.
- Código novo em `src/` e `web/`; `spike/` é descartável e não é importado.

## Review Focus

- Linha vazia, só espaços ou duplicada na lista: ignorar/deduplicar, sem quebrar. (Task 1)
- Preço ausente, `0` ou texto sem número no item da fonte: descartar a oferta. (Tasks 5, 6–10)
- Produto com unidade diferente (pedido `1kg`, achado `500g`; `un` vs `kg`): comparar por preço/unidade ou marcar não comparável, nunca misturar. (Tasks 2, 4)
- Nenhuma fonte com match confiável: estatísticas `null`, sem divisão por zero. (Task 4)
- Só uma fonte com match: média = esse preço, diferença = 0. (Task 4)
- Fonte lenta ou fora do ar: timeout e `status` por fonte, resposta ainda completa. (Task 5)

---

### Task 1: Scaffold + parseList

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/domain/types.ts`, `src/domain/parseList.ts`
- Test: `src/domain/parseList.spec.ts`

**Interfaces:**
- Produces: `export type Offer = { source: string; title: string; priceBRL: number; url?: string }`; `export type SourceStatus = "ok" | "erro" | "indisponivel"`; `export interface PriceSource { readonly name: string; search(query: string): Promise<Offer[]> }`; `export function parseList(raw: string): string[]`.

- [ ] **Step 1: Write failing tests** in `parseList.spec.ts`: `"Arroz 5kg\n\n  Feijão 1kg  \nArroz 5kg"` → `["Arroz 5kg","Feijão 1kg"]` (trim, remove vazias, dedupe case-insensitive mantendo a ordem); `""` → `[]`; `"\r\n"` line endings funcionam.
- [ ] **Step 2: Run** `npx vitest run src/domain/parseList.spec.ts` → FAIL.
- [ ] **Step 3: Scaffold** (`npm init`, deps `vitest typescript playwright fastify`, `tsx`; scripts `test`, `dev`) e implementar `parseList` com `Set` para dedupe.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: scaffold e parseList`.

### Task 2: Quantidade e preço unitário

**Files:** Create `src/domain/quantity.ts`; Test `src/domain/quantity.spec.ts`

**Interfaces:**
- Produces: `export type Quantity = { value: number; dim: "mass" | "volume" | "count" }` (mass em g, volume em ml, count em un); `export function extractQuantity(text: string): Quantity | null`; `export function unitPrice(priceBRL: number, q: Quantity): number` (R$ por kg, L ou un).

- [ ] **Step 1: Tests:** `extractQuantity("Arroz Urbano 5kg Tipo 1")` → `{value:5000,dim:"mass"}`; `"Leite 1L"` → `{1000,"volume"}`; `"Refri 350ml"` → `{350,"volume"}`; `"Ovos 12un"` → `{12,"count"}`; `"Feijão 500 g"` → `{500,"mass"}`; `"Sabão"` → `null`; `"2,5kg"` → `{2500,"mass"}`; `unitPrice(20, {5000,"mass"})` → `4` (R$/kg).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** com regex única que aceita vírgula decimal e espaço entre número e unidade.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 3: Match de produto

**Files:** Create `src/domain/match.ts`; Test `src/domain/match.spec.ts`

**Interfaces:**
- Consumes: `Offer`, `extractQuantity`.
- Produces: `export const MATCH_THRESHOLD = 0.6`; `export function scoreMatch(query: string, title: string): number` (0 a 1); `export function pickBest(query: string, offers: Offer[]): { offer: Offer; score: number } | null` (null se o melhor score < `MATCH_THRESHOLD`).

- [ ] **Step 1: Tests:** `scoreMatch("Arroz Tio João 5kg","Arroz Branco Tio João Tipo 1 5kg")` ≥ 0.6; `scoreMatch("Arroz 5kg","Arroz Urbano 1kg")` < `scoreMatch("Arroz 5kg","Arroz Urbano 5kg")`; acentos e caixa ignorados; `pickBest` com lista vazia → `null`; lista só de itens irrelevantes → `null`; empate resolve pelo menor preço.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** com tokens normalizados (NFD sem acento, minúsculas) em `Set`; score = Jaccard dos tokens de palavras + bônus se `extractQuantity` for igual. Complexidade O(n) por oferta.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 4: Estatísticas e cesta

**Files:** Create `src/domain/stats.ts`; Test `src/domain/stats.spec.ts`

**Interfaces:**
- Consumes: `Quantity`, `unitPrice`.
- Produces: `export type Priced = { source: string; priceBRL: number }`; `export type Stats = { cheapest: Priced; averageBRL: number; maxBRL: number; diffBRL: number; diffPct: number }`; `export function computeStats(items: Priced[]): Stats | null`; `export function basketTotals(rows: Priced[][]): { totals: Map<string, number>; covered: number; total: number; cheapestSource: string | null }` (soma só os produtos presentes em todas as fontes consideradas).

- [ ] **Step 1: Tests:** `computeStats([])` → `null`; um item → `diffBRL=0, diffPct=0, averageBRL=preço`; `[{a,20},{b,25},{c,21}]` → `cheapest.source="a"`, `averageBRL≈22`, `diffBRL=5`, `diffPct=25`; `basketTotals` com um produto faltando em uma fonte exclui esse produto de todas e `covered` reflete isso.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** em passada única com `reduce`; `diffPct` = diff / min × 100.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 5: Orquestrador

**Files:** Create `src/domain/compare.ts`; Test `src/domain/compare.spec.ts`

**Interfaces:**
- Consumes: `PriceSource`, `pickBest`, `computeStats`, `basketTotals`, `parseList`.
- Produces: `export type SourceResult = { source: string; status: SourceStatus; match?: { title: string; priceBRL: number; score: number; url?: string } }`; `export type ProductResult = { query: string; sources: SourceResult[]; stats: Stats | null }`; `export type CompareResult = { products: ProductResult[]; basket: ReturnType<typeof basketTotals> }`; `export function compare(list: string[], sources: PriceSource[], opts?: { timeoutMs?: number }): Promise<CompareResult>` (padrão 20000 ms).

- [ ] **Step 1: Tests com fontes falsas:** fonte que lança → `status:"erro"` e as outras seguem; fonte que passa do timeout → `"erro"`; fonte que retorna `[]` ou só preço `0`/`NaN` → `status:"ok"` sem `match`; fonte `ok` com match entra nas estatísticas; execução em paralelo (duas fontes de 50 ms terminam em < 150 ms).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** com `Promise.allSettled` e `Promise.race` para timeout; filtra ofertas com preço inválido antes do `pickBest`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit.**

### Task 6: Sondagem das fontes pendentes e fixtures

**Files:** Modify `spike/FINDINGS.md`; Create `fixtures/*.json`

Objetivo: fechar os pontos em aberto do spec antes dos adaptadores.
- [ ] **Step 1:** com `spike/capture.mjs`, `cap3.mjs`, `cap6.mjs`, testar a busca de "arroz 5kg" em Royal, Unicooper, Passarela (selecionando a loja Chapecó), achar o preço no Mercafacil (query dedicada ou DOM da listagem), e sondar a busca pública do Mercado Livre e da Amazon.
- [ ] **Step 2:** salvar uma resposta real de cada em `fixtures/<fonte>.json` e registrar em `FINDINGS.md` o endpoint/seletor e se houve bloqueio/CAPTCHA (nesse caso a fonte fica `indisponivel` e a task do adaptador correspondente é cancelada).
- [ ] **Step 3: Commit.**

### Task 7: Adaptador osuper (Comper, Royal)

**Files:** Create `src/sources/osuper.ts`, `src/sources/browser.ts`; Test `src/sources/osuper.spec.ts`

**Interfaces:**
- Consumes: `PriceSource`, `Offer`; fixtures da Task 6.
- Produces: `export function parseOsuperHits(json: unknown, source: string): Offer[]` (puro); `export function createOsuperSource(cfg: { name: string; origin: string; tenant: string; storeId: string }): PriceSource` com `COMPER = { name:"Comper", origin:"https://www.comper.com.br", tenant:"335", storeId:"1803" }` e `ROYAL = { name:"Royal", origin:"https://www.superroyal.com.br", tenant:"8", storeId:"18" }`; `browser.ts` exporta `withPage<T>(fn: (p: Page) => Promise<T>): Promise<T>` (reusa um browser, fecha o contexto).

- [ ] **Step 1: Tests** de `parseOsuperHits` com a fixture (campos de preço conforme a Task 6): retorna `Offer[]` com `priceBRL` numérico; hit sem preço é descartado; JSON inesperado → `[]`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `parseOsuperHits`; `search` abre a página de busca `/busca/<termo>` com o cookie da loja (`st_<tenant>`) e captura a resposta de `sense.osuper.com.br/<tenant>/<storeId>/v2/search` via `page.on('response')`.
- [ ] **Step 4: Run** → PASS. Teste de contrato real opcional, `RUN_LIVE=1`.
- [ ] **Step 5: Commit.**

### Task 8: Adaptador Mercafacil (Brasão, Unicooper)

**Files:** Create `src/sources/mercafacil.ts`; Test `src/sources/mercafacil.spec.ts`

**Interfaces:**
- Produces: `export function parseMercafacil(payload: unknown, source: string): Offer[]`; `export function createMercafacilSource(cfg: { name: string; origin: string; basePath: string; storeId: string }): PriceSource` com `BRASAO = { name:"Brasão", origin:"https://www.brasao.com.br", basePath:"/avenida", storeId:"1" }` e `UNICOOPER = { name:"Unicooper", origin:"https://www.unicoopersupermercados.com.br", basePath:"/loja", storeId:"1" }` (confirmar `basePath` na Task 6).

- [ ] **Step 1: Tests** com fixture da listagem: preço extraído de "R$ 19,99" (vírgula decimal); item sem preço descartado; preço promocional preferido ao "de".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `search` navegando em `<origin><basePath>/busca?q=` e lendo os cards (ou a query de preço achada na Task 6).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit.**

### Task 9: Adaptador VIP Commerce (Passarela)

**Files:** Create `src/sources/vipcommerce.ts`; Test `src/sources/vipcommerce.spec.ts`

**Interfaces:**
- Produces: `export function parseVipProducts(payload: unknown, source: string): Offer[]`; `export function createVipSource(cfg: { name: string; origin: string; branchName: string }): PriceSource` com `PASSARELA = { name:"Passarela", origin:"https://www.passarelaemcasa.com.br", branchName:"Passarela - Chapecó" }`.

- [ ] **Step 1: Tests** com fixture de busca: parse do preço e do título; seleção da loja Chapecó (função pura que escolhe a filial por nome a partir da lista de retiradas); produto indisponível descartado.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (abrir o site, escolher a loja Chapecó, buscar, capturar a resposta). **Step 4: PASS. Step 5: Commit.**

### Task 10: Adaptadores Mercado Livre e Amazon

**Files:** Create `src/sources/mercadolivre.ts`, `src/sources/amazon.ts`; Tests `*.spec.ts`

**Interfaces:**
- Produces: `parseMercadoLivre(html: string): Offer[]`, `parseAmazon(html: string): Offer[]`, `export const mercadoLivreSource: PriceSource`, `export const amazonSource: PriceSource`.

- [ ] **Step 1: Tests** com HTML de fixture: extrai título e preço; descarta patrocinado sem preço; HTML de bloqueio/CAPTCHA → lança `BlockedError` (a fonte vira `indisponivel`; ver Task 5 mapear `BlockedError` → `"indisponivel"`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: PASS. Step 5: Commit.**

### Task 11: API Fastify

**Files:** Create `src/server/app.ts`, `src/server/main.ts`, `src/server/cache.ts`; Test `src/server/app.spec.ts`

**Interfaces:**
- Consumes: `compare`, `parseList`, fontes.
- Produces: `export function buildApp(deps: { sources: PriceSource[] }): FastifyInstance`; `POST /api/compare` body `{ list: string }` → `CompareResult`; 400 se lista vazia ou > 50 itens; cache em memória por (fonte, termo) por 10 min.

- [ ] **Step 1: Tests** com `buildApp({sources:[fake]})` e `app.inject`: lista válida → 200 com `products`; lista vazia → 400; 51 itens → 400; segunda chamada igual não reexecuta a fonte (cache).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (cache como decorator de `PriceSource`). **Step 4: PASS. Step 5: Commit.**

### Task 12: Web UI

**Files:** Create `web/index.html`, `web/app.js`, `web/format.js`; Test `web/format.spec.ts`

**Interfaces:**
- Consumes: `POST /api/compare`.
- Produces: `formatBRL(n: number): string` (ex.: `R$ 21,79`); página com textarea, botão Comparar e tabela (linhas = produtos, colunas = fontes; célula = preço + título; destaca o mais barato; mostra média e diferença; rodapé com total da cesta e cobertura; status por fonte `ok/erro/indisponível`).

- [ ] **Step 1: Test** `formatBRL(21.79)` → `"R$ 21,79"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** UI servida por Fastify estático. **Step 4: PASS e verificar manualmente** `npm run dev`, abrir a página, colar 3 produtos, conferir a tabela. **Step 5: Commit.**

---

## Self-Review

- **Cobertura do spec:** entrada TXT (T1), saída por produto/mais barato/média/diferença (T4, T5, T12), cesta e cobertura (T4), título do match visível (T5, T12), unidade por kg/L/un (T2), isolamento de falhas (T5), 5 mercados + ML/Amazon (T7–T10), web app (T11–T12), cache (T11), pontos em aberto (T6).
- **Tipos consistentes:** `Offer`, `PriceSource`, `Priced`, `Stats` e `SourceStatus` definidos em T1/T4 e usados igual depois.
- **Dívida conhecida:** os campos exatos de preço das fontes dependem da T6. `BlockedError` (`class BlockedError extends Error`) é definido em `src/domain/types.ts` na T5, onde o orquestrador o mapeia para `"indisponivel"`; a T10 só o lança.
