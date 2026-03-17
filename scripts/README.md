# Pipeline — scripts/

This directory contains the Python data pipeline that automatically processes NetCDF sea-level forecast files from JRC-FLOODS into GeoServer WMS layers.

---

## How It Works

```
1. Auto-discover new NetCDF files on JRC-FLOODS FTP
2. Skip files already marked as 'success' in PostgreSQL
3. Download one file at a time (stream mode)
4. Route file to the correct worker based on filename pattern
5. Worker converts NetCDF variables → GeoTIFFs
6. GeoTIFFs are uploaded to GeoServer as ImageMosaic layers
7. Update tracking DB with result (success / failed)
8. Optionally delete working directory (AUTO_CLEANUP)
9. Send email notification with log attachment
```

Processing is **incremental**: the tracking database ensures each file is only processed once unless explicitly reset.

---

## Directory Structure

```
scripts/
├── lib/
│   ├── config.py           Environment variable loading & defaults
│   ├── download.py         Remote file discovery & HTTP/FTP downloading
│   ├── geoserver.py        GeoServer REST API client
│   ├── postgis.py          PostGIS schema creation for ImageMosaic
│   ├── tracking.py         PostgreSQL tracking of processed files
│   └── netcdf_utils.py     NetCDF variable inspection & GeoTIFF export
├── workers/
│   ├── static_wms.py       Processor for static probability layers
│   ├── video_wms.py        Processor for time-series video layers
│   └── points_wms.py       Processor for coastal point data layers
├── run_all_wms.py          Main orchestrator
├── run_wms_with_email.sh   Cron wrapper with email notification
├── send_email_notification.py  Gmail SMTP sender
├── seed.py                 One-time database seeding utility
├── export_tracking.py      Export tracking log to CSV
├── debug_auth.py           GeoServer authentication debugger
├── monitor_storage.sh      Disk space monitoring script
├── variable_mapping.json   NetCDF variable name → GeoServer layer name map
├── wms_crontab.txt         Cron job definitions
└── requirements.txt        Python dependencies
```

---

## Entry Point: `run_all_wms.py`

The main orchestrator. Runs the full discovery → download → process → publish cycle.

```bash
python run_all_wms.py [OPTIONS]
```

| Option | Description |
|--------|-------------|
| `--use-url` | Discover and download files from `BASE_URL` (default mode) |
| `--force-reprocess` | Ignore tracking DB and reprocess all files |
| `--reset-file FILENAME` | Reset one specific file back to pending |
| `--stats` | Print processing statistics and exit |
| `--workers WORKERS` | Comma-separated list of workers to run (default: `static,video,points`) |
| `--reset-each-store` | Clear GeoServer ImageMosaic stores before each upload |
| `--no-reharvest` | Skip the reharvest step after upload |
| `--no-cleanup` | Keep working directory after processing |
| `--no-tracking` | Disable PostgreSQL tracking entirely |

**Examples:**

```bash
# Normal incremental run
python run_all_wms.py --use-url

# Full reprocessing run
python run_all_wms.py --use-url --force-reprocess --reset-each-store

# Only run the static worker
python run_all_wms.py --use-url --workers static

# Check stats
python run_all_wms.py --stats
```

---

## Workers

### `static_wms.py` — Static Probability Layers

Processes return-period probability maps (10y, 100y, 500y) as single time-step layers.

- Handles 30+ variables (e.g. `probabilityTWL10y`, `probabilityWL100y`)
- Each variable has multiple time steps (one GeoTIFF per step)
- Uploads to GeoServer as ImageMosaic with TIME dimension

### `video_wms.py` — Time-Series Video Layers

Processes time-varying wave/water-level fields with 153 time steps.

- Variables: `episWL75`, `TWL75` and related
- Each time step exported as a separate GeoTIFF
- Results in animated/time-slider WMS layers

### `points_wms.py` — Coastal Point Data

Processes point-based coastal forecast data with two independent dimensions.

- 6 variables × 9 return periods (e.g. `episWL10y`, `episWL50y`, …)
- Dimensions: TIME + ELEVATION
- Publishes to GeoServer with both dimensions enabled

---

## Library Modules

### `lib/config.py`

Loads all configuration from `.env` and exposes constants used across the pipeline.

Key exported values:
- `GEOSERVER_URL`, `WORKSPACE`, `GEOSERVER_USER`, `GEOSERVER_PASSWORD`
- `PG_HOST_LOCAL`, `PG_PORT`, `PG_DB`, `PG_USER`, `PG_PASS`
- `BASE_URL`, `OUTPUT_ROOT`, `INPUT_DIR`
- `AUTO_CLEANUP`, `USE_URL_DOWNLOAD`
- `PERIODS_TO_PROCESS` — list of return periods to process

### `lib/download.py`

- Parses the remote directory listing at `BASE_URL`
- Filters for `.nc` files not yet in the tracking DB
- Downloads with streaming HTTP (no full memory load)
- Returns local file path for processing

### `lib/geoserver.py`

REST API client for GeoServer. Key operations:
- Create / update workspace
- Create / reset ImageMosaic coverage store
- Upload GeoTIFF into an existing store
- Trigger reharvest (re-index all granules)
- Enable TIME / ELEVATION dimensions on a layer
- Assign styles to layers

### `lib/postgis.py`

