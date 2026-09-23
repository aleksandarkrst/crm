#!/usr/bin/env bash
# One-time hardening + Docker install for a fresh Hetzner Cloud server (Ubuntu 24.04 LTS).
# Copy it to the server and run as root:  bash bootstrap.sh
# (Create the server with your SSH key in the Hetzner console; it is copied to the deploy user.)
#
# Result: a "deploy" user with Docker access, SSH keys only (no passwords, no root login),
# a firewall that allows nothing inbound except SSH (the Cloudflare Tunnel is outbound-only),
# automatic security updates and fail2ban.
set -euo pipefail

DEPLOY_USER=deploy
APP_DIR=/opt/crm

echo "==> packages"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades

echo "==> docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
JSON
systemctl restart docker

echo "==> deploy user"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"

echo "==> ssh hardening"
cat >/etc/ssh/sshd_config.d/99-hardening.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
CONF
systemctl reload ssh || systemctl reload sshd

echo "==> firewall (inbound: SSH only)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable
# Docker publishes ports by editing iptables directly and bypasses ufw. Our compose file
# publishes no ports, and the Hetzner Cloud Firewall (configure it in the console: allow
# TCP 22 only) is the outer layer that Docker cannot bypass.

echo "==> automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

cat <<EOF

Done. Next steps (docs/DEPLOYMENT.md):
  1. Log in as '$DEPLOY_USER' and clone the repository into $APP_DIR.
  2. Create $APP_DIR/.env from .env.example (chmod 600) and infra/backup/rclone.conf.
  3. Add the GitHub Actions secrets and push to main.
EOF
