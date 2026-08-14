#!/usr/bin/env bash
# =============================================================================
# backup.sh — Backup de produção: Postgres (pg_dump) + MinIO (mc mirror).
# Fase 2 do PLANO-ENTREGA-MARCOS: fecha o único bloqueante de operação que não é
# config-cliente nem corte de escopo. Sem isto, um crash = perda total dos dados.
#
# O QUE FAZ
#   1. pg_dump do banco (formato custom -Fc, compactado, restaurável seletivamente)
#      via `docker compose exec postgres` — não exige psql no host.
#   2. Espelha o bucket MinIO para o disco do host via um container efêmero `minio/mc`
#      (mc mirror) — não exige o cliente `mc` instalado no host.
#   3. Grava tudo num diretório timestamped sob BACKUP_DIR (default ./backups).
#
# USO
#   ./scripts/backup.sh                  # usa ./.env e ./backups
#   BACKUP_DIR=/mnt/disco ./scripts/backup.sh
#
# PRÉ-REQUISITOS
#   - O stack está de pé (`docker compose up -d`), ou ao menos postgres + minio.
#   - ./.env preenchido (POSTGRES_*, MINIO_ROOT_*). Lido automaticamente.
#
# RECUPERAÇÃO: ./scripts/restore.sh <diretório-do-backup>
# =============================================================================
set -euo pipefail

# --- Localização do repo (funciona de qualquer cwd) --------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# --- docker compose v2 (plugin) ou v1 (binário) ------------------------------
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "ERRO: docker compose não encontrado." >&2
  exit 1
fi

# --- Carrega .env (POSTGRES_*, MINIO_ROOT_*) ---------------------------------
if [[ -f .env ]]; then
  set -a; # shellcheck disable=SC1091
  . ./.env; set +a
else
  echo "ERRO: .env não encontrado em $REPO_ROOT. Copie de .env.example e preencha." >&2
  exit 1
fi

PG_USER="${POSTGRES_USER:?defina POSTGRES_USER no .env}"
PG_DB="${POSTGRES_DB:?defina POSTGRES_DB no .env}"
MINIO_USER="${MINIO_ROOT_USER:?defina MINIO_ROOT_USER no .env}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:?defina MINIO_ROOT_PASSWORD no .env}"
MINIO_BUCKET="${MINIO_BUCKET:-media}"   # default do código: Minio:Bucket = "media"

# --- Diretório de destino timestamped ----------------------------------------
# Timestamp local; sem dependência de fuso (data + hora).
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
DEST="$BACKUP_DIR/$STAMP"
mkdir -p "$DEST"

echo "==> Backup em: $DEST"

# --- 1. Postgres (pg_dump custom format, dentro do container) ----------------
echo "==> [1/2] pg_dump do banco '$PG_DB'…"
$DC exec -T postgres pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$DEST/postgres.dump"
PG_SIZE="$(wc -c < "$DEST/postgres.dump")"
echo "    OK — postgres.dump ($PG_SIZE bytes)"
if [[ "$PG_SIZE" -lt 100 ]]; then
  echo "ERRO: pg_dump produziu um arquivo suspeito (<100 bytes). Verifique o container postgres." >&2
  exit 1
fi

# --- 2. MinIO (mc mirror via container efêmero na rede do compose) -----------
# Descobre a rede do compose (o container minio precisa ser alcançável por nome).
echo "==> [2/2] espelhando bucket MinIO '$MINIO_BUCKET'…"
NETWORK="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
  "$($DC ps -q minio)" 2>/dev/null | head -n1)"
if [[ -z "$NETWORK" ]]; then
  echo "ERRO: não encontrei a rede do container minio. O stack está de pé? ($DC up -d minio)" >&2
  exit 1
fi
mkdir -p "$DEST/minio"
# mc dentro de minio/mc: configura alias 'src' p/ o MinIO interno e espelha p/ /export (montado no host).
# SEGURANÇA: credenciais e bucket viajam por -e (variáveis de ambiente do container), NÃO
# interpoladas no texto do script. Assim uma senha com aspas/backtick/$ não quebra nem injeta no
# `sh -c` — o shell do container expande "$MC_USER" etc. como dado, não como código.
# O `mc alias set` (autenticação) é verificado SEPARADAMENTE do `mc ls` (existência do bucket):
# senão uma senha errada cairia no mesmo ramo de "bucket não existe" e o backup reportaria sucesso
# FALSO (mídia não salva). Auth falha → exit 4 (erro real); bucket ausente → mensagem benigna.
docker run --rm --network "$NETWORK" \
  -v "$DEST/minio:/export" \
  -e MC_USER="$MINIO_USER" -e MC_PASS="$MINIO_PASS" -e MC_BUCKET="$MINIO_BUCKET" \
  --entrypoint sh minio/mc -c '
    if ! mc alias set src http://minio:9000 "$MC_USER" "$MC_PASS" >/dev/null 2>&1; then
      echo "ERRO: autenticacao no MinIO falhou (credenciais MINIO_ROOT_* invalidas?)." >&2
      exit 4
    fi
    if mc ls "src/$MC_BUCKET" >/dev/null 2>&1; then
      mc mirror --overwrite "src/$MC_BUCKET" /export
    else
      echo "    (bucket $MC_BUCKET ainda nao existe - nada a espelhar; normal num sistema novo)"
    fi
  ' || { echo "ERRO: backup do MinIO falhou — verifique credenciais e o container minio." >&2; exit 1; }
echo "    OK — minio/ espelhado"

# --- Manifesto (o que tem no backup, p/ o restore validar) -------------------
cat > "$DEST/MANIFEST.txt" <<EOF
Social AI Platform — backup
stamp:   $STAMP
db:      $PG_DB (postgres.dump, formato pg_dump custom -Fc)
bucket:  $MINIO_BUCKET (minio/)
EOF

echo "==> Backup concluído: $DEST"
echo "    Restaurar com: ./scripts/restore.sh \"$DEST\""
