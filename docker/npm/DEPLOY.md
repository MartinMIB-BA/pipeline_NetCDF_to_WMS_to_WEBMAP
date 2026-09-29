# Deploy Nginx Proxy Manager (NPM) — runbook

Sets up **Nginx Proxy Manager** as the edge reverse proxy in front of the
existing `web` nginx container, and issues a Let's Encrypt certificate for
`metron.duckdns.org` via the **DuckDNS DNS-01 challenge**.

Server: `ubuntu@89.47.190.54` (hostname `coastal-wms`), repo at `/opt/geoserver`.
Docker Compose **v2** (`docker compose`, no hyphen).

---

## What changes

- `web` container **stops publishing host ports 80/443** (keeps 8082 for staging)
  and joins a new shared `edge` network.
- **NPM** takes host ports **80 / 443** (public) and **81** (admin GUI), and
  proxies `metron.duckdns.org` → `web:80` over `edge`.
- SSL moves from the (never-completed) `web` `/etc/letsencrypt` mount to NPM.

Nothing in the tuned GWC tile-cache config (`nginx/default.conf`) changes.

---

## ⚠️ Pre-flight notes (read once)

1. **Branch model.** Infra (`docker/`, `nginx/`, `scripts/`, `monitoring/`)
   lives on **`main`** and is deployed with `deploy.sh` (which merges
   `develop`→`main`, pushes, and pulls on the server at `/opt/geoserver`). The
   server's `/opt/geoserver` clone is on `main`. Do **not** push infra straight
   to `develop` and pull it on the server — that's what previously left the
   server stranded on `develop`. Always go through `deploy.sh`.
2. **Uncommitted paths on server.** `git status` on the server shows untracked
   `data` and `web/assets/`. A `git pull` is safe for those (untracked), but do
   **not** `git reset --hard` — you'd lose them.
3. **Brief downtime.** Between "recreate `web`" and "NPM is up", ports 80/443 are
   momentarily unbound. Expect ~10–30s where the site is unreachable. Do it in a
   maintenance window if that matters.
4. **Order matters.** `web` must release 80/443 **before** NPM starts, or NPM
   fails to bind. Follow the step order exactly.
5. **Firewall.** `ufw` is currently **inactive**, so port **81 (admin GUI) will
   be world-reachable** once NPM starts. Lock it down (see step 8).

---

## Step 0 — Commit the changes on `develop`

From your workstation, on the `develop` branch, commit the changed paths:

```bash
# on your machine, in the repo root (branch: develop)
git add README.md docker/README.md docker/docker-compose.yml docker/npm/
git commit -m "infra: add Nginx Proxy Manager edge proxy + move SSL to NPM"
```

Don't push/pull by hand — the next step uses the standard deploy script.

---

## Step 1 — Deploy to production with `deploy.sh`

```bash
# on your machine, in the repo root
./deploy.sh
```

This merges `develop`→`main`, pushes `main`, and runs `git pull origin main`
inside `/opt/geoserver` on the server (the `web` subdir it `cd`s into is part of
the same main clone, so the whole infra tree updates).

Confirm the new files arrived on the server:

```bash
ssh ubuntu@89.47.190.54
cd /opt/geoserver
git rev-parse --abbrev-ref HEAD   # -> main
ls docker/npm/                    # docker-compose.yml, DEPLOY.md, README.md
grep -A3 'networks:' docker/docker-compose.yml | tail -5
```

---

## Step 2 — Create the shared `edge` network

```bash
docker network create edge
```

