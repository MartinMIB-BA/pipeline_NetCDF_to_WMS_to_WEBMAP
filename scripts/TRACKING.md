# WMS Processing Scripts - Tracking System

## 📊 Processing Tracker

The scripts now include a **PostgreSQL-based tracking system** that records which NetCDF files have been processed. This enables:

- ⚡ **Fast incremental updates** - Skip already-processed files
- 📈 **Processing history** - See what was processed and when
- 🔄 **Selective reprocessing** - Reprocess specific files
- ❌ **Error tracking** - See which files failed and why

---

## 🚀 Quick Start

### Normal Run (with tracking)
```bash
python run_all_wms.py
```
- Downloads only new/unprocessed files
- Automatically tracks processing status
- Shows statistics at the end

### First Time Setup
The tracking database table is created automatically on first run.

---

## 📋 Commands

### View Processing Statistics
```bash
python run_all_wms.py --stats
```

Shows:
- Total files tracked
- Count by status (success, failed, processing)
- Recent failures with error messages

### Force Reprocess All Files
```bash
python run_all_wms.py --force-reprocess
```

Downloads and processes all files, ignoring tracking status.

### Reset Specific File
```bash
python run_all_wms.py --reset-file mediumTermTWL_202601010000.nc
```

Removes file from tracking database, allowing it to be reprocessed.

### Disable Tracking
```bash
python run_all_wms.py --no-tracking
```

Runs without tracking system (downloads all files).

---

## 🗄️ Database Schema

Tracking data is stored in PostgreSQL table `wms_processing_log`:

| Column | Type | Description |
|--------|------|-------------|
| filename | VARCHAR(255) | NetCDF filename (unique) |
| issue_timestamp | VARCHAR(12) | YYYYMMDDHHMM from filename |
| file_url | TEXT | Source URL |
| file_size_bytes | BIGINT | File size |
| download_date | TIMESTAMP | When downloaded |
| processing_start | TIMESTAMP | Processing start time |
| processing_end | TIMESTAMP | Processing end time |
| status | VARCHAR(20) | pending/processing/success/failed |
| layer_type | VARCHAR(50) | static/video/points |
| layers_processed | TEXT[] | Array of layer names |
| error_message | TEXT | Error if failed |

---

## 🔄 How It Works

### Download Phase
1. List all `.nc` files from remote URL
2. Extract timestamp from each filename
3. Query database: `SELECT * FROM wms_processing_log WHERE filename = ? AND status = 'success'`
4. **Skip** files already successfully processed
5. Download only new/unprocessed files
6. Mark as `downloading` in database

### Processing Phase
1. Mark file as `processing` before starting
2. Process NetCDF → GeoTIFF
3. Upload to GeoServer
4. On success: Mark as `success` with layer list
5. On failure: Mark as `failed` with error message

### Cleanup Phase
- Delete temporary NetCDF files
- Delete temporary GeoTIFF files
- **Database records remain** for future tracking

---

## 📊 Example Output

```
🔧 Initializing tracking database...
✅ Tracking database initialized

📥 Downloading NetCDF files from remote URL...
   Base URL: https://jeodpp.jrc.ec.europa.eu/.../2026/01/01/
   Subfolders: ['00', '12']

Checking subfolder: .../00/
  Found 1 .nc file(s)

📊 Checking processing status...
  ⏭️  Skip (already processed): mediumTermTWL_202601010000.nc

✅ All files already processed! Nothing to download.

📊 PROCESSING STATISTICS
======================================================================
Total files tracked: 150

By status:
  success............. 148
  failed.............. 2

Recent failures:
  ❌ mediumTermTWL_202512310000.nc
     Error: Connection timeout
     Date: 2026-01-07 15:30:00
======================================================================
```

---

## 🛠️ Configuration

### Environment Variables

```bash
# Disable tracking (default: enabled)
export USE_TRACKING=false

# Custom tracking schema (default: public)
export TRACKING_SCHEMA=wms_tracking
```

### Database Connection

Uses same PostgreSQL connection as ImageMosaic indexes:
- Host: `PG_HOST_LOCAL` (default: 127.0.0.1)
- Port: `PG_PORT` (default: 5432)
- Database: `PG_DB` (default: postgres)
- User: `PG_USER` (default: geoserver)
- Password: `PG_PASS` (default: geoserver)

---

## 🔍 Troubleshooting

### "Tracking initialization failed"
- Check PostgreSQL is running
- Verify database credentials in config
- Ensure user has CREATE TABLE permissions

### Files not being skipped
- Check timestamps are being extracted correctly
- Verify `status = 'success'` in database
- Use `--stats` to see current status

### Want to reprocess everything
Use `--force-reprocess` flag

### Want to clear all tracking data
```sql
DELETE FROM wms_processing_log;
```

---

## 📈 Performance

For 365 files (1 year of daily data):
- **Without tracking:** Downloads all 365 files (~30-60 min)
- **With tracking (incremental):** Downloads ~1-2 new files (~1-2 min)

**Speedup: ~30-60x faster** for incremental updates!
