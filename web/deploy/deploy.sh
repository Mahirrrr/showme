#!/usr/bin/env bash
# Build web/ locally and push web/dist + vision/ + shared/ to the Vultr box.
# Usage (from the repo root):  web/deploy/deploy.sh root@<server-ip>
# Secrets are NOT copied: /etc/showme/vision.env is edited on the server.
set -euo pipefail
HOST="${1:?usage: web/deploy/deploy.sh root@<server-ip>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP=/srv/showme/app

echo "==> build web"
(cd "$ROOT/web" && npm run build >/dev/null)

echo "==> sync code"
ssh "$HOST" "mkdir -p $APP/web/dist $APP/vision $APP/shared"
rsync -az --delete "$ROOT/web/dist/"  "$HOST:$APP/web/dist/"
rsync -az --delete --exclude '.venv' --exclude '__pycache__' --exclude '.env' --exclude '.pytest_cache' \
  "$ROOT/vision/" "$HOST:$APP/vision/"
rsync -az --delete "$ROOT/shared/" "$HOST:$APP/shared/"
rsync -az "$ROOT/web/deploy/nginx-showme.conf"     "$HOST:/etc/nginx/conf.d/showme.conf"
rsync -az "$ROOT/web/deploy/showme-vision.service" "$HOST:/etc/systemd/system/showme-vision.service"

echo "==> install deps, restart"
ssh "$HOST" 'set -e
chown -R showme:showme /srv/showme
[ -x /srv/showme/venv/bin/python ] || sudo -u showme python3.12 -m venv /srv/showme/venv
sudo -u showme /srv/showme/venv/bin/pip install -q --upgrade pip
sudo -u showme /srv/showme/venv/bin/pip install -q -r /srv/showme/app/vision/requirements.txt
# SELinux (enforcing): venv binaries must be bin_t for systemd to exec them,
# and the static build httpd_sys_content_t for nginx to read it.
FC=$(semanage fcontext -l)
echo "$FC" | grep -F "/srv/showme/venv/bin" >/dev/null || semanage fcontext -a -t bin_t "/srv/showme/venv/bin(/.*)?"
echo "$FC" | grep -F "/srv/showme/app/web/dist" >/dev/null || semanage fcontext -a -t httpd_sys_content_t "/srv/showme/app/web/dist(/.*)?"
restorecon -R /srv/showme
chmod o+x /srv /srv/showme /srv/showme/app /srv/showme/app/web
systemctl daemon-reload
systemctl enable --now showme-vision >/dev/null
systemctl restart showme-vision
nginx -t -q && systemctl enable --now nginx >/dev/null && systemctl reload nginx
sleep 2
systemctl is-active showme-vision
curl -fsS http://127.0.0.1/api/health; echo'
echo "==> done: http://${HOST#*@}/"