(Idempotent-ish: if it already exists you'll get an error you can ignore.)

---

## Step 3 — Create NPM state directories

```bash
mkdir -p /opt/geoserver/npm/data /opt/geoserver/npm/letsencrypt
```

---

## Step 4 — Recreate `web` (releases 80/443, joins `edge`)

```bash
cd /opt/geoserver/docker
docker compose up -d web
```

Docker will recreate the `web` container with the new port/network config.
Verify it no longer holds 80/443 and is on both networks:

```bash
docker inspect web --format '{{json .NetworkSettings.Networks}}' | tr ',' '\n' | grep -o '"[a-z_]*_default\|edge"'
docker port web        # should show only 8082
ss -tlnp | grep -E ':80 |:443 ' || echo "80/443 now free ✅"
```

> If `web` fails to attach to `edge`, the network wasn't created — redo step 2.

---

## Step 5 — Start NPM (takes 80/443/81)

```bash
cd /opt/geoserver/docker/npm
docker compose up -d
docker compose logs -f nginx-proxy-manager   # watch until "Starting backend ..."; Ctrl-C to exit
```

Verify ports:

```bash
ss -tlnp | grep -E ':80 |:443 |:81 '          # all three should be LISTEN now
```

---

## Step 6 — First login to the admin GUI

Open `http://89.47.190.54:81`

- Default credentials: `admin@example.com` / `changeme`
- You'll be forced to set a **real email + strong password**. Do it now.

---

## Step 7 — Create the Proxy Host + SSL certificate

In the GUI:

1. **Hosts → Proxy Hosts → Add Proxy Host**
   - **Domain Names**: `metron.duckdns.org`
   - **Scheme**: `http`
   - **Forward Hostname / IP**: `web`
   - **Forward Port**: `80`
   - Enable **Block Common Exploits** and **Websockets Support** (optional).
2. **SSL tab**:
   - **SSL Certificate** → *Request a new SSL Certificate*
   - Toggle **Use a DNS Challenge** → **ON**
   - **DNS Provider**: `DuckDNS`
   - **Credentials file content**: paste exactly
     ```
     dns_duckdns_token=YOUR_DUCKDNS_TOKEN
     ```
     (Enter your real token here — it lives only in NPM, never in git.)
   - Optionally set **Propagation seconds** to `120` to reduce flakiness.
   - Agree to Let's Encrypt ToS → **Save**.
3. Enable **Force SSL** and **HTTP/2** after the cert issues.

> **Known DuckDNS quirk:** NPM's DuckDNS DNS-01 sometimes fails on the first try
> with a "clearing of the TXT record was not successful" error. If that happens,
> just **Save again** (retry). A longer propagation value (120s) usually fixes it.

---

## Step 8 — Lock down the admin port (recommended)

`ufw` is inactive, so port 81 is currently public. Restrict it to your IP (or
close it entirely and use an SSH tunnel when you need the GUI):

```bash
# option A: only allow your workstation IP to reach 81
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8082/tcp
sudo ufw allow from YOUR.IP.ADDR.ESS to any port 81 proto tcp
sudo ufw enable
```

Or, without enabling ufw, reach the GUI via an SSH tunnel and keep 81 firewalled
at the provider level:

```bash
ssh -L 8181:localhost:81 ubuntu@89.47.190.54
# then browse http://localhost:8181
```

---

## Step 9 — Verify end to end

From your workstation:

```bash
# DNS still points at the server
dig +short metron.duckdns.org        # -> 89.47.190.54

# ports open
nc -z -w5 metron.duckdns.org 443 && echo "443 OPEN ✅"

# the site loads over HTTPS with a valid cert (browser is the real test)
```

Open `https://metron.duckdns.org` in a browser — the WMS viewer should load with
a valid padlock. Tiles should serve from the existing GWC cache exactly as
before (NPM only fronts the same `web` upstream).

---

## Rollback

If something goes wrong and you need the old behavior (web directly on 80/443):

```bash
# stop NPM so it releases 80/443
cd /opt/geoserver/docker/npm && docker compose down

# revert the compose change and recreate web with 80/443
cd /opt/geoserver
git revert --no-edit <commit-sha-of-the-npm-change>   # or: git checkout HEAD~1 -- docker/docker-compose.yml
cd docker && docker compose up -d web
```

The `edge` network and `/opt/geoserver/npm` state can be left in place; they're
harmless when NPM isn't running. To fully clean up: `docker network rm edge`.
