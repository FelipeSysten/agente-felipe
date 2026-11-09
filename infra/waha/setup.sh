#!/usr/bin/env bash
# Instala Docker e sobe Waha + Caddy numa VM Ubuntu (Google Cloud e2-micro free tier,
# Oracle Always Free ou qualquer VPS; ARM ou x86).
# Idempotente: pode rodar de novo para atualizar.
# Uso: WAHA_API_KEY=... bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${WAHA_API_KEY:?defina WAHA_API_KEY}"

# 0. Swap de 2 GB: a e2-micro tem só 1 GB de RAM
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 1. Docker
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# 2. Firewall local: a imagem Ubuntu da Oracle bloqueia tudo exceto SSH via iptables.
#    No Google Cloud é no-op (lá quem libera 80/443 é a regra de firewall da VPC).
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save; fi

# 3. Domínio HTTPS grátis via sslip.io (resolve p/ o IP público da VM)
PUBLIC_IP="$(curl -fsS https://api.ipify.org)"
WAHA_DOMAIN="waha-${PUBLIC_IP//./-}.sslip.io"

# 4. .env (mantém a senha do dashboard entre execuções)
if [ -f .env ] && grep -q WAHA_DASHBOARD_PASSWORD .env; then
  DASH_PASS="$(grep WAHA_DASHBOARD_PASSWORD .env | cut -d= -f2-)"
else
  DASH_PASS="$(openssl rand -hex 16)"
fi
umask 077
cat > .env <<EOF
WAHA_API_KEY=${WAHA_API_KEY}
WAHA_DASHBOARD_PASSWORD=${DASH_PASS}
WAHA_DOMAIN=${WAHA_DOMAIN}
EOF
mkdir -p sessions

# 5. Sobe (sudo: o grupo docker só vale num novo login)
sudo docker compose pull
sudo docker compose up -d

echo "WAHA_BASE_URL=https://${WAHA_DOMAIN}"
