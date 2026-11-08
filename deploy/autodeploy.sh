#!/usr/bin/env bash
# Run every 2 minutes by learning-grounds-autodeploy.timer (docs/DEPLOY.md). Deploys only when GitHub's
# main has moved past what the server has checked out. A failed deploy isn't retried until the next push,
# so a broken build doesn't rebuild over and over on a server it shares with tagmephotos.
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch -q origin main
here=$(git rev-parse HEAD)
there=$(git rev-parse origin/main)
[[ $here == "$there" ]] && exit 0

if ! git merge-base --is-ancestor "$here" "$there"; then
  echo "main was rewritten (${here:0:7} isn't in ${there:0:7}), so it can't be pulled safely. Deploy by hand." >&2
  exit 1
fi

echo "main moved from ${here:0:7} to ${there:0:7}: $(git log -1 --format=%s "$there")"
exec deploy/deploy.sh
