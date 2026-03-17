# WMS NetCDF Data Processing Pipeline - Documentation

## System Overview

This system automatically downloads, processes, and publishes NetCDF sea level data through GeoServer as WMS (Web Map Service) services. The system features:

- ✅ **Automatic file discovery** - intelligently scans for available NetCDF files based on the current year and month.
- ✅ **PostgreSQL tracking** - Prevents reprocessing of already completed files using a database log.
- ✅ **Data retention management** - Automatically deletes temporary GeoTIFF files to save disk space.
- ✅ **TIME dimensions** - Supports time series with optimized GetCapabilities.
- ✅ **Three WMS layer types** - Static, video, and point data.
- ✅ **Stream Processing** - Downloads and processes one file at a time, keeping disk usage minimal.

---

## Project Structure

```
scripts/
├── run_all_wms.py              # Main orchestrator (STREAM MODE)
├── lib/
│   ├── config.py               # Configuration and environment variables
│   ├── download.py             # Downloading and auto-discovery logic
│   ├── geoserver.py            # GeoServer REST API integration
│   ├── postgis.py              # PostGIS schema management
│   ├── tracking.py             # PostgreSQL file tracking system
│   └── netcdf_utils.py         # NetCDF utility functions
├── workers/
│   ├── static_wms.py           # Static probability layers processing
│   ├── video_wms.py            # Video time-series layers processing
│   └── points_wms.py           # Coastal point data processing
├── monitoring/
│   └── monitor_storage.sh      # Disk capacity monitoring script
├── .env                        # Environment variables (Credentials)
└── requirements.txt            # Python dependencies
```

---

## Installation & Setup

### 1. System Requirements

- Python 3.12+
- PostgreSQL 12+ with PostGIS extension
- GeoServer 2.27+
- ~20GB free disk space 

### 2. Install Dependencies

Using `conda` (Recommended):

```bash
cd scripts
conda create -n wms python=3.12
conda activate wms
pip install -r requirements.txt
```

**Main dependencies:**
- xarray >= 2023.1.0
- rioxarray >= 0.15.0
- netCDF4 >= 1.6.0
- numpy >= 1.24.0
- psycopg2-binary >= 2.9.0
- requests >= 2.31.0
- rasterio >= 1.3.0

### 3. PostgreSQL Configuration

Create the tracking database:
```sql
CREATE DATABASE postgres;
CREATE USER geoserver WITH PASSWORD 'geoserver';
GRANT ALL PRIVILEGES ON DATABASE postgres TO geoserver;

\c postgres
CREATE EXTENSION postgis;
```

### 4. GeoServer Configuration

- Install GeoServer
- Create workspace `E_and_T`
- Configure PostGIS datastore for ImageMosaic

---

## Configuration

### Environment Variables

Create a `.env` file in the `scripts/` directory:

```bash
# GeoServer
GEOSERVER_URL=http://89.47.190.36:8080/geoserver
WORKSPACE=E_and_T
GEOSERVER_USER=admin
GEOSERVER_PASSWORD=your_secure_password

# PostgreSQL
PG_HOST_LOCAL=127.0.0.1
PG_PORT=5432
PG_DB=postgres
PG_USER=geoserver
PG_PASS=your_secure_password
PG_HOST_GEOSERVER=pgbouncer  # Hostname from GeoServer's perspective inside Docker

# Paths
INPUT_DIR=/opt/geoserver/example_nc
OUTPUT_ROOT=/opt/geoserver/uploads
GEOSERVER_DATA_DIR=/opt/geoserver/data_dir

# URL download (auto-discovery)
BASE_URL=https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/FLOODS/sea_level_forecasts/probabilistic_data_driven/medium_term_forecasts/
USE_URL_DOWNLOAD=true
AUTO_CLEANUP=true  # Delete geoserver_ready immediately after each file

# Email notifications
EMAIL_TO=martin.jancovic01@gmail.com
EMAIL_FROM=martin.jancovic01@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx  # Gmail App Password
```

