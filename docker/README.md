# Docker Services — docker/

Main service stack for the WMS pipeline. Runs PostgreSQL/PostGIS, GeoServer, PgBouncer, and Nginx as Docker containers.

---

## Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `postgis` | `postgis/postgis:16-3.4` | 5432 | PostgreSQL 16 + PostGIS 3.4 |
| `geoserver` | custom GeoServer 2.27.x | 8080 | WMS / WCS / REST API server |
| `pgbouncer` | `edoburu/pgbouncer` | 6432 | Connection pooler (transaction mode) |
| `web` | `nginx:alpine` | 80 | Reverse proxy + tile cache + static files |

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
- **JVM heap**: 24 GB (`-Xms24g -Xmx24g`)
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
| `/opt/geoserver/web` | `/usr/share/nginx/html` | web | Frontend HTML/JS |
| `/opt/geoserver/nginx/` | `/etc/nginx/conf.d/` | web | Nginx config files |
| `/opt/geoserver/monitoring/nginx_logs` | `/var/log/nginx` | web | Nginx access logs (consumed by Promtail) |

---

## Networking

All services share the `docker_default` bridge network. The monitoring stack (in `monitoring/`) joins this same network so Prometheus can scrape exporters by service name.

Internal hostnames:
- `postgis` — PostgreSQL
- `pgbouncer` — PgBouncer
- `geoserver` — GeoServer
- `web` — Nginx

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
| 80 | Nginx (web + proxy) | External |
| 8080 | GeoServer | Internal (proxied via Nginx) |
| 5432 | PostgreSQL | Host only |
| 6432 | PgBouncer | Host + containers |
