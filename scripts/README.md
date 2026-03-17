# WMS NetCDF Data Processing - Documentation

## System Overview

This system automatically downloads, processes, and publishes NetCDF sea level data through GeoServer as WMS (Web Map Service) services. The system supports:

- ✅ **Automatic file discovery** - Scans all available NetCDF files in 2026
- ✅ **PostgreSQL tracking** - Prevents reprocessing of already completed files
- ✅ **Data retention management** - Automatically deletes old GeoTIFF files (default 90 days)
- ✅ **TIME dimensions** - Supports time series with optimized GetCapabilities
- ✅ **Three WMS layer types** - Static, video, and point data

---

## Project Structure

```
scripts/
├── run_all_wms.py              # Main orchestrator (STREAM MODE)
├── lib/
│   ├── config.py               # Configuration and environment variables
│   ├── download.py             # Downloading and auto-discovery
│   ├── geoserver.py            # GeoServer REST API
│   ├── postgis.py              # PostGIS schema management
│   ├── tracking.py             # PostgreSQL file tracking
│   └── netcdf_utils.py         # NetCDF utility functions
├── workers/
│   ├── static_wms.py           # Static layer processing
│   ├── video_wms.py            # Video layer processing
│   └── points_wms.py           # Point data processing
└── monitor_storage.sh          # Disk capacity monitoring
```

---

## Installation

### 1. System Requirements

- Python 3.12+
- PostgreSQL 12+ with PostGIS extension
- GeoServer 2.27+
- ~20GB free disk space (with 90-day retention)

### 2. Install Dependencies

```bash
cd scripts
bash setup_venv.sh
```

Or manually:
```bash
python3 -m venv venv
source venv/bin/activate
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

Create tracking database:
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

Create `.env` file or set in system:

```bash
# GeoServer
GEOSERVER_URL=https://geoserver.fornidev.org/geoserver
WORKSPACE=E_and_T
GEOSERVER_USER=admin
GEOSERVER_PASSWORD=geoserver

# PostgreSQL
PG_HOST_LOCAL=127.0.0.1
PG_PORT=5432
PG_DB=postgres
PG_USER=geoserver
PG_PASS=geoserver
PG_HOST_GEOSERVER=postgis  # Hostname from GeoServer's perspective

# Paths
INPUT_DIR=  # Not used with URL download (recommended)
OUTPUT_ROOT=/home/martin/scripts/geoserver_ready
GEOSERVER_DATA_DIR=/opt/geoserver/data_dir

# URL download (auto-discovery)
BASE_URL=https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/FLOODS/sea_level_forecasts/probabilistic_data_driven/medium_term_forecasts/
USE_URL_DOWNLOAD=true
AUTO_CLEANUP=true  # Delete geoserver_ready immediately after each file

# Email notifications
EMAIL_TO=martin.jancovic01@gmail.com
EMAIL_FROM=martin.jancovic01@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

### Hardcoded Settings in `lib/config.py`

```python
YEARS_TO_PROCESS = [2026]  # Years to process
HOURS = ["00", "12"]       # Hourly runs (2x daily)
```

---

For full documentation, see:
- [README.md](README.md) - English documentation
- [README_SK.md](README_SK.md) - Slovak documentation

**The system is ready for production!** 🚀
