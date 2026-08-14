#!/usr/bin/env bash
# =============================================================================
# restore.sh — Recuperação: Postgres (pg_restore) + MinIO (mc mirror reverso).
# Par do backup.sh (Fase 2 do PLANO-ENTREGA-MARCOS).
#
# USO
#   ./scripts/restore.sh <diretório-do-backup>
#       → restaura no banco de produção ($POSTGRES_DB) e no bucket configurado.
#         PEDE CONFIRMAÇÃO (sobrescreve dados). Pule com FORCE=1.
#
#   RESTORE_DB=sap_restore_test ./scripts/restore.sh <dir>   # DRY-RUN seguro
#       → restaura num banco DESCARTÁVEL (criado/dropado), sem tocar produção.
#         É o que a Fase 4.4 exige para PROVAR o restore (não só escrevê-lo).
#         Não toca o MinIO no modo dry-run (MINIO_BUCKET fica intacto).
#
# Exit codes: 0 ok · 1 erro de pré-requisito · 2 verificação do dry-run falhou.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SRC="${1:-}"
if [[ -z "$SRC" || ! -d "$SRC" ]]; then
  echo "USO: $0 <diretório-do-backup>   (ex.: ./scripts/restore.sh ./backups/20260623-120000)" >&2
  exit 1
fi
if [[ ! -f "$SRC/postgres.dump" ]]; then
  echo "ERRO: $SRC não contém postgres.dump — não parece um backup válido." >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="docker-compose"
else echo "ERRO: docker compose não encontrado." >&2; exit 1; fi

if [[ -f .env ]]; then set -a; . ./.env; set +a
else echo "ERRO: .env não encontrado." >&2; exit 1; fi

PG_USER="${POSTGRES_USER:?defina POSTGRES_USER no .env}"
PROD_DB="${POSTGRES_DB:?defina POSTGRES_DB no .env}"
MINIO_USER="${MINIO_ROOT_USER:-}"
MINIO_PASS="${MINIO_ROOT_PASSWORD:-}"
MINIO_BUCKET="${MINIO_BUCKET:-media}"

# Modo dry-run: restaura num banco descartável (NÃO o de produção). Prova o restore sem risco.
DRY_RUN=0
TARGET_DB="$PROD_DB"
if [[ -n "${RESTORE_DB:-}" ]]; then
  DRY_RUN=1
  TARGET_DB="$RESTORE_DB"
  echo "==> DRY-RUN: restaurando no banco descartável '$TARGET_DB' (produção '$PROD_DB' intacta)."
fi

# --- Confirmação (só restore real, destrutivo) -------------------------------
if [[ "$DRY_RUN" -eq 0 && "${FORCE:-0}" != "1" ]]; then
  echo "ATENÇÃO: isto vai SOBRESCREVER o banco '$PROD_DB' e o bucket '$MINIO_BUCKET' com o backup $SRC."
  read -r -p "Digite 'restaurar' para confirmar: " ans
  [[ "$ans" == "restaurar" ]] || { echo "Abortado."; exit 1; }
fi

# --- 1. Postgres -------------------------------------------------------------
if [[ "$DRY_RUN" -eq 1 ]]; then
  # Banco descartável: cria do zero (drop se sobrou de um run anterior).
  echo "==> [1/2] (re)criando banco descartável '$TARGET_DB'…"
  $DC exec -T postgres psql -U "$PG_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" -c "CREATE DATABASE \"$TARGET_DB\";"
  echo "==> restaurando dump em '$TARGET_DB'…"
  # --no-owner/--no-acl: o dump pode referenciar roles que não existem no banco de teste.
  $DC exec -T postgres pg_restore -U "$PG_USER" -d "$TARGET_DB" --no-owner --no-acl \
    < "$SRC/postgres.dump"
else
  echo "==> [1/2] restaurando dump no banco de produção '$TARGET_DB'…"
  # --clean --if-exists: dropa objetos antes de recriar (restore idempotente sobre um banco existente).
  $DC exec -T postgres pg_restore -U "$PG_USER" -d "$TARGET_DB" --clean --if-exists --no-owner --no-acl \
    < "$SRC/postgres.dump"
fi
echo "    OK — Postgres restaurado em '$TARGET_DB'"

# --- Verificação do dry-run: o restore tem que ter dados de verdade ----------
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "==> verificando o restore (contando tabelas no schema public)…"
  TABLES="$($DC exec -T postgres psql -U "$PG_USER" -d "$TARGET_DB" -tA \
    -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d '[:space:]')"
  echo "    tabelas no schema public: ${TABLES:-0}"
  # Limpa o banco descartável (o dry-run não deixa lixo).
  $DC exec -T postgres psql -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET_DB\";" >/dev/null
  if [[ "${TABLES:-0}" -ge 1 ]]; then
    echo "==> DRY-RUN OK: restore recuperou $TABLES tabela(s). Banco descartável removido."
    exit 0
  else
    echo "ERRO: o restore não produziu tabelas — backup vazio ou corrompido." >&2
    exit 2
  fi
fi

# --- 2. MinIO (só no restore real; dry-run não toca o bucket) ----------------
if [[ -d "$SRC/minio" ]]; then
  echo "==> [2/2] restaurando bucket MinIO '$MINIO_BUCKET'…"
  # Só aqui as credenciais MinIO são OBRIGATÓRIAS (no topo são opcionais — o dry-run não toca
  # o bucket). Falha clara em vez de seguir com credencial vazia (mc daria erro opaco lá na frente).
  [[ -n "$MINIO_USER" && -n "$MINIO_PASS" ]] || {
    echo "ERRO: há backup de MinIO em $SRC/minio mas MINIO_ROOT_USER/MINIO_ROOT_PASSWORD não estão no .env." >&2
    exit 1
  }
  NETWORK="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
    "$($DC ps -q minio)" 2>/dev/null | head -n1)"
  [[ -n "$NETWORK" ]] || { echo "ERRO: rede do minio não encontrada (stack de pé?)." >&2; exit 1; }
  # SEGURANÇA: credenciais/bucket via -e (não interpoladas no texto do sh -c) — senha com
  # aspas/backtick/$ não quebra nem injeta. O shell do container expande "$MC_*" como dado.
  docker run --rm --network "$NETWORK" \
    -v "$SRC/minio:/import:ro" \
    -e MC_USER="$MINIO_USER" -e MC_PASS="$MINIO_PASS" -e MC_BUCKET="$MINIO_BUCKET" \
    --entrypoint sh minio/mc -c '
      mc alias set dst http://minio:9000 "$MC_USER" "$MC_PASS" >/dev/null 2>&1
      mc mb --ignore-existing "dst/$MC_BUCKET" >/dev/null 2>&1 || true
      mc mirror --overwrite /import "dst/$MC_BUCKET"
    '
  echo "    OK — bucket restaurado"
else
  echo "==> [2/2] sem diretório minio/ no backup — pulando (nada a restaurar)."
fi

echo "==> Restore concluído."
