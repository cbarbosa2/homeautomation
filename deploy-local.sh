#!/bin/bash
# Copy the local working tree to bee.local, build there, then start the service.
set -euo pipefail
cd "$(dirname "$0")"

node scripts/check-node.mjs
npm run analyze
npm run build

# Verify runtime and the installed systemd unit before stopping the service.
ssh carlos@bee.local 'bash -se' <<'EOF_REMOTE'
set -euo pipefail
/usr/bin/node -e 'if (process.versions.node.split(".")[0] !== "26" || Number(process.versions.node.split(".")[1]) < 13) process.exit(1)'
node -e 'if (process.versions.node.split(".")[0] !== "26" || Number(process.versions.node.split(".")[1]) < 13) process.exit(1)'
command -v npm >/dev/null
case "$(systemctl show homeautomation --property=ExecStart --value)" in
  *"/usr/bin/node"*"dist/src/bootstrap.js"*) ;;
  *) echo 'Install the Node systemd unit and run daemon-reload first; see docs/operations.md.' >&2; exit 1 ;;
esac
sudo -n systemctl stop homeautomation
EOF_REMOTE

rsync -av \
  --exclude='.git/' --exclude='.env' --exclude='.env.*' \
  --exclude='.bmw-cardata-tokens.json*' --exclude='.DS_Store' \
  --exclude='logs*' --exclude='node_modules/' --exclude='dist/' \
  --exclude='.test-dist/' --exclude='docs-temp/' --exclude='deploy*.sh' \
  ./ carlos@bee.local:/home/carlos/homeautomation/

ssh carlos@bee.local 'bash -se' <<'EOF_REMOTE'
set -euo pipefail
cd /home/carlos/homeautomation
npm ci
npm run build
sudo -n systemctl start homeautomation
sudo -n systemctl status homeautomation --no-pager
EOF_REMOTE

echo 'Local deployment completed; verify the health endpoint, metrics and journal.'
