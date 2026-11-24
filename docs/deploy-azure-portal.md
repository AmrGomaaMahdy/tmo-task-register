# Deploy to an Azure VM with Azure Database for PostgreSQL — using the Azure Portal

The same setup as [deploy-azure.md](deploy-azure.md), done by clicking in the Azure Portal
(<https://portal.azure.com>) instead of the Azure CLI. Only the part on the VM itself uses commands.

Two layouts:

* **Part A (sections 1–11): the database on Azure Database for PostgreSQL.** Azure runs, patches and backs up
  the database. Recommended for production.
* **[Part B](#part-b--everything-on-one-vm): everything on one VM**, PostgreSQL in a container next to the
  application. Cheaper and simpler; you look after the database's backups yourself.

```
Internet ──443──► VM (Ubuntu + Docker)                                   VNet 10.20.0.0/16
                   caddy (HTTPS) ─► frontend (nginx) ─► backend (Django)   snet-vm 10.20.1.0/24
                                                          │ private, TLS
                                                          ▼
                        Azure Database for PostgreSQL – Flexible Server    snet-db 10.20.2.0/24
```

Names used below (change them if you like, but keep them the same throughout):

| What | Name |
|---|---|
| Resource group | `rg-task-register` |
| Virtual network | `vnet-task-register` |
| PostgreSQL server | `pg-task-register-aicc` (must be unique in Azure) |
| Database | `task_register` |
| VM | `vm-task-register` |
| DNS label | `task-register-aicc` |

**Region:** use one region for everything, and one that offers both Virtual Machines and Azure Database for
PostgreSQL – Flexible Server (the server's *Create* page lists only the regions that offer it). If company data
must stay in Saudi Arabia, check with compliance and pick **Saudi Arabia East** when it is offered.

---

## 1. Resource group

1. Search for **Resource groups** → **+ Create**.
2. Subscription: yours. Resource group: `rg-task-register`. Region: your region.
3. **Review + create** → **Create**.

## 2. Virtual network with two subnets

1. Search for **Virtual networks** → **+ Create**.
2. **Basics:** resource group `rg-task-register`, name `vnet-task-register`, your region.
3. **IP addresses:** address space `10.20.0.0/16`. Delete the `default` subnet, then **+ Add a subnet** twice:
   * `snet-vm`: starting address `10.20.1.0`, size `/24`.
   * `snet-db`: starting address `10.20.2.0`, size `/24`. Under **Subnet delegation**, choose
     **Microsoft.DBforPostgreSQL/flexibleServers**.
4. **Review + create** → **Create**.

## 3. Azure Database for PostgreSQL – Flexible Server

1. Search for **Azure Database for PostgreSQL flexible servers** → **+ Create**.
2. **Basics**
   * Resource group `rg-task-register`; server name `pg-task-register-aicc`; your region.
   * PostgreSQL version: **16**.
   * Workload type: **Development** for a pilot, **Production** for live use.
   * **Compute + storage → Configure server:**
     * pilot: Burstable, **Standard_B1ms**, 32 GiB;
     * production: General Purpose, **Standard_D2ds_v5** (or larger), and **High availability: zone-redundant**;
     * **Backup retention period: 14 days** or more → **Save**.
   * Authentication: **PostgreSQL authentication only**. Admin username `taskadmin` and a strong password.
     Keep it: it goes into `.env` later.
3. **Networking**
   * Connectivity method: **Private access (VNet Integration)**.
   * Virtual network `vnet-task-register`, subnet `snet-db`.
   * Private DNS zone: let it create a new one (`pg-task-register-aicc.private.postgres.database.azure.com`).
4. **Security:** leave the defaults (data encrypted with a service-managed key).
5. **Review + create** → **Create**. It takes 5–10 minutes.
6. When it is ready, open the server → **Settings → Databases** → **+ Add** → name `task_register` → **Save**.
7. Check **Settings → Server parameters**: `require_secure_transport` is **ON** (the default). Leave it on.

> **Simpler but less private:** choose **Public access (allowed IP addresses)** in step 3 instead, and later add
> a firewall rule for the VM's public IP only (**Networking → + Add firewall rule**). Do not use
> *Allow public access from any Azure service*.

## 4. The virtual machine

1. Search for **Virtual machines** → **+ Create → Azure virtual machine**.
2. **Basics**
   * Resource group `rg-task-register`; name `vm-task-register`; your region.
   * Availability options: **No infrastructure redundancy required** (pilot) or an availability zone.
   * Security type: **Trusted launch virtual machines**.
   * Image: **Ubuntu Server 24.04 LTS – x64 Gen2**.
   * Size: **Standard_B2s** (2 vCPU, 4 GiB). B2ms gives more headroom.
   * Authentication type: **SSH public key**; username `azureuser`; *Generate new key pair* (download the
     `.pem` file when asked, and keep it safe) or use your existing public key.
   * Public inbound ports: **Allow selected ports** → **SSH (22)**, **HTTP (80)**, **HTTPS (443)**.
     SSH is narrowed to your office address in step 5.
3. **Disks:** OS disk size **64 GiB**, type **Premium SSD** (or Standard SSD for a pilot).
4. **Networking**
   * Virtual network `vnet-task-register`, subnet `snet-vm`.
   * Public IP: *(new)*, SKU **Standard**.
   * NIC network security group: **Basic**, with the same ports 22, 80 and 443.
5. **Management:** turn on **Enable backup** (Azure Backup, daily policy); leave auto-shutdown **off**.
6. **Review + create** → **Create** (download the private key if you generated one).

## 5. Address and SSH access

1. **DNS name:** open the VM → **Overview → DNS name: Not configured** (or open its public IP resource →
   **Settings → Configuration**) → DNS name label `task-register-aicc` → **Save**. The address becomes
   `task-register-aicc.<region>.cloudapp.azure.com`.
   **Own domain** (for example `tasks.al-ayuni.com`): at your DNS provider, add an **A record** pointing to the
   VM's public IP, and use that name as `APP_DOMAIN`.
2. **SSH only from your office:** VM → **Networking → Network settings** → inbound rule **SSH** →
   Source **IP Addresses**, your office's public IP (`x.x.x.x/32`) → **Save**.
   Better: remove the SSH rule and connect with **Azure Bastion** (VM → **Connect → Bastion**).

## 6. Prepare the VM

Connect with SSH (VM → **Connect → SSH** shows the command), or with Bastion:

```bash
ssh -i <key>.pem azureuser@task-register-aicc.<region>.cloudapp.azure.com

git clone https://github.com/<owner>/<repo>.git task-register   # private repo: a deploy key or a PAT
cd task-register
bash deploy/azure/vm-setup.sh     # Docker, Compose, psql client, automatic security updates
exit                              # sign in again so docker works without sudo
```

Check that the VM reaches the database (private address, TLS):

```bash
psql "host=pg-task-register-aicc.postgres.database.azure.com dbname=task_register user=taskadmin sslmode=require" -c "select version();"
```

## 7. Configure the application

```bash
cd ~/task-register
cp deploy/azure/.env.azure.example .env
chmod 600 .env
nano .env
```

| Setting | Value |
|---|---|
| `APP_DOMAIN` | `task-register-aicc.<region>.cloudapp.azure.com`, or your own domain |
| `ACME_EMAIL` | an IT mailbox, for certificate notices |
| `DB_HOST` | `pg-task-register-aicc.postgres.database.azure.com` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | `task_register` / `taskadmin` / the admin password, exactly as typed (wrap it in single quotes if it contains `$`) |
| `DB_SSLMODE` | `require` (already set) |
| `DJANGO_SECRET_KEY` | generate: `python3 -c "import secrets; print(secrets.token_urlsafe(50))"`; keep a copy in Key Vault |
| `SEED_DEMO` | `false` in production (`true` only for a trial, with `DEMO_USER_PASSWORD`) |
| `INITIAL_USER_PASSWORD` | first password of the accounts created from the member list (optional) |
| `APP_STAGE` | `Under development` while piloting; empty or `off` when live |
| `IMAGE_PREFIX` / `IMAGE_TAG` | `task-register` / `local` to build on the VM; or `ghcr.io/<owner>/<repo>` / `latest` for images from GitHub |
| `EMAIL_*`, `DEFAULT_FROM_EMAIL` | optional: email can also be set later on **Administration › System settings** |
| `APP_PUBLIC_URL` | leave empty: it becomes `https://<APP_DOMAIN>` |
| `OIDC_*` | only for Microsoft Entra ID sign-in |

## 8. Start

Build on the VM:

```bash
docker compose -f docker-compose.azure.yml up -d --build
```

Or use the images GitHub builds on every push to `main`:

```bash
echo <github-PAT-with-read:packages> | docker login ghcr.io -u <github-user> --password-stdin
docker compose -f docker-compose.azure.yml pull
docker compose -f docker-compose.azure.yml up -d
```

On the first start the backend creates the tables, the roles and the work groups; then Caddy gets the HTTPS
certificate (about a minute). Follow it with:

```bash
docker compose -f docker-compose.azure.yml ps
docker compose -f docker-compose.azure.yml logs -f backend caddy
```

## 9. First administrator and settings

```bash
docker compose -f docker-compose.azure.yml exec backend python manage.py createsuperuser
```

Open `https://<APP_DOMAIN>`, sign in, and in the application:

1. **Administration › User access:** give the new account the **Admin** role; add the TMO officers, the
   leaders, Focal Points and members with their email and roles.
2. **Administration › System settings:** outgoing email (with a test message), the email code at sign-in,
   password expiry and length, automatic sign-out.
3. **Administration › Reference data:** check the work groups, their leaders, directions and lists.

## 10. Protect and watch

In the Portal:

* **Microsoft Defender for Cloud → Environment settings →** your subscription → turn on the plans for
  **Servers** and **Open-source relational databases**.
* **Key Vault** (optional): keep `DJANGO_SECRET_KEY`, the database password and the SMTP password there.
* **Cost Management → Budgets → + Add**: a monthly budget on `rg-task-register` with an email alert.
* PostgreSQL server → **Monitoring → Alerts**: for example CPU > 80 % or storage > 80 %.
* VM → **Backup**: check the first backup ran.

On the VM, schedule the nightly application backup (section 9 of [deploy-azure.md](deploy-azure.md)) and copy
the files off the VM.

## 11. Updating

```bash
cd ~/task-register
git pull
docker compose -f docker-compose.azure.yml up -d --build     # or: pull, then up -d
docker image prune -f
```

Migrations run automatically when the backend starts.

## Checklist before going live

- [ ] SSH only from your office IP, or Bastion only; only ports 80 and 443 open to the internet
- [ ] PostgreSQL on private access, backups 14 days or more, one restore tested
- [ ] `.env` readable only by the admin user (`chmod 600`); secrets also in Key Vault
- [ ] `SEED_DEMO=false`; trial users removed; `APP_STAGE` empty or `off` when live
- [ ] Azure Backup on the VM, Defender for Cloud on, a budget alert on the resource group
- [ ] Nightly application backup scheduled and copied off the VM

Troubleshooting: see the table at the end of [deploy-azure.md](deploy-azure.md).


---

# Part B – everything on one VM

Frontend, backend **and PostgreSQL** on one Ubuntu VM, each in its own container. PostgreSQL is reachable only
inside the VM (no port is opened for it), and its files sit on a separate **data disk**, so the database
survives a rebuilt VM and can be snapshotted on its own.

```
Internet ──443──► VM (Ubuntu + Docker)
                   caddy (HTTPS) ─► frontend (nginx) ─► backend (Django) ─► db (PostgreSQL 16)
                                                                              │
                                                     data disk /datadisk ◄────┘ (/datadisk/postgres)
```

**What changes compared with Part A:** no PostgreSQL server or database subnet in Azure; one more disk on the
VM; one more compose file (`docker-compose.azure-db.yml`); and backups are yours: Azure Backup of the VM
(both disks) plus a nightly database dump copied to an Azure Storage account.

| Size | VM | Data disk |
|---|---|---|
| Pilot (up to ~50 users) | **Standard_B2ms** (2 vCPU, 8 GiB) | 64 GiB Premium SSD |
| Production (all 13 groups) | **Standard_D2s_v5** or **D4s_v5** | 128 GiB Premium SSD |

B2s (4 GiB) is too small once PostgreSQL shares the VM.

## B1. Resource group and network

1. **Resource groups → + Create**: `rg-task-register`, your region.
2. **Virtual networks → + Create**: `vnet-task-register`, address space `10.20.0.0/16`, one subnet
   `snet-vm` `10.20.1.0/24` (no database subnet is needed).

## B2. The VM, with a data disk

**Virtual machines → + Create → Azure virtual machine**:

1. **Basics:** as in section 4 of Part A (Ubuntu Server 24.04 LTS, SSH key, user `azureuser`, ports 22, 80,
   443), but size **Standard_B2ms** or larger (table above).
2. **Disks:** OS disk 64 GiB Premium SSD. Under **Data disks → Create and attach a new disk**: name
   `vm-task-register-data`, **Premium SSD**, 64 GiB (or 128 GiB), **Host caching: Read-only** → **OK**.
3. **Networking:** `vnet-task-register`, subnet `snet-vm`, a new **Standard** public IP, NSG **Basic** with
   22, 80 and 443.
4. **Management:** **Enable backup** on (daily policy; it covers the data disk too). Auto-shutdown **off**.
5. **Review + create → Create**.

Then, as in section 5 of Part A: set the **DNS name label** (or your own domain's A record), and limit **SSH**
to your office IP (or use Bastion).

## B3. Storage account for off-VM backups

1. **Storage accounts → + Create**: resource group `rg-task-register`, a unique name in lower-case letters
   and digits such as `sttaskregisterbkp`, your region, **Standard**, redundancy **ZRS** or **GRS**.
2. **Data protection:** turn on **soft delete for blobs** (14 days).
3. Create it, then **Data storage → Containers → + Container**: `backups`, access level **Private**.
4. Open the container → **Shared access tokens**: permissions **Create** and **Write** only (not Read or
   Delete), expiry one year, **Generate SAS token and URL**. Copy the **Blob SAS URL**: the VM uses it to upload.
5. Optional but recommended: **Data management → Lifecycle management**, a rule deleting blobs older than 90
   days.

## B4. Prepare the VM and the data disk

SSH in (VM → **Connect → SSH**), then:

```bash
git clone https://github.com/<owner>/<repo>.git task-register && cd task-register
bash deploy/azure/vm-setup.sh          # Docker, Compose, psql client, automatic security updates

# The data disk: find it (the 64 or 128 GiB disk with no partitions, usually /dev/sdc), then format and mount it.
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT
sudo parted /dev/sdc --script mklabel gpt mkpart primary ext4 0% 100%
sudo mkfs.ext4 -L tr-data /dev/sdc1
sudo mkdir -p /datadisk
echo 'LABEL=tr-data /datadisk ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab
sudo mount -a && df -h /datadisk
sudo mkdir -p /datadisk/postgres

# azcopy, for the off-VM backup copy
curl -sL https://aka.ms/downloadazcopy-v10-linux | tar -xz
sudo cp ./azcopy_linux_amd64_*/azcopy /usr/local/bin/ && rm -rf azcopy_linux_amd64_*
exit                                   # sign in again so docker works without sudo
```

Check the device name before `parted`: it erases that disk. `nofail` lets the VM start even if the disk is
missing.

## B5. Configure

```bash
cd ~/task-register
cp deploy/azure/.env.azure.example .env && chmod 600 .env
nano .env
```

As in section 7 of Part A, with these differences:

| Setting | Value |
|---|---|
| `DB_HOST` | leave empty (the second compose file points the backend at the database container anyway) |
| `DB_NAME` | `task_register` |
| `DB_USER` | `task_register` |
| `DB_PASSWORD` | a new strong password, made up now; generate one with `python3 -c "import secrets; print(secrets.token_urlsafe(24))"` |
| `PG_DATA_DIR` | add the line `PG_DATA_DIR=/datadisk/postgres` |

`APP_DOMAIN`, `ACME_EMAIL`, `DJANGO_SECRET_KEY`, `SEED_DEMO=false`, `APP_STAGE` and the rest are as in Part A.
Keep `DB_PASSWORD` and `DJANGO_SECRET_KEY` in Key Vault or your password manager too: a restore needs them.

## B6. Start

Always name **both** compose files:

```bash
docker compose -f docker-compose.azure.yml -f docker-compose.azure-db.yml up -d --build
docker compose -f docker-compose.azure.yml -f docker-compose.azure-db.yml ps
docker compose -f docker-compose.azure.yml -f docker-compose.azure-db.yml logs -f db backend caddy
```

To save typing, add an alias to `~/.bashrc`:

```bash
echo "alias dc='docker compose -f ~/task-register/docker-compose.azure.yml -f ~/task-register/docker-compose.azure-db.yml'" >> ~/.bashrc && source ~/.bashrc
```

PostgreSQL starts first and creates the database; the backend creates the tables, roles and work groups; Caddy
gets the HTTPS certificate. Then the first administrator, as in section 9 of Part A:

```bash
dc exec backend python manage.py createsuperuser
```

## B7. Backups (your job in this layout)

1. Save the SAS URL from B3 on the VM, readable only by you:

   ```bash
   echo '<Blob SAS URL>' > ~/.backup-sas && chmod 600 ~/.backup-sas
   ```

2. Try the backup once, then schedule it every night at 02:00 (30 days kept on the VM):

   ```bash
   ~/task-register/deploy/azure/backup-local-db.sh
   (crontab -l 2>/dev/null; echo "0 2 * * * $HOME/task-register/deploy/azure/backup-local-db.sh >> $HOME/backups/backup.log 2>&1") | crontab -
   ```

   Each night it writes a full database dump and the application's own export to `~/backups`, and copies both
   to the `backups` container. Check them in the Portal: storage account → **Containers → backups**.

3. Azure Backup (B2) also keeps daily snapshots of the whole VM, data disk included.

**Restore** the database from a dump (stops the application for a minute):

```bash
dc stop backend frontend
dc exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < ~/backups/task-register-db-<date>.dump
dc start backend frontend
```

Or restore the application export from the **Backup & restore** page. Test a restore once before going live.

## B8. Updating

```bash
cd ~/task-register && git pull
dc up -d --build && docker image prune -f
```

PostgreSQL keeps its data on `/datadisk/postgres`. Before a major PostgreSQL upgrade (16 to 17), take a dump
first: the new version cannot open the old files directly.

## B9. Protect and watch

As section 10 of Part A (Defender for Cloud for **Servers**, a budget, Key Vault), and in the Portal:

* VM → **Monitoring → Alerts**: CPU > 80 % for 15 minutes; and **OS disk / data disk** free space, using the
  Azure Monitor Agent (VM → **Monitoring → Insights → Enable**).
* Storage account → **Monitoring → Alerts**: no new blob in 26 hours, as a sign the nightly backup stopped.

## Checklist before going live (Part B)

- [ ] VM size B2ms or larger; PostgreSQL files on the data disk (`df -h /datadisk` shows them)
- [ ] No port open for PostgreSQL; only 80 and 443 open to the internet; SSH from your IP or Bastion only
- [ ] `.env` `chmod 600`; `DB_PASSWORD` and `DJANGO_SECRET_KEY` also in Key Vault
- [ ] Nightly backup runs and reaches the storage account; one restore tested
- [ ] Azure Backup on the VM; Defender for Cloud on; budget and disk alerts set
- [ ] `SEED_DEMO=false`; `APP_STAGE` empty or `off` when live
