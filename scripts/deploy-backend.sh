#!/usr/bin/env bash
# Тесты → сборка бэкенда в один файл и Mini App → выкладка на VPS. Сервис перезапускается, только если уже настроен.
set -euo pipefail
cd "$(dirname "$0")/.."

# DEPLOY_HOST=root@1.2.3.4 и DEPLOY_SSH_KEY=~/.ssh/key — в .deploy.env (не в git)
[ -f .deploy.env ] && source .deploy.env
: "${DEPLOY_HOST:?Укажите DEPLOY_HOST в .deploy.env}"
SSH=(ssh ${DEPLOY_SSH_KEY:+-i "$DEPLOY_SSH_KEY"} -o ConnectTimeout=15 "$DEPLOY_HOST")

npm test --silent
npx esbuild backend/main.ts --bundle --platform=node --format=cjs --target=node22 --outfile=dist/backend.cjs --log-level=warning
npm run app:build --silent

"${SSH[@]}" 'mkdir -p /opt/ton-access-pass /etc/ton-access-pass /var/www/ton-access-pass && chmod 700 /etc/ton-access-pass'
COPYFILE_DISABLE=1 tar --no-xattrs -C . -cf - dist/backend.cjs server/ton-access-pass.service server/ton-access-pass-setup |
  "${SSH[@]}" 'set -e
    tmp=$(mktemp -d); tar -C "$tmp" -xf -
    install -m 644 "$tmp/dist/backend.cjs" /opt/ton-access-pass/backend.cjs
    install -m 644 "$tmp/server/ton-access-pass.service" /etc/systemd/system/ton-access-pass.service
    install -m 755 "$tmp/server/ton-access-pass-setup" /usr/local/bin/ton-access-pass-setup
    rm -rf "$tmp"
    [ -f /etc/ton-access-pass/config.env ] || printf "TON_NETWORK=testnet\nMASTER_ADDRESS=\nMINI_APP_URL=https://pass.itssteps.site/\n" > /etc/ton-access-pass/config.env
    systemctl daemon-reload
    if systemctl is-enabled --quiet ton-access-pass; then systemctl restart ton-access-pass; echo "Сервис перезапущен"; else echo "Сервис ещё не настроен: ton-access-pass-setup"; fi'

# Mini App: статика собирается рядом и подменяется целиком
COPYFILE_DISABLE=1 tar --no-xattrs -C app/dist -cf - . |
  "${SSH[@]}" 'set -e
    rm -rf /var/www/ton-access-pass.new && mkdir -p /var/www/ton-access-pass.new
    tar -C /var/www/ton-access-pass.new -xf -
    find /var/www/ton-access-pass.new -type d -exec chmod 755 {} + && find /var/www/ton-access-pass.new -type f -exec chmod 644 {} +
    rm -rf /var/www/ton-access-pass.old && mv /var/www/ton-access-pass /var/www/ton-access-pass.old && mv /var/www/ton-access-pass.new /var/www/ton-access-pass
    rm -rf /var/www/ton-access-pass.old
    echo "Mini App выложена"'