### Dynamic Processing Periods (`lib/config.py`)

The system uses a dynamic configuration to only scan the current year and month. This speeds up the auto-discovery phase significantly:
```python
import datetime
PERIODS_TO_PROCESS = [(datetime.date.today().year, datetime.date.today().month)]
HOURS = ["00", "12"]       # Hourly runs to check
```

---

## Usage

### Basic Execution

**With URL downloading (Recommended):**
```bash
conda activate wms
python run_all_wms.py --use-url
```

### Command Line Options

```bash
python run_all_wms.py --help

Options:
  --use-url              Download NetCDF files from URL
  --force-reprocess      Force reprocessing of all files (ignores tracking)
  --reset-file FILENAME  Reset the status of a specific file
  --stats                Show processing statistics
  --workers WORKERS      Specify workers (default: all)
  --reset-each-store     Reset GeoServer stores before upload
```

### Examples

**Auto-discovery and processing of new files:**
```bash
python run_all_wms.py --use-url
```

**Force reprocess all files:**
```bash
python run_all_wms.py --use-url --force-reprocess
```

**Show statistics:**
```bash
python run_all_wms.py --stats
```

**Reset a specific file:**
```bash
python run_all_wms.py --reset-file mediumTermTWLforecastGridded_202601010000-202601160000.nc
```

---

## How the System Works

### 1. Auto-Discovery

The system automatically scans the remote FTP server based on the `PERIODS_TO_PROCESS` setting:

1. Starts combining the `BASE_URL` with the target `year/` and `month/`.
2. Finds day folders: `01/`, `02/`, ..., `31/`
3. Checks assigned hour folders inside each day: `00/`, `12/`
4. Lists all `.nc` files.
5. Checks PostgreSQL tracking log - skips already successfully processed files.
6. Downloads and processes only new files.

**Benefits:**
- Highly optimized: Skips searching entire years by focusing only on the current month.
- 1 PostgreSQL query batch instead of hundreds (optimization).
- Intelligent skipping of processed files.

### 2. Stream Processing

```text
File 1:
  → Download to /tmp
  → Process via 3 workers
  → Upload to GeoServer
  → Clean up /tmp

File 2:
  → Download to /tmp
  → ...
```

**Benefits:**
- **Low disk usage:** Only 1 NetCDF file is stored locally at a time.
- **Fast Failure:** Errors do not stop the entire queue.
- **Real-time visibility:** Progressive tracking system shows live status.

### 3. Worker Types

#### **static_wms.py** - Static Probability Layers
Processes 12 variables:
- `probabilityEpis10y_1_15`, `probabilityEpis10y_1_3`, `probabilityEpis10y_4_15`
- `probabilityEpis500y_1_15`, `probabilityEpis500y_1_3`, `probabilityEpis500y_4_15`
- `probabilityTWL10y_1_15`, `probabilityTWL10y_1_3`, `probabilityTWL10y_4_15`
- `probabilityTWL500y_1_15`, `probabilityTWL500y_1_3`, `probabilityTWL500y_4_15`
**Style:** `STATIC_WMS`

#### **video_wms.py** - Video Time Series
Processes:
- `episWL75` (153 time steps)
- `TWL75` (153 time steps)
**Style:** `VIDEO_WMS`

#### **points_wms.py** - Coastal Point Data
Processes 6 variables × 9 return periods:
- `probabilityEpiscoast_01_15`, `...`
**Style:** `POINTS_WMS`  
**Dimensions:** TIME + ELEVATION (rp0-rp8)

---

## PostgreSQL Tracking System

### `wms_processing_log` Table

```sql
CREATE TABLE wms_processing_log (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    issue_timestamp VARCHAR(12) NOT NULL,
    status VARCHAR(50) NOT NULL,
    worker VARCHAR(100),
    download_url TEXT,
    error_message TEXT,
    processing_started TIMESTAMP,
    processing_completed TIMESTAMP
);
```

