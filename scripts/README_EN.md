# WMS NetCDF Data Processing - Complete Documentation

## System Overview

This system automatically downloads, processes, and publishes NetCDF sea level data through GeoServer as WMS (Web Map Service) services. The system supports:

- ✅ **Automatic file discovery** - Scans all available NetCDF files in 2026
- ✅ **PostgreSQL tracking** - Prevents reprocessing of already completed files
- ✅ **Working directory cleanup** - Automatically deletes temporary GeoTIFF files (default 90 days)
- ✅ **TIME dimensions** - Supports time series with optimized GetCapabilities
- ✅ **Three WMS layer types** - Static, video, and point data

---

## Data Management

### Automatic Cleanup

After processing each NetCDF file, the system automatically:
1. Uploads GeoTIFFs to GeoServer (which stores them in its `data_dir`)
2. **Immediately deletes the entire working directory** `geoserver_ready/`
3. Creates a new empty `geoserver_ready/` for the next file

**Important:**
- ✅ **GeoServer WMS data** - preserved forever in `data_dir`
- ✅ **PostGIS index** - contains all time steps
- 🗑️ **Working directory** (`geoserver_ready/`) - deleted after each file
- 💾 **Disk savings** - working directory never exceeds size of 1 file (~13GB)

**Why it works this way:**
1. GeoTIFFs are created in `geoserver_ready/` (temporary working directory)
2. They are zipped and uploaded to GeoServer
3. GeoServer extracts them into its `data_dir` (permanent storage)
4. Working directory is **immediately** deleted
5. WMS layers in GeoServer remain available forever

**Configuration:**
```bash
export AUTO_CLEANUP=true  # Automatic cleanup after each file (default)
```

**Note:** GeoServer `data_dir` will grow progressively as it contains all historical WMS data. This is normal and correct.

---

For complete documentation in Slovak, see [README_SK.md](README_SK.md).

**The system is ready for production!** 🚀
