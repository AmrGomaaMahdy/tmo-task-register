# Deploy to an Azure VM with Azure Database for PostgreSQL

```
Internet ──443──► VM (Ubuntu + Docker)                                   VNet 10.20.0.0/16
                   caddy (HTTPS, Let's Encrypt) ─► frontend (nginx) ─► backend (Django)
                                                                         │ private, TLS
                                                                         ▼
                                       Azure Database for PostgreSQL – Flexible Server (snet-db)
```

* The VM runs three containers from `docker-compose.azure.yml`: **caddy**, **frontend** and **backend**. There is no database container.
* The database is a managed Flexible Server in the same virtual network, with **private access only**: it has no public endpoint.
* Only ports 80 and 443 are open to the internet. SSH is open to your office IP only.

Commands use the Azure CLI (`az`), from your PC or from Cloud Shell. To do the same in the Azure Portal, step by step, see [deploy-azure-portal.md](deploy-azure-portal.md).

## 0. Variables

```bash
RG=rg-task-register
LOC=<region>                 # pick the region nearest you that offers both services
VNET=vnet-task-register
PG=pg-task-register-aicc     # must be globally unique
VM=vm-task-register
DNS=task-register-aicc       # gives https://task-register-aicc.<region>.cloudapp.azure.com
MYIP=$(curl -s https://ifconfig.me)   # your office/public IP, for SSH
```

## 1. Resource group and network

```bash
az group create -n $RG -l $LOC

az network vnet create -g $RG -n $VNET --address-prefix 10.20.0.0/16 \
  --subnet-name snet-vm --subnet-prefix 10.20.1.0/24

# Subnet reserved for PostgreSQL (delegated)
az network vnet subnet create -g $RG --vnet-name $VNET -n snet-db \
  --address-prefixes 10.20.2.0/24 --delegations Microsoft.DBforPostgreSQL/flexibleServers
```

## 2. Azure Database for PostgreSQL – Flexible Server

```bash
az postgres flexible-server create -g $RG -n $PG -l $LOC \
  --version 16 --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
  --admin-user taskadmin --admin-password '<strong-password>' \
  --vnet $VNET --subnet snet-db \
  --private-dns-zone $PG.private.postgres.database.azure.com \
  --backup-retention 14 --yes

az postgres flexible-server db create -g $RG -s $PG -d task_register
```

* **Size:** Burstable B1ms is enough for a pilot. Move to General Purpose (for example D2ds) and turn on zone-redundant high availability for production.
* **Backups:** automatic, with point-in-time restore for the retention period you set (here 14 days).
* **TLS:** required by default (`require_secure_transport=ON`). The app connects with `sslmode=require`.

> **Alternative (simpler, less private):** create the server with public access and add one firewall rule for the VM's public IP only.
> ```bash
> az postgres flexible-server create ... --public-access <VM-public-IP>
> ```

## 3. The VM

```bash
az vm create -g $RG -n $VM --image Ubuntu2404 --size Standard_B2s \
  --vnet-name $VNET --subnet snet-vm \
  --admin-username azureuser --generate-ssh-keys \
  --public-ip-sku Standard --public-ip-address-dns-name $DNS \
  --os-disk-size-gb 64

# Web ports open to everyone; SSH only from your IP
az vm open-port -g $RG -n $VM --port 80,443 --priority 900
az network nsg rule update -g $RG --nsg-name ${VM}NSG -n default-allow-ssh \
  --source-address-prefixes $MYIP/32
```

* **Size:** B2s (2 vCPU, 4 GB) is comfortable for this app. B2ms gives more headroom.
* Your app address is `https://$DNS.$LOC.cloudapp.azure.com`. To use your own domain (for example `tasks.alayuni.com`), create a DNS **A record** pointing to the VM's public IP and use that name as `APP_DOMAIN`.
* **Recommended:**
  * turn on **Azure Backup** for the VM;
  * use **Azure Bastion** instead of a public SSH port;
  * turn on **Microsoft Defender for Cloud**.

## 4. Prepare the VM

```bash
ssh azureuser@$DNS.$LOC.cloudapp.azure.com

git clone https://github.com/<owner>/<repo>.git task-register   # private repo: use a deploy key or a PAT
cd task-register
bash deploy/azure/vm-setup.sh       # installs Docker + Compose and automatic security updates
exit                                # log in again so docker works without sudo
```

Check that the VM reaches the database privately:

```bash
psql "host=<pg-name>.postgres.database.azure.com dbname=task_register user=taskadmin sslmode=require" -c "select version();"
```

## 5. Configure

```bash
cd ~/task-register
cp deploy/azure/.env.azure.example .env
chmod 600 .env
nano .env
```

Set:

