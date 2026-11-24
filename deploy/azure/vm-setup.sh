#!/usr/bin/env bash
# One-time setup of an Ubuntu 22.04/24.04 Azure VM: Docker Engine, Compose plugin, basic hardening.
# Run as your admin user:  bash deploy/azure/vm-setup.sh
set -euo pipefail

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git postgresql-client unattended-upgrades

# Docker's official repository
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

# Automatic security updates
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "Done. Log out and back in (so 'docker' works without sudo), then follow docs/deploy-azure.md."