Creates and manages PostGIS schemas used as ImageMosaic index tables. Creates one schema per layer with:
- `the_geom` — bounding polygon (EPSG:4326)
- `location` — path to the GeoTIFF granule
- `ingestion` — timestamp (TIME dimension)
- `elevation` — integer (ELEVATION dimension, points worker only)

### `lib/tracking.py`

PostgreSQL-backed tracking of processed files.

Table: `wms_processing_log`

| Column | Type | Description |
|--------|------|-------------|
| `filename` | VARCHAR(255) | Unique NetCDF filename |
| `issue_timestamp` | VARCHAR(12) | 12-char timestamp extracted from filename |
| `file_url` | TEXT | Source URL |
| `file_size_bytes` | BIGINT | File size |
| `status` | VARCHAR(20) | `pending`, `downloading`, `processing`, `success`, `failed` |
| `layer_type` | VARCHAR(50) | `static`, `video`, or `points` |
| `layers_processed` | TEXT[] | Array of published layer names |
| `error_message` | TEXT | Error details on failure |

Key functions:
- `initialize_tracking_db()` — create table if not exists
- `mark_file_pending(filename, url)` — register new file
- `mark_file_success(filename, layers)` — mark complete
- `mark_file_failed(filename, error)` — record failure
- `get_pending_files()` — list unprocessed files
- `get_processing_stats()` — summary counts by status

### `lib/netcdf_utils.py`

Utilities for reading and exporting NetCDF data:
- Variable inspection (list variables, dimensions, shape)
- Export one variable + time step to GeoTIFF (with CRS and bounds)
- Batch export all time steps of a variable
- Reads coordinate reference system from file metadata

---

## Email Notifications

`send_email_notification.py` sends Gmail SMTP notifications after each pipeline run.

The subject line contains the run timestamp and status:
- `[WMS] Run 8am success` — when all files processed
- `[WMS] Run 8am FAILED` — when one or more files failed

The log file is attached to the email.

**Requirements:**
- Gmail account with App Password enabled
- `.env` variables: `EMAIL_TO`, `EMAIL_FROM`, `GMAIL_APP_PASSWORD`

**Test your email config:**
```bash
python test_email.py
```

---

## Storage Monitoring

`monitor_storage.sh` checks disk capacity on configured mount points and logs a warning if usage exceeds a threshold (default: 80%).

Run daily via cron or manually:

```bash
bash monitor_storage.sh
```

---

## Environment Variables

All variables are read from `scripts/.env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `GEOSERVER_URL` | Yes | GeoServer base URL |
| `GEOSERVER_USER` | Yes | GeoServer admin username |
| `GEOSERVER_PASSWORD` | Yes | GeoServer admin password |
| `WORKSPACE` | Yes | GeoServer workspace name (default: `E_and_T`) |
| `STYLE_NAME` | No | Default style for static layers |
| `VIDEO_STYLE` | No | Style for video layers |
| `POINTS_STYLE` | No | Style for point layers |
| `PG_HOST_LOCAL` | Yes | PostgreSQL host for scripts (e.g. `127.0.0.1`) |
| `PG_HOST_GEOSERVER` | Yes | PostgreSQL host from GeoServer container (e.g. `pgbouncer`) |
| `PG_PORT` | Yes | PostgreSQL port (default: `5432`) |
| `PG_DB` | Yes | Database name (default: `gis`) |
| `PG_USER` | Yes | Database username |
| `PG_PASS` | Yes | Database password |
| `BASE_URL` | Yes | JRC-FLOODS FTP base URL for file discovery |
| `INPUT_DIR` | No | Local directory with NetCDF files (alternative to URL mode) |
| `OUTPUT_ROOT` | Yes | Root directory where GeoTIFFs are written |
| `GEOSERVER_DATA_DIR` | Yes | GeoServer data directory path |
| `AUTO_CLEANUP` | No | Delete working dir after each file (`true`/`false`, default: `true`) |
| `USE_URL_DOWNLOAD` | No | Enable HTTP downloading (`true`/`false`, default: `true`) |
| `EMAIL_TO` | No | Notification recipient address |
| `EMAIL_FROM` | No | Gmail sender address |
| `GMAIL_APP_PASSWORD` | No | Gmail App Password (16 characters, spaces allowed) |

---

## Cron Setup

Install the provided cron configuration:

```bash
crontab wms_crontab.txt
```

Schedule (all times local):

| Time | Action |
|------|--------|
| 08:00 | Pipeline run + email |
| 13:00 | Pipeline run + email |
| 20:00 | Pipeline run + email |
| 09:00 | Disk space check |

Logs are written to `/opt/geoserver/logs/`.

---

## Python Dependencies

See `requirements.txt`. Key packages:

| Package | Purpose |
|---------|---------|
| `xarray` | NetCDF file reading |
| `rioxarray` | Raster I/O extension for xarray |
| `netCDF4` | Low-level NetCDF reader |
| `rasterio` | GeoTIFF writing via GDAL |
| `psycopg2-binary` | PostgreSQL client |
| `requests` | HTTP downloads and GeoServer REST API |
| `python-dotenv` | `.env` file loading |
| `tqdm` | Progress bar output |

Install:

```bash
pip install -r requirements.txt
```

---

## Utility Scripts

| Script | Usage |
|--------|-------|
| `seed.py` | One-time database seed with initial data |
| `export_tracking.py` | Export `wms_processing_log` to CSV |
| `debug_auth.py` | Verify GeoServer credentials and REST API connectivity |
| `test_email.py` | Send a test email to verify SMTP configuration |
