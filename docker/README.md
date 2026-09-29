# Docker Services — docker/

Main service stack for the WMS pipeline. Runs PostgreSQL/PostGIS, GeoServer, PgBouncer, and Nginx as Docker containers.

---

## Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `postgis` | `postgis/postgis:16-3.4` | 5432 | PostgreSQL 16 + PostGIS 3.4 |
| `geoserver` | `docker.osgeo.org/geoserver:2.27.x` | 8080 | WMS / WCS / REST API server |
| `pgbouncer` | `edoburu/pgbouncer` | 6432 | Connection pooler (transaction mode) |
| `web` | `nginx:alpine` | 8082 | Reverse proxy + tile cache + static files (prod fronted by NPM) |
| `nginx-proxy-manager` | `jc21/nginx-proxy-manager` | 80, 443, 81 | Edge reverse proxy + Let's Encrypt SSL (separate compose in `npm/`) |

---

## Starting the Stack

```bash
cd docker
docker-compose up -d
```

Check all services are healthy:

```bash
docker-compose ps
docker-compose logs -f geoserver
```

---

## Service Details

### postgis

PostgreSQL 16 with the PostGIS spatial extension.

- **Data volume**: `/opt/geoserver/data/postgis_data` → `/var/lib/postgresql/data`
- **Max connections**: 200
- **Shared buffers**: 8 GB
- **Database**: `gis`
- **User**: `gisadmin` / password from environment

### geoserver

GeoServer with ImageMosaic support. Handles all WMS, WCS, and WFS requests.

- **Data volume**: `/opt/geoserver/data/geoserver_data` → `/opt/geoserver/data_dir`
- **Uploads volume**: `/opt/geoserver/data/uploads` → `/opt/geoserver/uploads`
- **JVM heap**: 12–24 GB (`-Xms12G -Xmx24G`)
- **GC**: G1GC (`-XX:+UseG1GC`)
- **Parallel threads**: 8
- **Admin UI**: `http://localhost:8080/geoserver`
- **Default credentials**: `admin` / `geoserver` (change in production)

GeoServer connects to PostgreSQL **via PgBouncer** (hostname `pgbouncer`, port `6432`) to pool connections efficiently.

### pgbouncer

Connection pool that sits between GeoServer and PostgreSQL.

- **Default pool size**: 100 connections
- **Max clients**: 500
- **Mode**: transaction pooling
- **Port**: 6432

### web (Nginx)

Reverse proxy with GeoWebCache tile caching.

- **Static files**: serves frontend from `/opt/geoserver/web`
- **Proxy**: forwards `/geoserver/...` to GeoServer on port 8080
- **Tile cache**: 7-day TTL for GWC tile responses, `stale-while-revalidate` enabled
- **Cache zone**: 20 MB keys, 2 GB max size
- **CORS headers**: added for all GeoServer responses
- **Buffer tuning**: supports responses up to 500 MB for large NetCDF-derived tiles

---

## Volume Mounts

All data is stored outside containers on the host under `/opt/geoserver/`:

| Host path | Container path | Service | Contents |
|-----------|---------------|---------|---------|
| `/opt/geoserver/data/postgis_data` | `/var/lib/postgresql/data` | postgis | PostgreSQL data files |
| `/opt/geoserver/data/geoserver_data` | `/opt/geoserver/data_dir` | geoserver | GeoServer config, stores, styles |
| `/opt/geoserver/data/uploads` | `/opt/geoserver/uploads` | geoserver | GeoTIFF inputs from pipeline |
| `/opt/geoserver/web` | `/usr/share/nginx/html` | web | Frontend HTML/JS (production) |
| `/opt/geoserver/web_dev/web` | `/usr/share/nginx/html_dev` | web | Frontend HTML/JS (staging) |
| `/opt/geoserver/nginx/default.conf` | `/etc/nginx/conf.d/default.conf` | web | Nginx production config |
| `/opt/geoserver/nginx/staging.conf` | `/etc/nginx/conf.d/staging.conf` | web | Nginx staging config |
| `/opt/geoserver/nginx/nginx.conf` | `/etc/nginx/nginx.conf` | web | Nginx main config |
| `/opt/geoserver/monitoring/nginx_logs` | `/var/log/nginx` | web | Nginx access logs (consumed by Promtail) |
| `/opt/geoserver/data/nginx_cache` | `/var/cache/nginx/gwc_cache` | web | GWC tile cache |

