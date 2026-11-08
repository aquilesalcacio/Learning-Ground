#!/usr/bin/env bash
# Pull main, rebuild both images and restart Learning Grounds on the server (docs/DEPLOY.md).
#
#   /opt/learning-grounds/deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

for file in .env.api .env.web; do
  if [[ ! -s $file ]]; then
    echo "deploy/$file is missing. Copy it from your laptop first (docs/DEPLOY.md, step 3)." >&2
    exit 1
  fi
done

git -C .. pull --ff-only
docker compose --env-file .env.web up -d --build --remove-orphans

# Ask for the login page the way nginx does, as our domain over HTTPS: Auth0 refuses any other address.
site=$(sed -n 's/^APP_BASE_URL=\([^,]*\).*/\1/p' .env.web)
host=${site#https://}
echo "Waiting for the API and the web app..."
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8100/health >/dev/null 2>&1 &&
    curl -fsS -o /dev/null -H "X-Forwarded-Host: $host" -H "X-Forwarded-Proto: https" http://127.0.0.1:3100/auth/login 2>/dev/null; then
    docker compose ps
    echo "Learning Grounds is up."
    exit 0
  fi
  sleep 2
done
docker compose ps
echo "Not answering after a minute. Check: docker compose -f $(pwd)/compose.yaml logs --tail 50" >&2
exit 1
