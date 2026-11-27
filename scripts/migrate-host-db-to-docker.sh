#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_ARGS=()
if [[ -f ".env.docker" ]]; then
  ENV_ARGS=(--env-file .env.docker)
fi

echo "1. Memastikan container db berjalan..."
docker compose "${ENV_ARGS[@]}" up -d db
until docker compose "${ENV_ARGS[@]}" exec -T db healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; do
  sleep 2
done

echo "2. Menyalin database simp2m_dev & simp2m_dev_trial dari MariaDB host ke container db..."
mysqldump -u root --single-transaction --routines --triggers simp2m_dev \
  | docker compose "${ENV_ARGS[@]}" exec -T db sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb --user=root "$1"' sh simp2m_dev

mysqldump -u root --single-transaction --routines --triggers simp2m_dev_trial \
  | docker compose "${ENV_ARGS[@]}" exec -T db sh -c 'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb --user=root "$1"' sh simp2m_dev_trial

echo "Selesai. Jalankan ./scripts/deploy-docker.sh untuk menyalakan migrate, backend, dan frontend."
