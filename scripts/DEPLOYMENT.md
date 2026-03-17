# Scripts Folder - Ready for Server Deployment

## 📁 Complete Structure

```
scripts/                              # ← UPLOAD THIS ENTIRE FOLDER TO SERVER
├── lib/                              # Shared library modules
│   ├── __init__.py
│   ├── config.py                     # Configuration & env vars
│   ├── geoserver.py                  # GeoServer API functions
│   ├── netcdf_utils.py               # NetCDF processing helpers
│   └── postgis.py                    # PostGIS utilities
│
├── workers/                          # Processing workers
│   ├── __init__.py
│   ├── static_wms.py                 # Static probability layers
│   ├── video_wms.py                  # episWL75, TWL75 layers
│   └── points_wms.py                 # Coastal point layers
│
├── run_all_wms.py                    # Main orchestrator script
├── setup_venv.sh                     # Auto setup virtual environment
├── requirements.txt                  # Python dependencies
└── README.md                         # Documentation

├── old/                              # (OPTIONAL - old versions, can delete)
└── __pycache__/                      # (AUTO-GENERATED - ignore)
```

## ✅ Ready for Server

**All files present:**
- ✅ Library modules (lib/)
- ✅ Worker scripts (workers/)
- ✅ Orchestrator (run_all_wms.py)
- ✅ Setup script (setup_venv.sh)
- ✅ Dependencies (requirements.txt)
- ✅ Documentation (README.md)

## 🚀 Server Deployment Steps

### 1. Upload to Server
```bash
# From your local machine, upload the entire scripts/ folder
scp -r scripts/ user@vmi2540215:~/
```

### 2. On Server - Setup Environment
```bash
cd ~/scripts
bash setup_venv.sh
```

### 3. Run Scripts
```bash
source venv/bin/activate

# Run all three workers
python run_all_wms.py --reset-each-store

# Or run individually
python -m workers.static_wms
python -m workers.video_wms
python -m workers.points_wms
```

## 📋 What to Upload

**REQUIRED files (upload these):**
- `lib/` (entire folder)
- `workers/` (entire folder)
- `run_all_wms.py`
- `setup_venv.sh`
- `requirements.txt`
- `README.md`

**OPTIONAL (can skip):**
- `old/` - old backup versions
- `__pycache__/` - Python cache
- `.DS_Store` - Mac system file

## 🔍 Verify Before Upload

Total files to upload: **13 Python files + 3 support files**

All scripts are self-contained and ready to run on server!