> SSL is no longer handled by `web`; the old `/etc/letsencrypt` mount was
> removed. Certificates now live in the NPM container (see below).

---

## Networking

Most services share the `docker_default` bridge network. The monitoring stack (in `monitoring/`) joins this same network so Prometheus can scrape exporters by service name.

Internal hostnames:
- `postgis` — PostgreSQL
- `pgbouncer` — PgBouncer
- `geoserver` — GeoServer
- `web` — Nginx

The `web` container additionally joins the shared **`edge`** network, where
Nginx Proxy Manager reaches it by the hostname `web` (target `web:80`). The
`edge` network is external and must be created once on the host:

```bash
docker network create edge
```

---

## Nginx Proxy Manager (edge proxy + SSL)

Public traffic on ports 80/443 is handled by **Nginx Proxy Manager (NPM)**,
defined in a separate compose file at [`docker/npm/docker-compose.yml`](npm/docker-compose.yml).
It terminates TLS and reverse-proxies `metron.duckdns.org` to the `web`
container over the `edge` network. This keeps the tuned GWC tile-cache config in
`web` untouched — NPM simply sits in front of it.

**Why NPM is separate:** it owns the host's 80/443, has its own lifecycle, and
its state (config DB + issued certs) is independent of the data stack.

- **Admin GUI**: `http://<server>:81` (first login `admin@example.com` /
  `changeme` — change immediately).
- **State volumes**: `/opt/geoserver/npm/data` and `/opt/geoserver/npm/letsencrypt`.
- **SSL**: Let's Encrypt via **DNS-01 challenge, DuckDNS provider**. The DuckDNS
  token is entered in the GUI (`dns_duckdns_token=...`) and is **never** stored
  in this repo.

Start NPM (after creating the `edge` network):

```bash
cd docker/npm
docker compose up -d
```

Then in the GUI create a Proxy Host for `metron.duckdns.org` forwarding to
`http` → `web` → port `80`, and request an SSL certificate using the DNS
challenge. See the deployment steps in the project root README / runbook.

---

## Configuration

GeoServer and PgBouncer credentials are passed via environment variables in `docker-compose.yml`. Override them with a `.env` file in the `docker/` directory:

```dotenv
POSTGRES_PASSWORD=yourpassword
GEOSERVER_ADMIN_PASSWORD=yourpassword
```

---

## Common Operations

**Restart a single service:**
```bash
docker-compose restart geoserver
```

**View logs:**
```bash
docker-compose logs -f geoserver
docker-compose logs -f postgis
```

**Shell into GeoServer:**
```bash
docker-compose exec geoserver bash
```

**Shell into PostgreSQL:**
```bash
docker-compose exec postgis psql -U gisadmin -d gis
```

**Stop everything:**
```bash
docker-compose down
```

**Stop and remove volumes (destructive — deletes all data):**
```bash
docker-compose down -v
```

---

## Ports Summary

| Port | Service | Accessible from |
|------|---------|----------------|
| 80 | Nginx Proxy Manager (HTTP) | External |
| 443 | Nginx Proxy Manager (HTTPS) | External |
| 81 | Nginx Proxy Manager (admin GUI) | External |
| 8082 | Nginx `web` (staging) | External |
| 8080 | GeoServer | Internal (proxied via Nginx) |
| 5432 | PostgreSQL | Host only |
| 6432 | PgBouncer | Host + containers |

> The `web` container serves production traffic on port 80 **internally only**
> (over the `edge` network to NPM); it is no longer published on the host.
