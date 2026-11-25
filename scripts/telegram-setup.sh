#!/usr/bin/env bash
# Liga os alertas do Grafana ao Telegram.
# Antes: crie um bot no @BotFather, ponha TELEGRAM_BOT_TOKEN no .env e mande "oi" para o bot no Telegram.
# Depois: ./scripts/telegram-setup.sh
# O script descobre o TELEGRAM_CHAT_ID (e grava no .env), manda uma mensagem de teste, cria o contact point no Grafana e aponta os alertas para ele.
# O token nunca é mostrado na tela.
set -euo pipefail
cd "$(dirname "$0")/.."

# lê o valor do .env sem aspas nem espaços nas pontas (o Docker Compose também aceita VALOR entre aspas)
get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"\r' | tr -d "'" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' || true; }
TOKEN="$(get TELEGRAM_BOT_TOKEN)"
[ -n "$TOKEN" ] || { echo "Defina TELEGRAM_BOT_TOKEN no .env (o token que o @BotFather deu)."; exit 1; }

CHAT="$(get TELEGRAM_CHAT_ID)"
if [ -z "$CHAT" ]; then
  CHAT="$(curl -fsS "https://api.telegram.org/bot${TOKEN}/getUpdates" | python3 -c '
import json, sys
d = json.load(sys.stdin)
ids = [u["message"]["chat"]["id"] for u in d.get("result", []) if "message" in u]
print(ids[-1] if ids else "")
')"
  [ -n "$CHAT" ] || { echo "Não achei conversa com o bot. Abra o bot no Telegram, mande \"oi\" e rode de novo."; exit 1; }
  python3 - "$CHAT" <<'PY'
import re, sys
chat = sys.argv[1]
text = open(".env").read()
if re.search(r"^TELEGRAM_CHAT_ID=.*$", text, re.M):
    text = re.sub(r"^TELEGRAM_CHAT_ID=.*$", f"TELEGRAM_CHAT_ID={chat}", text, flags=re.M)
else:
    text = text.rstrip("\n") + f"\nTELEGRAM_CHAT_ID={chat}\n"
open(".env", "w").write(text)
PY
  echo "Chat id gravado no .env."
fi

curl -fsS -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT}" \
  --data-urlencode "text=Cestimo: os alertas agora chegam aqui ✅" >/dev/null
echo "Mensagem de teste enviada ao Telegram."

# Cria (ou atualiza) o contact point e a política de notificação pela API do Grafana (rodando de dentro da rede do Docker, pelo
# container do app). Não é arquivo de provisionamento: o Grafana não aceita o chat id (número) lido do ambiente, e um arquivo
# inválido derrubaria o painel.
GPASS="$(get GRAFANA_PASSWORD)"
[ -n "$GPASS" ] || { echo "Defina GRAFANA_PASSWORD no .env."; exit 1; }
docker exec prices-grafana-1 true 2>/dev/null || { echo "O Grafana não está rodando (perfil monitoring)."; exit 1; }

python3 - "$TOKEN" "$CHAT" "$GPASS" <<'PY' | docker exec -i prices-cestimo-1 node -e '
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", async () => {
  const { contact, policy, password } = JSON.parse(d);
  const base = "http://grafana:3000/grafana/api/v1/provisioning";
  const h = { "content-type": "application/json", "x-disable-provenance": "true", authorization: "Basic " + Buffer.from("admin:" + password).toString("base64") };
  let r = await fetch(base + "/contact-points", { method: "POST", headers: h, body: JSON.stringify(contact) });
  if (!r.ok) r = await fetch(base + "/contact-points/telegram-cestimo", { method: "PUT", headers: h, body: JSON.stringify(contact) });
  if (!r.ok) throw new Error("contact point: HTTP " + r.status);
  r = await fetch(base + "/policies", { method: "PUT", headers: h, body: JSON.stringify(policy) });
  if (!r.ok) throw new Error("política: HTTP " + r.status + " " + (await r.text()).slice(0, 200));
  console.log("Contact point e política atualizados.");
});'
import json, sys
token, chat, password = sys.argv[1:4]
print(json.dumps({
  "contact": {"uid": "telegram-cestimo", "name": "telegram-cestimo", "type": "telegram", "disableResolveMessage": False, "settings": {"botToken": token, "chatid": chat}},
  "policy": {"receiver": "telegram-cestimo", "group_by": ["alertname"], "group_wait": "30s", "group_interval": "5m", "repeat_interval": "4h"},
  "password": password,
}))
PY
echo "Pronto: o Grafana aponta os alertas para o Telegram."
