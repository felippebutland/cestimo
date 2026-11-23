# Spike de descoberta — 2026-11-23 (descartável)

Três plataformas cobrem 5 mercados: **osuper**, **Mercafacil** e **VIP Commerce**.

| Mercado | URL | Plataforma | Chapecó | Status |
|---|---|---|---|---|
| Comper | comper.com.br | osuper (tenant 335) | loja Sul-293, storeId 1803 (cookie `st_335`) | OK: preço verificado |
| Royal | superroyal.com.br | osuper (tenant 8) | storeId 18, Presidente Médici | mapeado, busca não testada |
| Brasão | brasao.com.br/avenida | Mercafacil | Brasão Avenida, storeId 1 | OK: preço na listagem `/avenida/busca?q=` |
| Unicooper | unicoopersupermercados.com.br | Mercafacil | storeId 1 | mapeado, busca não testada |
| Passarela | passarelaemcasa.com.br | VIP Commerce (org 344) | "Passarela - Chapecó" existe; loja padrão é Herval | mapeado; falta selecionar a loja e testar busca |
| Fort | fortatacadista.com.br | osuper (tenant 334) | `searchActiveStores` vazio para Chapecó | sem delivery online |
| Via Atacadista | grupopassarela.com/via-atacadista | só ofertas/folheto | — | sem e-commerce |
| Alberti | supermercadosalberti.com.br | site institucional (ofertas, Clube) | — | sem e-commerce |
| Moura | supermoura.com.br | site institucional (tablóides) | — | sem e-commerce |
| Kross | krossatacadista.com.br | página única "Vem que tá barato" | — | sem e-commerce |

Descartados (domínios errados): royalsupermercados.com.br (Volta Redonda RJ), unicompra.com.br (Maceió AL), superalfa.com.br (dedetizadora).

Notas
- osuper: API atrás de Cloudflare; curl puro = 403. Usar Playwright.
- Mercafacil: `showcaseProductsSearch` só retorna nome/slug/imagem; preço vem da página de listagem.
- VIP Commerce: o site faz um login anônimo próprio (services.vipcommerce.com.br) antes de listar produtos.
- Alberti, Moura, Kross e Via só publicam folheto/ofertas. Opção: ler o encarte (PDF/imagem), o que exigiria OCR. Fora do escopo inicial.

## Task 6 — resultados da sondagem (2026-11-23)
- **osuper (Comper, Royal):** JSON `hits[]` com `name`, `brandName`, `content`, `contentUnit`, `pricing.price`, `pricing.promotionalPrice`, `pricing.promotion`, `slug`. Comper precisa do cookie `st_335={"id":"1803","userSelected":true}` (URL-encoded). Royal funciona SEM cookie (loja 18 é o padrão; o cookie quebra a página). Navegar direto em `/busca/<termo>` e capturar `sense.osuper.com.br/<tenant>/<store>/v2/search`. Requer User-Agent de Chrome comum.
- **Amazon:** HTML da busca abre (200). `[data-component-type="s-search-result"]` → `h2` (título) e `.a-price .a-offscreen` ("R$ 34,99").
- **Mercado Livre:** **403** ao navegador automatizado. Fonte fica `indisponivel`; sem contornar. Alternativa futura: API oficial com token.
- **Brasão/Unicooper (Mercafacil):** `/avenida/busca?q=` (Unicooper: `/loja/busca?q=`, a confirmar). Cards `<a href="/avenida/produto/m/<slug>-<id>">` com texto "…<título>R$ 19,99 /un". Classes são styled-components (instáveis): parsear pelo `href` e pelo texto.
- **Passarela (VIP Commerce):** clicar em "Retirar na loja" no cabeçalho, escolher "Passarela - Chapecó", buscar na caixa "O que você precisa?" e capturar `.../buscas/produtos/termo/<termo>?page=1` → `data.produtos[]` com `descricao`, `preco` (string "33.90"), `disponivel`, `em_oferta`, `oferta`, `preco_original`, `link`. Chapecó = centro de distribuição 8 (o `id` da filial; 1184 é outro campo, não usar).
Fixtures: `fixtures/{comper,royal}.json`, `fixtures/passarela-1.json`, `fixtures/amazon.html`, `fixtures/brasao.html`.
