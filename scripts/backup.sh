#!/bin/bash
# Leva os backups diários do Cestimo (que ficam dentro do volume do Docker) para uma pasta no seu computador.
# Uso:  scripts/backup.sh [pasta-de-destino]       (padrão: ~/Backups/cestimo)
# Para guardar fora do disco, aponte para o iCloud Drive, por exemplo:
#   CESTIMO_BACKUP_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/cestimo-backup" scripts/backup.sh
set -euo pipefail

DEST="${1:-${CESTIMO_BACKUP_DIR:-$HOME/Backups/cestimo}}"
CONTAINER="${CESTIMO_CONTAINER:-prices-cestimo-1}"
KEEP_DAYS="${CESTIMO_KEEP_DAYS:-30}"
DOCKER="${DOCKER:-/usr/local/bin/docker}"
[ -x "$DOCKER" ] || DOCKER="$(command -v docker)"

mkdir -p "$DEST"
# copia a pasta de backups do container (cada dia numa subpasta AAAA-MM-DD)
"$DOCKER" cp "$CONTAINER:/app/data/backups/." "$DEST/"

# apaga cópias com mais de KEEP_DAYS dias, só pastas com nome de data
find "$DEST" -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' -mtime "+$KEEP_DAYS" -exec rm -rf {} +

echo "Backup em $DEST: $(find "$DEST" -maxdepth 1 -type d -name '2*' | wc -l | tr -d ' ') dia(s), último: $(ls -1 "$DEST" | grep -E '^[0-9]{4}-' | sort | tail -1)"
