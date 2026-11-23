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

### Gráficos históricos (opcional): Prometheus + Grafana

O painel `/admin` já mostra os números de hoje e dos últimos 14 dias. Para histórico longo (90 dias), alertas e gráficos livres, ative o perfil `monitoring`:

```bash
# no .env: defina GRAFANA_PASSWORD
docker compose -f docker-compose.prod.yml --profile monitoring up -d
```

O Grafana abre em `https://seu-dominio/grafana/` (usuário `admin`) já com o painel **Cestimo · visão geral** (visitas, comparações, cópias, economia, falhas e tempo por mercado, cache, recusas). Os dois serviços usam ~400 MB cada no limite; pense nisso ao escolher o servidor.

> Testado de ponta a ponta com Docker: o Prometheus coleta o app (`/metrics`, com a senha do `.env`), o Grafana carrega a fonte de dados e o painel sozinhos, e as 14 consultas do painel foram validadas no Prometheus. Os gráficos por hora só preenchem depois de alguns minutos de coleta.

## Publicar como serviço público

Pré-requisitos: um servidor Linux com **2 GB de RAM ou mais** (o Chromium consome memória), Docker com Compose e um **domínio** que você controla.

1. **Aponte o domínio** (registro `A`) para o IP do servidor.
2. No servidor: `git clone <seu-repositorio> && cd <pasta>`.
3. `cp .env.example .env` e preencha `DOMAIN` e `METRICS_TOKEN` (gere com `openssl rand -base64 24`).
4. Ajuste `config/markets.json` para a sua cidade ([passo a passo](#como-trocar-de-cidade-passo-a-passo)) e rode `npm run markets:check` ou o equivalente no container.
5. `docker compose -f docker-compose.prod.yml up -d --build`.

O Caddy emite o certificado HTTPS sozinho. O app não fica exposto: só o Caddy responde nas portas 80 e 443.

**O que já protege o serviço:** limite de **20 comparações por IP por hora**, no máximo **2 comparações ao mesmo tempo** (as demais recebem "tente em instantes"), 20 itens por lista, cache de 10 minutos, cabeçalhos de segurança (CSP, `X-Frame-Options`…), logs sem IP e senha nas métricas.

**Checklist antes de divulgar:**

- [ ] Domínio com HTTPS funcionando e `https://seu-dominio/healthz` respondendo.
- [ ] `https://seu-dominio/admin` pede senha e mostra o painel.
- [ ] Nome conferido: antes de usar o nome comercialmente, consulte a disponibilidade do domínio no Registro.br e da marca no INPI.
- [ ] Você leu os termos de uso dos sites consultados. O serviço faz uma busca por consulta, com cache e limites; **não aumente a frequência** nem use para coleta em massa. Se um mercado pedir para parar, remova-o do `config/markets.json`.
- [ ] Alarme simples: um monitor externo (ex.: UptimeRobot) em `/healthz`.

**Operação do dia a dia:** `docker compose -f docker-compose.prod.yml logs -f cestimo` (logs), `... restart cestimo` (após editar `config/markets.json`) e `git pull && docker compose -f docker-compose.prod.yml up -d --build` (atualizar).

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