### File Statuses
- `downloading` - File is currently downloading
- `processing` - File is processing through workers
- `success` - Successfully completely processed ✅
- `failed` - Error during processing ❌

---

## Data Management & Cleanup

After processing each NetCDF file, the system automatically:
1. Uploads GeoTIFFs to GeoServer (which stores them in its permanent `data_dir`).
2. **Immediately deletes the entire working directory** (`geoserver_ready/`).
3. Creates a new empty directory for the next file.

**Important details:**
- ✅ **GeoServer WMS Data** - kept forever in `data_dir`.
- ✅ **PostGIS index** - contains all time steps.
- 🗑️ **Working directory** - deleted immediately after each file.
- 💾 **Disk savings** - working directory never exceeds the size of 1 file (~13GB).

Configuration:
```bash
export AUTO_CLEANUP=true  # Automatic deletion after each file (default)
```

---

## Monitoring and Cron Jobs

### Disk Capacity Monitoring

```bash
./monitor_storage.sh
```
This script checks if GeoServer's `data_dir` or specific layers exceed defined limits.

### Automated Email Notifications

Use the wrapper script `run_wms_with_email.sh`:

```bash
./run_wms_with_email.sh /opt/geoserver/logs/wms.log "manual-test"
```
You can test the email configuration via:
```bash
python test_email.py
```

### Production Crontab Setup

```cron
# WMS Processing with Email Notifications (3x daily)
0 8 * * * cd /opt/geoserver/scripts && bash run_wms_with_email.sh /opt/geoserver/logs/wms_8am.log "8am" >> /opt/geoserver/logs/cron.log 2>&1
0 13 * * * cd /opt/geoserver/scripts && bash run_wms_with_email.sh /opt/geoserver/logs/wms_2pm.log "2pm" >> /opt/geoserver/logs/cron.log 2>&1
0 20 * * * cd /opt/geoserver/scripts && bash run_wms_with_email.sh /opt/geoserver/logs/wms_8pm.log "8pm" >> /opt/geoserver/logs/cron.log 2>&1

# Storage Monitoring (daily at 9am)
0 9 * * * cd /opt/geoserver/scripts && bash monitor_storage.sh >> /opt/geoserver/logs/storage_monitor.log 2>&1
```

---

## GeoServer WMS Usage

### GetCapabilities Example

```
http://89.47.190.36:8080/geoserver/E_and_T/wms?
  service=WMS&
  version=1.3.0&
  request=GetCapabilities
```

### GetMap Request Example

```
http://89.47.190.36:8080/geoserver/E_and_T/wms?
  service=WMS&
  version=1.3.0&
  request=GetMap&
  layers=E_and_T:probabilityTWL10y_1_15&
  styles=STATIC_WMS&
  bbox=-180,-90,180,90&
  width=800&
  height=400&
  srs=EPSG:4326&
  format=image/png&
  time=2026-01-01T00:00:00Z
```

### Dimensions

**TIME Dimension:**
```
time=2026-01-01T00:00:00Z                    # Specific time
time=2026-01-01T00:00:00Z/2026-01-15T00:00:00Z  # Time range
```

**ELEVATION Dimension (applies to `points_wms` only):**
```
elevation=0       # rp0
elevation=1       # rp1
...
elevation=8       # rp8
```

---

## Troubleshooting

### Problem: HTTP 500 on first run
**Solution:** Use `--reset-each-store` parameter for the very first execution:
```bash
python run_all_wms.py --use-url --reset-each-store
```

### Problem: PostgreSQL connection refused
**Solution:** Ensure PostgreSQL container or local service is running and `PG_HOST_LOCAL` matches your environment network logic.

### Problem: 404 errors during auto-discovery
**Solution:** The system's HTML parser securely handles Nginx/Apache directory listings, skipping invalid paths. Ensure the `BASE_URL` ends with a `/` and the directory is accessible.

### Files are not skipping
**Solution:** Verify that timestamps are parsing correctly, and use `python run_all_wms.py --stats` to visualize tracking status.
