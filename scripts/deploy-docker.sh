#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--pull" ]]; then
  git pull --ff-only origin main
fi

ENV_ARGS=()
if [[ -f ".env.docker" ]]; then
  ENV_ARGS=(--env-file .env.docker)
fi

docker compose "${ENV_ARGS[@]}" up -d --build --remove-orphans
docker compose "${ENV_ARGS[@]}" ps
