# Monitoring Stack — monitoring/

Full observability stack for the WMS pipeline and its Docker services. Metrics are collected by Prometheus, visualized in Grafana, and logs are aggregated by Loki.

---

## Stack Overview

```
System & Containers
        │
   ┌────┴──────────────────────────────┐
   │  Exporters                        │
   │  node_exporter   (system metrics) │
   │  postgres_exporter (DB metrics)   │
   │  pgbouncer_exporter (pool metrics)│
   │  nginx_exporter  (web metrics)    │
   │  cAdvisor        (container CPU/mem)│
   └────────────────┬──────────────────┘
                    │ scrape
                    ▼
              Prometheus (:9090)
                    │
              ┌─────┴──────┐
              │            │
           Grafana        Loki (:3100)
           (:3000)          ▲
                            │
                        Promtail
                    (ships nginx logs)
```

---

## Directory Structure

```
monitoring/
├── docker-compose.yml              Compose file for all monitoring services
├── prometheus/
│   └── prometheus.yml              Scrape targets and intervals
├── grafana/                        Grafana provisioning (dashboards, datasources)
├── loki/
│   └── config.yml                  Loki retention and storage config
├── promtail/
│   └── config.yml                  Log paths and Loki push target
└── pgbouncer_exporter/
    └── config.yml                  PgBouncer connection string for exporter
```

---

## Services

### Prometheus (`:9090`)

Time-series metrics database. Scrapes all exporters every 15 seconds.

Scrape targets configured in `prometheus/prometheus.yml`:

| Job | Port | What it monitors |
|-----|------|-----------------|
| `node` | 9100 | Host CPU, memory, disk, network |
| `postgres` | 9187 | PostgreSQL queries, connections, locks |
| `pgbouncer` | 9127 | PgBouncer pool stats, wait times |
| `nginx` | 9113 | Nginx request rate, active connections |
| `cadvisor` | 8080 | Per-container CPU, memory, I/O |

### Grafana (`:3000`)

Datasources (Prometheus, Loki) and dashboards under `grafana/provisioning/` are auto-loaded on startup — see `docker-compose.yml`'s `grafana` volume mount. Currently provisioned:
- **Nginx GWC Cache Hit Ratio** (`grafana/provisioning/dashboards/json/nginx-cache-hit-ratio.json`) — hit ratio, cache-status breakdown, raw counts. Reads the `cache_status` label that Promtail extracts from the nginx access log (see Promtail section below).

Any other dashboards (system overview, PostgreSQL, PgBouncer, container resources) were created manually in the Grafana UI and live in the `grafana_data` Docker volume, not in this repo.

Default credentials: `admin` / `admin` (change on first login).

### Loki (`:3100`)

Log aggregation backend. Receives log streams from Promtail.

Configured for local filesystem storage with a retention policy defined in `loki/config.yml`.

### Promtail

Log shipper. Reads Nginx access logs from the shared volume and pushes them to Loki with label `job=nginx`, plus `cache_status` (HIT/MISS/BYPASS/EXPIRED/STALE/UPDATING/REVALIDATED/`-`) extracted from the `cache=$upstream_cache_status` field that `nginx/nginx.conf`'s `gs` log format appends. `-` means the location had no `proxy_cache` configured at all (e.g. plain `/geoserver/wms`, static assets) — not a cache miss, just not cacheable today.

Log path: `/var/log/nginx/access.log` (mapped from the main stack's `nginx_logs` volume).

### PostgreSQL Exporter (`:9187`)

Exposes PostgreSQL metrics for Prometheus. Connects to the `gis` database via the connection string in `pgbouncer_exporter/config.yml`.

### PgBouncer Exporter (`:9127`)

Exposes PgBouncer pool metrics. Connects to PgBouncer's admin console.

### Node Exporter (`:9100`)

Exposes host-level system metrics (CPU, memory, disk, network interfaces).

### Nginx Exporter (`:9113`)

Reads Nginx `stub_status` endpoint and exposes metrics for Prometheus.

### cAdvisor (`:8081`)

Monitors all Docker containers and exposes resource usage metrics.

---

## Starting the Stack

The monitoring stack runs separately from the main service stack and connects to it via the shared `docker_default` network.

```bash
cd monitoring
docker-compose up -d
```

Verify all containers are healthy:

```bash
docker-compose ps
```

---

## Accessing Services

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana | http://localhost:3000 | admin / admin |
| Prometheus | http://localhost:9090 | — |
| cAdvisor | http://localhost:8081 | — |

---

## Connecting to the Main Stack

The monitoring compose file joins the `docker_default` network created by `docker/docker-compose.yml`. This allows Prometheus to reach exporters by their Docker service names.

Make sure the main stack is running before starting monitoring:

```bash
cd ../docker && docker-compose up -d
cd ../monitoring && docker-compose up -d
```

---

## Adding Custom Dashboards

1. Place JSON dashboard files in `grafana/provisioning/dashboards/json/`
2. Grafana auto-loads them on startup into the "Cache" folder (provider config: `grafana/provisioning/dashboards/dashboards.yml`) — polls for changes every 30s
3. Or import manually via Grafana UI → Dashboards → Import

---

## Alerts

Prometheus alerting rules can be added to `prometheus/prometheus.yml` under the `rule_files` key. Point to a `rules/*.yml` file with `groups` and `alert` definitions.

Example rule to alert on high disk usage:

```yaml
groups:
  - name: storage
    rules:
      - alert: DiskUsageHigh
        expr: (node_filesystem_size_bytes - node_filesystem_free_bytes) / node_filesystem_size_bytes > 0.85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Disk usage above 85% on {{ $labels.instance }}"
```
