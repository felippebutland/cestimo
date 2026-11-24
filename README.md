# Cestimo — comparador de preços de supermercados

**Cestimo** é gratuito e de código aberto. Cole sua lista de compras e descubra **onde sai mais barato**: o app consulta os sites dos mercados da sua cidade (e a Amazon), compara produto por produto e monta uma lista de compras pronta para copiar ou imprimir.

Vem configurado para **Chapecó, SC**, mas a cidade e os mercados ficam em um arquivo de configuração. Veja [Como trocar de cidade](#como-trocar-de-cidade-passo-a-passo).

## O que ele faz

- **Compara** cada item da lista em vários mercados e mostra o mais barato, o preço médio e a diferença (R$ e %).
- **Entende tamanhos:** "Arroz 5kg" encontra o pacote de 1 kg e compara pelo **preço por kg/L/unidade**. Reconhece bandejas de ovos (`C/30`, "com 30 unidades").
- **Evita comparações erradas:** variantes (orgânico, integral, codorna…), fardos e preços muito fora do padrão aparecem como **"incerto"** e ficam de fora da média e da cesta.
- **Cesta:** total por mercado, com a cobertura de cada um (quantos itens achou).
- **Lista de compras exportável**, em dois modos: *mais barato por item* (vários mercados) ou *um mercado só* (sugere o mais barato entre os que têm todos os itens e deixa você escolher qualquer outro mercado). Copia como texto (WhatsApp) ou imprime/salva em PDF.
- Tema claro/escuro e layout para celular.

## Início rápido com Docker

Pré-requisito: [Docker](https://docs.docker.com/get-docker/) com o plugin Compose.

```bash
git clone <URL-DO-SEU-REPOSITORIO>
cd <pasta-do-repositorio>
docker compose up --build
```

Abra **http://localhost:3000**. Para parar: `Ctrl+C` (ou `docker compose down`). Para rodar em segundo plano: `docker compose up -d --build`.

A primeira construção baixa o Node e o Chromium (a imagem tem ~1,3 GB) e leva alguns minutos. Depois disso, subir é rápido.

> **Mudou o `config/markets.json`?** Ele é montado como volume: basta `docker compose restart`, sem reconstruir a imagem.

## Rodando sem Docker

Pré-requisitos: Node.js 22.12 ou mais novo (testado com a versão 24).

```bash
npm install
npx playwright install chromium     # baixa o navegador usado nas consultas
npm run dev                          # http://localhost:3000
```

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm test` | roda os testes |
| `npm run typecheck` | verifica os tipos |
| `npm run markets:check` | testa cada mercado do `config/markets.json` com uma busca real |
| `npx tsx scripts/debug-page.ts <url>` | mostra o que o navegador enxerga numa página (para investigar um site) |

Variáveis de ambiente: veja a tabela em [Variáveis de ambiente](#variáveis-de-ambiente).

## Como usar

1. Digite **um produto por linha**. **Informe o tamanho** sempre que puder: `Ovos 30un`, `Arroz Tio João 5kg`, `Leite integral 1L`. Sem tamanho, o app não sabe se você quer a bandeja de 12 ou de 30.
2. Clique em **Comparar preços** (ou `Cmd/Ctrl + Enter`). Leva de 15 a 60 segundos, conforme a lista (limite de 20 itens por vez).
3. Veja o ranking da cesta, a **Lista de compras** e o detalhe de cada produto.
4. Na lista de compras, escolha *Mais barato por item* ou *Um mercado só*. No segundo, o app já sugere o mais barato entre os que têm todos os itens, e você pode **trocar de mercado no seletor** (cada opção mostra total, itens encontrados e se há itens em outro tamanho). Use **Copiar texto** ou **Imprimir / PDF** para exportar.

## Como funciona

Os mercados não têm API pública. O app abre os sites com um navegador automatizado (Playwright), faz a busca como uma pessoa faria e lê o resultado. Cada site pertence a uma **plataforma de e-commerce**, e várias redes usam a mesma. Por isso há um adaptador por plataforma, e cada mercado é só uma configuração:

| Plataforma (`platform`) | Como reconhecer | Exemplos (Chapecó) |
|---|---|---|
| `osuper` | requisições para `sense.osuper.com.br` e `/storefront/graphql` | Comper, Royal |
| `mercafacil` | requisições para `/api/new-web/graphql`; imagens em `phygital-files.mercafacil.com` | Brasão, Unicooper |
| `vipcommerce` | requisições para `services.vipcommerce.com.br` | Passarela |
| `amazon` | amazon.com.br | Amazon |

Cada consulta passa por: busca nos sites → escolha do melhor item (nome, tamanho, variantes) → comparação por preço equivalente → estatísticas e cesta. Resultados ficam em cache por 10 minutos.

## Configuração dos mercados

Tudo fica em [`config/markets.json`](config/markets.json):

```json
{
  "city": "Chapecó, SC",
  "markets": [
    { "platform": "osuper", "name": "Comper", "origin": "https://www.comper.com.br",
      "tenant": "335", "storeId": "1803", "storeCookie": true },
    { "platform": "mercafacil", "name": "Brasão", "origin": "https://www.brasao.com.br",
      "basePath": "/avenida" },
    { "platform": "vipcommerce", "name": "Passarela", "origin": "https://www.passarelaemcasa.com.br",
      "branchName": "Passarela - Chapecó", "distributionCenterId": "8" },
    { "platform": "amazon" }
  ]
}
```

| Campo | Vale para | O que é |
|---|---|---|
| `city` | arquivo | aparece no título da página |
| `platform` | todos | `osuper`, `mercafacil`, `vipcommerce` ou `amazon` |
| `name` | todos (exceto `amazon`) | nome na tela; **precisa ser único** |
| `origin` | todos (exceto `amazon`) | endereço do site, sem barra no final |
| `tenant` | `osuper` | número da rede (1º número da URL `sense.osuper.com.br/{tenant}/{storeId}/…`) |
| `storeId` | `osuper` | número da loja da sua cidade (2º número da mesma URL) |
| `storeCookie` | `osuper` (opcional) | `true` se o site pede para **escolher uma loja**; `false` se ele já abre na loja certa |
| `basePath` | `mercafacil` | caminho da loja no site, ex.: `/avenida` |
| `branchName` | `vipcommerce` | nome **exato** da loja no seletor "Retirar na loja" |
| `distributionCenterId` | `vipcommerce` | número do centro de distribuição da loja (veja o passo 3 abaixo) |

O arquivo é validado ao iniciar. Se algo estiver errado, o app não sobe e diz o que corrigir (ex.: `Mercado "Teste" (osuper): falta o campo "tenant"`).

## Como trocar de cidade (passo a passo)

### 1. Descubra quais mercados da sua cidade vendem online

Pesquise "supermercado *<sua cidade>* online" ou "delivery supermercado *<cidade>*" e veja os aplicativos de supermercado na loja de apps. Só entram mercados que **mostram preço no site, sem login**. Sites que só publicam encarte/folheto não funcionam.

### 2. Descubra a plataforma de cada site

1. Abra o site do mercado no Chrome e aperte **F12** → aba **Network** (Rede) → filtro **Fetch/XHR**.
2. Recarregue a página e **busque um produto** (ex.: "arroz").
3. Olhe os domínios das requisições e compare com a tabela da seção [Como funciona](#como-funciona):

   | Se você vê… | A plataforma é |
   |---|---|
   | `sense.osuper.com.br` | `osuper` |
   | `/api/new-web/graphql` no próprio domínio | `mercafacil` |
   | `services.vipcommerce.com.br` | `vipcommerce` |
   | outra coisa (VTEX, Instaleap, API própria…) | ainda não suportada → [adicione um adaptador](#adicionando-uma-plataforma-nova) |

### 3. Pegue os valores de cada mercado

Escolha **a loja da sua cidade** no site e busque "arroz". Depois:

**`osuper`**
- Na aba Network procure `sense.osuper.com.br/335/1803/v2/search?...`. Os dois números depois do domínio são `tenant` (335) e `storeId` (1803).
- Se o site abriu um pop-up **"Selecione uma loja"**, use `"storeCookie": true`. Se ele já abre numa loja única e a busca funciona direto, use `false` (ou omita), e o `storeId` é o da loja padrão do site.

**`mercafacil`**
- `basePath` é o caminho da página da loja na barra de endereço. Em `https://www.brasao.com.br/avenida/busca?q=arroz`, o `basePath` é `/avenida`.
- Se a rede tem **várias lojas na cidade**, cadastre cada uma como um mercado separado, com `name` e `basePath` diferentes.

**`vipcommerce`**
- No cabeçalho do site clique em **"Retirar na loja"** e escolha a loja da cidade. Copie o nome **exatamente** como aparece (ex.: `Passarela - Chapecó`) para `branchName`.
- Na aba Network, depois de escolher a loja, procure uma URL com `.../centro_distribuicao/8/...`. O número depois de `centro_distribuicao/` é o `distributionCenterId`. Use esse número: o `id` do cadastro da filial pode ser diferente.

### 4. Edite o `config/markets.json`

Troque `city` e a lista `markets`. Exemplo para uma cidade fictícia:

```json
{
  "city": "Joinville, SC",
  "markets": [
    { "platform": "osuper", "name": "Mercado A", "origin": "https://www.mercadoa.com.br",
      "tenant": "123", "storeId": "456", "storeCookie": true },
    { "platform": "mercafacil", "name": "Mercado B", "origin": "https://www.mercadob.com.br",
      "basePath": "/centro" },
    { "platform": "amazon" }
  ]
}
```

Remova os mercados de Chapecó que não existem na sua cidade. Mantenha `{ "platform": "amazon" }` se quiser comparar com a Amazon.

### 5. Teste cada mercado

```bash
npm run markets:check                # busca "arroz 5kg" em todos
npm run markets:check -- "leite 1L"  # outro termo
```

Com Docker: `docker compose run --rm cestimo npx tsx scripts/check-markets.ts`.

Cada linha mostra ✅ (achou itens), ⚠️ (0 itens: provavelmente loja ou IDs errados) ou ❌ (erro, com o motivo).

### 6. Reinicie e use

`docker compose restart` (ou `Ctrl+C` e `npm run dev`). O título da página passa a mostrar a nova cidade.

### Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `0 itens` em um mercado `osuper` | `storeId` ou `tenant` errado; ou `storeCookie` deveria ser o contrário |
| Preços de outra cidade | `osuper` sem `storeCookie` num site que pede para escolher loja |
| Erro `loja errada: esperado centro N` (VIP) | `distributionCenterId` não é o da loja de `branchName` |
| Erro `a página não renderizou os resultados` | site mudou, está fora do ar ou bloqueou a consulta |
| Erro `o site informou erro: … 503` | o **próprio site do mercado** está com problema (comum em horários de pico ou manutenção). Tente de novo mais tarde |
| Mercado com ❌ no meio da lista | o app continua funcionando: aquela coluna aparece como "Erro" |

## Painel, métricas e registro de buscas

O app registra o que acontece, **sem guardar quem fez**: só contagens (ver [`web/privacidade.html`](web/privacidade.html)).

**Ativação:** defina `METRICS_TOKEN`. Sem ele, o painel e os endpoints abaixo não existem (404). O acesso é por senha (Basic): usuário qualquer, senha = o token.

### Painel `/admin`

Abra `https://seu-dominio/admin` no navegador (ele pede a senha) e veja, atualizado a cada 30 s:

- **Visitas, comparações, itens buscados, itens por lista, tempo médio.**
- **Listas copiadas** e a **taxa de cópia** (cópias ÷ comparações), **impressões**, quantas vezes trocaram de modo, escolheram um mercado ou usaram um exemplo.
- **App instalado (PWA):** quantas vezes o app foi **aberto como app** (uma vez por sessão), quantas **instalações** aconteceram e quantos tocaram em "Instalar app". São aberturas, não pessoas distintas, e a desinstalação não é detectável.
- **Economia estimada:** soma, por produto, de *preço médio − preço mais barato*, ou seja, quanto as pessoas deixam de gastar escolhendo o mercado mais barato.
- **Quem acessa:** tipo de aparelho (celular, tablet, computador), sistema (Android, iOS, Windows, macOS…) e navegador (Chrome, Safari, Edge…), **só como categoria genérica e contagem**. O texto completo do navegador (`User-Agent`), versões e IP **não são guardados**. Robôs (monitores de uptime, buscadores, scripts) são contados à parte e ficam fora das visitas.
- **% de itens encontrados** e **saúde de cada mercado** (achou / sem item / erro / indisponível e tempo médio).
- **Gráficos dos últimos 14 dias** e o ranking dos **produtos mais buscados**.

**Ignorar os seus próprios acessos:** ao abrir `/admin` pela primeira vez em um navegador, ele é marcado (um cookie de preferência, só nesse navegador) e **seus acessos deixam de contar**: visitas, comparações, cópias, busca nos "mais buscados" e economia. Um botão no topo do painel liga e desliga. Funciona por navegador, então abra o `/admin` uma vez em cada aparelho ou navegador que você usa (janelas anônimas contam como outro navegador). As comparações feitas por você continuam funcionando normalmente, só ficam fora das estatísticas (aparecem como `ignored` em `requests`). Não é guardado nenhum dado seu, nem IP nem impressão digital.

Os números ficam gravados em disco (`DATA_DIR`, padrão `./data`; no Docker, o volume `cestimo_data`) a cada 30 s e ao encerrar, então **sobrevivem a reinícios e a atualizações**. Só não dá para saber *quem* copiou, de propósito: o app conta ações, não pessoas.

### Endpoints

| Endpoint | Para quê |
|---|---|
| `GET /admin` | painel (HTML) |
| `GET /admin/stats` | os mesmos números em JSON |
| `GET /metrics` | formato Prometheus, com tags (`source`, `result`, `event`, `outcome`) |
| `POST /api/event` | a interface avisa uma ação anônima (copiar, imprimir…). Só aceita nomes de uma lista fechada |
| `GET /healthz` | verificação de saúde (sem senha) |

**Saúde das fontes** (`source_searches_total{source,result}`): `result` é `found`, `empty`, `erro` ou `indisponivel`. Quando um site muda e o adaptador quebra, `erro` sobe naquele `source`. Tempo em `source_search_duration_seconds{source}`.

**Uso:** `page_views_total`, `visits_by_client_total{device,os,browser}`, `bot_visits_total`, `compare_requests_total{outcome}`, `compare_items`, `compare_duration_seconds`, `list_items_total{result}`, `savings_brl_total`, `ui_events_total{event}` e `cache_events_total{source,event}`.

**Logs estruturados (uma linha JSON por evento, sem IP):**

```json
{"event":"source_search","source":"Comper","result":"found","ms":1432}
{"event":"compare","items":4,"seconds":18.2,"queries":["arroz tio joão 5kg","ovos 30un"]}
```

### Gráficos e logs (opcional): Prometheus, Loki e Grafana

O painel `/admin` já mostra os números de hoje e dos últimos 14 dias. Para histórico longo (90 dias), alertas, gráficos livres e **logs pesquisáveis**, ative o perfil `monitoring`:

```bash
# no .env: defina GRAFANA_PASSWORD
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```

O Grafana abre em `https://seu-dominio/grafana/` (usuário `admin`) já com o painel **Cestimo · visão geral**:
- **Números** (Prometheus, 90 dias): visitas, comparações, cópias, economia, aparelhos, falhas e tempo por mercado, cache, recusas.
- **Logs** (Loki, 14 dias): logs ao vivo do app, avisos e erros, o que as pessoas buscam e as buscas por mercado vistas no log.

Para explorar à vontade, abra **Explore → Loki**. Exemplos:

```logql
{service="cestimo", event="compare"}                       # comparações e produtos buscados
{service="cestimo", event="source_search"} | json | result="erro"     # buscas que falharam, por mercado
{service="cestimo", level=~"warn|error|fatal"}             # avisos e erros
```

**Como funciona e o que é lido:** o **Alloy** lê os logs apenas dos containers com o rótulo `logging=cestimo` (o app e o Caddy) e os envia ao **Loki**. Containers de outros projetos na mesma máquina **não são lidos**. Os logs do app não têm IP nem cabeçalhos. O Alloy precisa de acesso somente leitura ao socket do Docker para descobrir os containers.

Memória aproximada no limite configurado: Prometheus 384 MB, Grafana 384 MB, Loki 256 MB, Alloy 192 MB. Pense nisso ao escolher o servidor.

> Testado de ponta a ponta com Docker: o Prometheus coleta o app, o Alloy entrega os logs ao Loki, o Grafana carrega as duas fontes de dados e o painel sozinho, e as consultas dos 23 painéis foram validadas. Os gráficos por hora só preenchem depois de alguns minutos de coleta.

### Histórico de preços

A cada consulta, o Cestimo grava o menor preço confiável do dia de cada produto em SQLite (`DATA_DIR/history.db`, um valor por dia, produto e mercado; sem IP nem hora). Na tabela, produtos com 2 ou mais dias de histórico mostram um mini-gráfico, o intervalo de preços e se hoje está no menor preço. Quem tem o cookie de opt-out do administrador não grava histórico. Requer o módulo `node:sqlite` (Node 22.5 ou mais novo; a imagem Docker usa o 24).

### Alertas (Grafana)

Com o perfil `monitoring` no ar, o Grafana já traz 3 alertas (pasta **Cestimo**, em *Alerting → Alert rules*), criados a partir de `monitoring/grafana/provisioning/alerting/cestimo.yml`:

| Alerta | Dispara quando | Gravidade |
|---|---|---|
| Mercado com erro | 80% ou mais das buscas de um mercado nos últimos 30 min deram erro/indisponível (mínimo de 3 buscas), por 10 min | warning |
| Mercado sem achar produtos | 95% ou mais das buscas das últimas 6 h vieram vazias (mínimo de 8), por 30 min. Costuma ser o site do mercado ter mudado | info |
| Cestimo fora do ar | o Prometheus não lê as métricas há 3 min | critical |

Eles aparecem no topo do dashboard "Cestimo · visão geral" e em *Alerting → Alert rules*. Por padrão não enviam aviso para lugar nenhum. Para ser avisado no celular ou e-mail: *Alerting → Contact points → Add contact point* (Telegram, e-mail, Slack, webhook…), e depois em *Notification policies* troque o contact point da política padrão. Para mudar limites, edite o arquivo e reinicie o Grafana (`docker compose -f docker-compose.prod.yml --profile monitoring restart grafana`).

### Rodando a stack completa no seu computador

Com Docker (6 GB de memória para a VM é confortável), a mesma stack de produção sobe local, com HTTPS de teste:

```bash
cp .env.example .env     # DOMAIN=localhost; gere METRICS_TOKEN e GRAFANA_PASSWORD (openssl rand -base64 24)
docker compose -f docker-compose.prod.yml --profile monitoring up -d --build
```

| O quê | Endereço |
|---|---|
| App | `https://localhost/` |
| Painel de números | `https://localhost/admin` (usuário `admin`, senha = `METRICS_TOKEN`) |
| Grafana | `https://localhost/grafana/` (usuário `admin`, senha = `GRAFANA_PASSWORD`) |

O navegador avisa que o certificado de `localhost` não é confiável (é um certificado de teste do Caddy). Em um domínio real, o Caddy emite um certificado válido sozinho.

### Publicar com Cloudflare Tunnel (cloudflared)

Se o servidor está atrás de um roteador, em casa ou sem IP fixo, dá para usar um túnel da Cloudflare em vez de abrir portas e usar o Caddy. O `docker-compose.prod.yml` já publica o app **só no próprio computador**, em `127.0.0.1:3000`, justamente para isso:

1. No painel da Cloudflare (Zero Trust → Networks → Tunnels), crie o túnel e um *Public hostname* com o serviço **`http://127.0.0.1:3000`**.
2. Rode o `cloudflared` no computador com o token do túnel (por arquivo, para não aparecer na lista de processos): `cloudflared tunnel run --token-file ~/.seu-token`.
3. Suba o app: `docker compose -f docker-compose.prod.yml --profile monitoring up -d`. Defina `TRUST_PROXY=1` (já é o padrão do compose) para o limite por IP enxergar o visitante real.

> Se o site der **502 Bad Gateway**, o `cloudflared` está no ar, mas **nada responde na origem**. Confira `curl http://127.0.0.1:3000/healthz`; o log do cloudflared mostra `connection refused` e o endereço que ele tentou. Duas causas comuns: o container parou, ou outra coisa ocupa a porta 3000.

## Variáveis de ambiente

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | onde o servidor escuta (no Docker, `0.0.0.0`) |
| `MARKETS_FILE` | `config/markets.json` | arquivo de mercados |
| `APP_NAME` | `Cestimo` | nome exibido no site |
| `METRICS_TOKEN` | vazio | senha de `/admin`, `/metrics` e `/admin/stats` (vazio = desativados) |
| `RATE_LIMIT_MAX` | `20` | comparações por IP na janela |
| `RATE_LIMIT_WINDOW_MIN` | `60` | tamanho da janela, em minutos |
| `MAX_CONCURRENT` | `2` | comparações simultâneas |
| `TRUST_PROXY` | desligado | `1` quando há proxy na frente (Caddy/Cloudflare), para ler o IP real |
| `DATA_DIR` | `./data` | onde gravar os números do painel (no Docker: `/app/data`, volume) |
| `SAVE_EVERY_SECONDS` | `30` | de quanto em quanto tempo gravar em disco |
| `SHARE_TTL_DAYS` | `7` | por quantos dias um link de "Compartilhar" continua valendo |
| `HISTORY_KEEP_DAYS` | `365` | por quantos dias o histórico de preços fica guardado (arquivo `history.db` em `DATA_DIR`) |
| `BACKUP_KEEP_DAYS` | `14` | quantos backups diários ficam em `DATA_DIR/backups` (histórico, estatísticas e links) |
| `BROWSER_PAGES` | `6` | páginas do Chromium abertas ao mesmo tempo (todas as lojas juntas). Medido numa lista de 8 itens (2 rodadas): 3 páginas = 40 s; 6, 9 e 12 ficam todas entre 21 e 30 s, sem ganho claro acima de 6. O pico real de memória sobe ~60 MB por página: ~1,1 GB com 6, ~1,3 GB com 9 e ~1,5 GB com 12 (o limite do container é 1,5 GB) |
| `SOURCE_CONCURRENCY` | `3` | buscas simultâneas em cada loja; evita sobrecarregar um site com listas grandes |
| `PROBE_EVERY_MIN` | `60` | de quantos em quantos minutos o app faz uma busca de teste em cada mercado (`0` desliga) |
| `PUSH_CHECK_HOUR` | `8` | hora (local) em que a rotina diária confere os preços e envia os avisos de queda |
| `PUSH_MAX_SUBSCRIPTIONS` | `1000` | máximo de aparelhos com aviso ativado |
| `PUSH_SUBJECT` | `https://cestimo.butland.sbs` | endereço de contato informado ao serviço de push (VAPID) |
| `PROBE_TERM` | `leite integral 1L` | o que o teste automático busca nos mercados |
| `CMED_FILE` | `config/cmed-pmc.json.gz` | arquivo com os preços máximos da CMED (gerado por `npm run cmed:build`) |
| `PROBE_PHARMACY_TERM` | `dipirona 500mg` | o que o teste automático busca nas farmácias |
| `TZ_OFFSET_MIN` | `-180` | fuso dos gráficos por dia, em minutos do UTC (-180 = Brasília) |
| `GRAFANA_PASSWORD` | vazio | senha do Grafana (só no perfil `monitoring`) |

## Adicionando uma plataforma nova

Cada fonte implementa a interface `PriceSource` (`src/domain/types.ts`): `search(query) → Offer[]`, onde `Offer` tem `source`, `title`, `priceBRL` e opcionalmente `url`.

1. Capture uma resposta real da busca e salve em `fixtures/`.
2. Escreva o **parser puro** (recebe o JSON/HTML e devolve `Offer[]`) **com teste primeiro**, usando a fixture. Veja `src/sources/osuper.ts` e `osuper.spec.ts` como modelo.
3. Escreva o adaptador usando `withPage` (`src/sources/browser.ts`), que cuida do navegador, da concorrência e do tempo limite.
4. Registre a plataforma em `src/server/markets.ts` (validação dos campos + `buildSources`) e documente os campos neste README.

As anotações da investigação das plataformas atuais estão em [`spike/FINDINGS.md`](spike/FINDINGS.md).

## Estrutura

```
config/markets.json   mercados e cidade (edite aqui)
src/domain/           regras puras: lista, quantidades, match, estatísticas, comparação
src/sources/          adaptadores por plataforma + navegador (Playwright)
src/server/           API (Fastify), cache, métricas, painel (admin/) e leitura do config
web/                  interface (HTML/JS puro) e lista de compras
scripts/              utilitários (markets:check, build-icons)
monitoring/           Prometheus e Grafana (perfil opcional do Docker)
fixtures/             respostas reais usadas nos testes
spike/                anotações e scripts da fase de descoberta (descartáveis)
```

API:
- `GET /api/config`: nome, cidade e fontes.
- `POST /api/jobs` com `{ "list": "Arroz 5kg\nOvos 30un" }`: responde **na hora** com `202` e `{ "id", "total" }`. A interface usa este.
- `GET /api/jobs/:id`: `{ status: "running" | "done" | "error", done, total, result? }`. O resultado fica disponível por 10 minutos (`404` depois disso).
- `POST /api/compare`: o mesmo, mas numa única conexão que espera o resultado (mantido para scripts simples e testes).

**Por que duas etapas?** Uma comparação leva de 15 a 60 s. Em um celular, qualquer oscilação de rede (trocar de Wi-Fi para 4G, apagar a tela, ir para outro app) derrubava a única conexão e a pessoa via "Load failed", mesmo com o servidor terminando o trabalho. Agora o envio é instantâneo, o servidor trabalha sozinho e a tela só **pergunta pelo andamento**: se a conexão cair, ela volta a perguntar pelo mesmo `id` ("Reconectando…") e, se a página recarregar, retoma a consulta em andamento sem reenviar a lista. As consultas ficam em memória: se o servidor reiniciar no meio, a tela avisa para enviar de novo.

## Limitações e aviso

- **Depende dos sites.** Se um mercado mudar o site, a coluna dele pode falhar até o adaptador ser ajustado. O app continua funcionando com as outras fontes.
- **Preço do site pode diferir do preço da loja física**, e o estoque muda. Confira antes de decidir.
- **Mercado Livre** não está incluído: o site e a API bloqueiam acesso sem credenciais. A volta seria pela API oficial.
- **Respeite os sites.** O app lê páginas públicas, uma busca por vez e com cache. Respeite os termos de uso dos sites, não aumente a frequência das consultas e **não use para coleta em massa**. O projeto não tenta burlar CAPTCHAs nem bloqueios anti-robô: se um site bloquear, a fonte aparece como indisponível.
- Não é afiliado a nenhum dos mercados citados.

## Licença

Defina a licença do seu repositório (por exemplo, adicionando um arquivo `LICENSE`).


## Backup e teste automático

- **Backup:** o app grava todo dia, em `DATA_DIR/backups/AAAA-MM-DD/`, uma cópia consistente do histórico de preços (`history.db`), das estatísticas (`stats.json`) e dos links (`shares.json`). Essa pasta fica dentro do volume do Docker, então o `scripts/backup.sh` leva uma cópia para fora (padrão `~/Backups/cestimo`, ou `CESTIMO_BACKUP_DIR`; aponte para o iCloud Drive para sair do disco). Para agendar no macOS: `cp scripts/com.cestimo.backup.plist ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cestimo.backup.plist` (roda às 4h15). Para restaurar, copie o `history.db` do dia para o volume (`/app/data/history.db`) com o app parado.
- **Teste automático dos mercados:** a cada hora o app busca `PROBE_TERM` em cada mercado, sem cache e uma loja por vez, e conta o resultado em `source_probe_total{source,result}`. O alerta *Mercado falhou no teste automático* dispara quando 90% ou mais dos testes das últimas 3 h falharam.

## Aviso de queda de preço (notificação)

- **Como funciona:** depois de uma comparação, o botão **Avisar quando baixar** inscreve o aparelho (Web Push) com até 10 produtos da lista. Uma vez por dia (`PUSH_CHECK_HOUR`) o app busca cada produto acompanhado **uma única vez** (não importa quantas pessoas o acompanhem), compara o menor preço confiável com a referência guardada e envia a notificação a quem acompanha o produto quando a queda é de **5% ou mais**.
- **Referência de preço:** é guardada por produto. A primeira vez só registra; se o preço sobe, a referência sobe junto; quedas pequenas (menos de 5%) não mudam a referência, então somam até chegar ao limite. Ao avisar, o preço novo vira a referência.
- **iPhone:** o iOS só entrega notificação de app instalado na Tela de Início (iOS 16.4 ou mais novo). O botão orienta a instalar primeiro.
- **Dados:** `DATA_DIR/push.json` (aparelhos, produtos e referências) e `DATA_DIR/vapid.json` (chaves do servidor; **não apague**, trocar as chaves invalida todas as inscrições). Os dois entram no backup diário. O servidor só envia para endereços dos serviços de push dos navegadores (Chrome, Firefox, Safari e Windows).
- **Aparelho que sumiu:** quando o serviço de push informa que a inscrição não existe mais (404/410), ela é removida sozinha.
- **Métricas:** `push_events_total{event=subscribe|unsubscribe|drop|sent|gone|failed}` e, no `/admin`, as ações "Ativou/Desativou aviso de queda de preço".

## Farmácias

- **Seletor Mercados | Farmácias:** aparece acima da lista quando o `config/markets.json` tem a chave `pharmacies`. Cada categoria tem suas lojas, exemplos e última lista guardada. A API aceita `category` (`mercados`, padrão, ou `farmacias`) em `/api/jobs`, `/api/compare`, `/api/history` e `/api/share`.
- **Lojas de Chapecó (plataforma VTEX):** São João, Catarinense e Preço Popular têm retirada em loja em Chapecó (checado pela simulação de entrega da própria loja). A Pague Menos não tem loja local: entra como **"Pague Menos (entrega)"**, com envio por Sedex (4 dias úteis). Cada uma traz `"platform": "vtex"`, o `origin` e o `postalCode` (CEP que define a região, preços e estoque da cidade). O leitor abre uma página mínima da loja (`/robots.txt`) e chama de dentro dela a busca pública da própria vitrine (`product_search`), com a região do CEP.
- **Redes que ficaram de fora:** Panvel, Drogasil e Droga Raia respondem "Access Denied" (403) a um navegador automatizado. Não contornamos esse tipo de proteção, então não estão na lista.
- **Comparação de remédios:** a quantidade de comprimidos, cápsulas, ampolas e sachês vale mais que a dosagem em gramas ou o volume da ampola. A dosagem pedida (`500mg`, `1g` = `1000mg`, `FPS 50`) precisa aparecer no título: outra dosagem é outro produto e é recusada; título sem dosagem escrita aparece como "incerto". Quantidade diferente de comprimidos entra como "outro tamanho", com preço equivalente.
- **Genérico x marca:** o app escolhe o item que mais se parece com o pedido. "Dipirona 500mg 10 comprimidos" pode trazer um genérico numa farmácia e a marca (Novalgina) em outra, com preços bem diferentes. Use "Não é esse?" para escolher o que você quer comparar.
- **Teto oficial (CMED/Anvisa):** para remédios que têm preço máximo ao consumidor, a linha do produto mostra "Teto oficial do genérico (CMED): R$ x a R$ y" (ou "Teto oficial", quando só há marca). É o PMC com ICMS de 17% (Santa Catarina), da lista oficial de `config/cmed-pmc.json.gz`. Remédios isentos de prescrição (dipirona, paracetamol) têm preço livre e **não aparecem**: o teto vale para os de receita (losartana, omeprazol, amoxicilina…). Embalagens hospitalares ("EMB MULT/FRAC", "CX", "CT 50 FR") ficam de fora. Para atualizar a lista (sai uma por mês): `npm run cmed:build` (baixa ≈13 MB de gov.br/anvisa e regrava o arquivo; precisa do comando `unzip`) e faça o commit. `CMED_FILE` troca o caminho do arquivo.
- **Redes só com entrega** (testadas e não incluídas, porque não têm loja em Chapecó): Pacheco, Drogaria São Paulo, Farmácia Indiana, Venâncio e Drogal entregam pelos Correios/transportadora em 6 a 10 dias úteis. Para incluí-las com o rótulo "(entrega)", basta acrescentar `{ "platform": "vtex", "name": "…(entrega)", "origin": "…", "postalCode": "89801000" }` em `pharmacies`.
- **Comparadores de farmácia** (Consulta Remédios, Buscapé) não são usados: os termos de uso proíbem coleta automatizada de dados.
- **Ainda só para mercados:** o aviso de queda de preço (notificação).
- **Métrica:** `compare_category_total{category}`.