* `APP_DOMAIN`: the VM's DNS name (or your own domain).
* `ACME_EMAIL`: an IT mailbox for certificate notices.
* `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: the server name (`<pg-name>.postgres.database.azure.com`), `task_register`, `taskadmin`, and its password exactly as written. No URL-encoding is needed. `DB_SSLMODE=require` is already set.
* `DJANGO_SECRET_KEY`: generate one with `python3 -c "import secrets; print(secrets.token_urlsafe(50))"`.
* `SEED_DEMO`: `true` only for a trial environment (and then set `DEMO_USER_PASSWORD`).
* `APP_STAGE`: `Under development` while piloting; empty or `off` hides the mark when live.
* `IMAGE_PREFIX` / `IMAGE_TAG`: `task-register` / `local` to build on the VM, or the GitHub images (option A below).
* Email (`EMAIL_*`) is optional here: it can also be set on **Administration › System settings**. `APP_PUBLIC_URL` defaults to `https://<APP_DOMAIN>`.

## 6. Start

**Option A: images from GitHub (recommended).** CI publishes them on every push to `main`.

```bash
echo <github-PAT-with-read:packages> | docker login ghcr.io -u <github-user> --password-stdin
docker compose -f docker-compose.azure.yml pull
docker compose -f docker-compose.azure.yml up -d
```

**Option B: build on the VM.** Set `IMAGE_PREFIX=task-register` and `IMAGE_TAG=local` in `.env`, then run:

```bash
docker compose -f docker-compose.azure.yml up -d --build
```

On first start the backend migrates the database and creates the roles. Caddy then gets the HTTPS certificate, which takes about a minute. To watch it:

```bash
docker compose -f docker-compose.azure.yml ps
docker compose -f docker-compose.azure.yml logs -f caddy backend
```

Create the first real administrator:

```bash
docker compose -f docker-compose.azure.yml exec backend python manage.py createsuperuser
```

Open `https://<APP_DOMAIN>` and sign in. Then, in the application:

* **Administration › User access:** give your account the **Admin** role, then add people with their email, roles and work groups.
* **Administration › System settings:** outgoing email, the email code at sign-in, password rules and automatic sign-out.

## 7. Microsoft Entra ID sign-in (optional)

1. Register an app in Entra ID with the redirect URI `https://<APP_DOMAIN>/oidc/callback/`.
2. Add the app roles listed in the README.
3. Assign the roles to users or groups.
4. Set `OIDC_ENABLED=true` and the three `OIDC_*` values in `.env`.
5. Run `docker compose -f docker-compose.azure.yml up -d`.

## 8. Updating

```bash
cd ~/task-register
git pull                                            # picks up compose or Caddy changes
docker compose -f docker-compose.azure.yml pull     # new images (option A)
docker compose -f docker-compose.azure.yml up -d    # migrations run automatically on start
# option B (build on the VM): docker compose -f docker-compose.azure.yml up -d --build
docker image prune -f
```

## 9. Application backups

Azure PostgreSQL already keeps automatic backups. As a second, portable copy, schedule the app's own backup on the VM, for example every night at 02:00 with 30 days kept:

```bash
mkdir -p ~/backups && chmod 700 ~/backups
crontab -e
```

Then add this line to the crontab:

```
0 2 * * * cd ~/task-register && docker compose -f docker-compose.azure.yml exec -T backend python manage.py export_data -o - > ~/backups/task-register-$(date +\%F).json && find ~/backups -name 'task-register-*.json' -mtime +30 -delete
```

Copy the files off the VM as well, for example to an Azure Storage account with `azcopy`, or download them from the **Backup & restore** page. To restore, use that page, or run:

```bash
docker compose -f docker-compose.azure.yml exec -T backend python manage.py import_data - --yes < ~/backups/<file>.json
```

## 10. Operations checklist

- [ ] SSH limited to your IP, or Bastion only; only ports 80 and 443 open
- [ ] PostgreSQL with private access, backups of 14 days or more, and a restore tested once
- [ ] `.env` readable only by the admin user (`chmod 600`), and secrets also kept in Azure Key Vault
- [ ] `SEED_DEMO=false` and trial users removed in production; `APP_STAGE` empty or `off` when live
- [ ] Azure Backup on the VM; Defender for Cloud on
- [ ] Nightly application backup scheduled and copied off the VM
- [ ] Cost alert on the resource group

## Troubleshooting

| Symptom | Check |
|---|---|
| No certificate / browser warning | DNS name points to the VM; ports 80 and 443 are open in the NSG; `docker compose ... logs caddy` |
| Backend restarting | `docker compose ... logs backend`: the log says what is wrong; usually `DB_HOST`, `DB_USER` or `DB_PASSWORD` does not match the server's admin login |
| `could not translate host name` | The VM and the database must be in the same VNet, with the private DNS zone linked to it |
| 400 Bad Request | `APP_DOMAIN` must match the address in the browser exactly |
| 403 CSRF on sign-in | You opened the app by a different name or by IP; use `https://<APP_DOMAIN>` |
