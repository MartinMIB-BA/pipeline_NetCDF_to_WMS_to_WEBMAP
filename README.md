# WMS Sea-Level Forecast Pipeline

An automated pipeline that ingests NetCDF sea-level forecast data from JRC-FLOODS, converts it to GeoTIFFs, and publishes it as WMS layers via GeoServer. Includes a Leaflet-based map viewer, full observability stack, and a cron-driven scheduling system.

---

## Architecture Overview

```
JRC-FLOODS FTP
      │
      ▼
┌─────────────────────────────────────────────────────┐
│                 Python Pipeline                     │
│  run_all_wms.py ──► workers/static_wms.py           │
│                 ──► workers/video_wms.py            │
│                 ──► workers/points_wms.py           │
│                                                     │
│  NetCDF ──► GeoTIFF ──► GeoServer ImageMosaic       │
│                    ──► PostgreSQL tracking          │
└─────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────┐
│                  Docker Stack                       │
│  GeoServer (WMS/WCS) ◄── PgBouncer ◄── PostgreSQL  │
│  Nginx (reverse proxy + tile cache)                 │
│  Frontend (Leaflet map viewer)                      │
└─────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────┐
│              Monitoring Stack                       │
│  Prometheus ──► Grafana dashboards                  │
│  Loki ──► log aggregation (nginx, containers)       │
│  Exporters: node, postgres, pgbouncer, nginx        │
└─────────────────────────────────────────────────────┘
```

---

## Repository Layout

```
.
├── docker/             Docker Compose for main services
├── scripts/            Python pipeline (NetCDF → GeoTIFF → GeoServer)
│   ├── lib/            Shared modules (config, download, geoserver, postgis, tracking)
│   ├── workers/        Specialized processors (static, video, points)
│   └── run_all_wms.py  Main orchestrator entry point
├── web/                Leaflet map viewer
├── nginx/              Nginx reverse proxy configuration
└── monitoring/         Prometheus / Grafana / Loki observability stack
```

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Python 3.12+ with conda
- Access to JRC-FLOODS FTP (or local NetCDF files)

### 1 — Start the service stack

```bash
cd docker
docker-compose up -d
```

Services started:
| Service | Port | Description |
|---------|------|-------------|
| GeoServer | 8080 | WMS / WCS server |
| PostgreSQL | 5432 | PostGIS database |
| PgBouncer | 6432 | Connection pooler |
| Nginx | 80 | Reverse proxy + tile cache |

### 2 — Set up the Python pipeline

```bash
cd scripts
conda create -n wms python=3.12
conda activate wms
pip install -r requirements.txt
cp .env.example .env   # fill in credentials
```

### 3 — Initialize the tracking database

```bash
python -c "from lib.tracking import initialize_tracking_db; initialize_tracking_db()"
```

### 4 — Run the pipeline

```bash
# Single run (auto-discovers new files from JRC-FLOODS)
python run_all_wms.py --use-url

# Force reprocess everything
python run_all_wms.py --use-url --force-reprocess

# Show processing statistics
python run_all_wms.py --stats
```

### 5 — Start monitoring

```bash
cd monitoring
docker-compose up -d
```

| Service | URL |
|---------|-----|
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |

---

## Cron Schedule

The pipeline runs automatically 3× daily:

| Time | Log file |
|------|----------|
| 08:00 | `/opt/geoserver/logs/wms_8am.log` |
| 13:00 | `/opt/geoserver/logs/wms_2pm.log` |
| 20:00 | `/opt/geoserver/logs/wms_8pm.log` |

Install cron jobs:

```bash
crontab scripts/wms_crontab.txt
```

Each run sends an email notification on completion (success or failure).

---

## Data Model

Three layer types are published to GeoServer:

| Type | Worker | Dimensions | Example Layer |
|------|--------|------------|---------------|
| Static | `static_wms.py` | TIME | `probabilityTWL10y_1_15` |
| Video | `video_wms.py` | TIME | `episWL75`, `TWL75` |
| Points | `points_wms.py` | TIME + ELEVATION | `coastal_point_episWL10y` |

All layers are published under GeoServer workspace `E_and_T`.

---

## Component Documentation

| Component | Documentation |
|-----------|---------------|
| Python pipeline | [`scripts/README.md`](scripts/README.md) |
| Web viewer | [`web/README.md`](web/README.md) |
| Docker services | [`docker/README.md`](docker/README.md) |
| Monitoring stack | [`monitoring/README.md`](monitoring/README.md) |

---

## Environment Variables

All configuration is in `scripts/.env`. Key variables:

```dotenv
GEOSERVER_URL=http://<host>:8080/geoserver
GEOSERVER_USER=admin
GEOSERVER_PASSWORD=geoserver
WORKSPACE=E_and_T

PG_HOST_LOCAL=127.0.0.1
PG_PORT=5432
PG_DB=gis
PG_USER=gisadmin
PG_PASS=geoserver

BASE_URL=https://jeodpp.jrc.ec.europa.eu/ftp/.../medium_term_forecasts/
AUTO_CLEANUP=true
USE_URL_DOWNLOAD=true

EMAIL_TO=admin@example.com
EMAIL_FROM=sender@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

See [`scripts/README.md`](scripts/README.md) for the full variable reference.
