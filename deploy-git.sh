#!/bin/bash
# Pull main on bee.local, build there, then start the service.
set -euo pipefail
cd "$(dirname "$0")"

node scripts/check-node.mjs
npm run analyze
npm run build

ssh carlos@bee.local 'bash -se' <<'EOF_REMOTE'
set -euo pipefail
cd /home/carlos/homeautomation
/usr/bin/node -e 'if (process.versions.node.split(".")[0] !== "26" || Number(process.versions.node.split(".")[1]) < 13) process.exit(1)'
node -e 'if (process.versions.node.split(".")[0] !== "26" || Number(process.versions.node.split(".")[1]) < 13) process.exit(1)'
command -v npm >/dev/null
case "$(systemctl show homeautomation --property=ExecStart --value)" in
  *"/usr/bin/node"*"dist/src/bootstrap.js"*) ;;
  *) echo 'Install the Node systemd unit and run daemon-reload first; see docs/operations.md.' >&2; exit 1 ;;
esac
sudo -n systemctl stop homeautomation
git pull --ff-only origin main
npm ci
npm run build
date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" > build-timestamp.txt
sudo -n systemctl start homeautomation
sudo -n systemctl status homeautomation --no-pager
EOF_REMOTE

echo 'Git deployment completed; verify the health endpoint, metrics and journal.'
