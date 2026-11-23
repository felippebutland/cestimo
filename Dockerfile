FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    PLAYWRIGHT_NO_SANDBOX=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Dependências primeiro, para aproveitar o cache de camadas.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Chromium (somente o headless shell) e as bibliotecas de sistema que ele precisa.
RUN npx playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright

COPY tsconfig.json ./
COPY src ./src
COPY web ./web
COPY config ./config
COPY scripts ./scripts

# Números do painel (monte um volume aqui para sobreviverem a atualizações).
RUN mkdir -p /app/data && chown node:node /app/data
ENV DATA_DIR=/app/data

# O processo roda sem privilégios de root.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node direto (sem npx): o SIGTERM do `docker stop` chega ao app, que grava os números em disco antes de sair.
CMD ["node", "--import", "tsx", "src/server/main.ts"]
