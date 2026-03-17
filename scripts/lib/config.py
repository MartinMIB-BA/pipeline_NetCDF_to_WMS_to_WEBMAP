"""Configuration and environment defaults for WMS scripts."""

from __future__ import annotations

import datetime
from dotenv import load_dotenv
load_dotenv()

import os


def env(name: str, default: str) -> str:
    """Get environment variable with default fallback."""
    return os.environ.get(name, default)


# GeoServer settings
GEOSERVER_URL = env("GEOSERVER_URL", "http://89.47.190.36:8080/geoserver")
WORKSPACE = env("WORKSPACE", "E_and_T")
GEOSERVER_USER = env("GEOSERVER_USER", "admin")
GEOSERVER_PASSWORD = env("GEOSERVER_PASSWORD", "geoserver")
STYLE_NAME = env("STYLE_NAME", "STATIC_WMS")
VIDEO_STYLE = env("VIDEO_STYLE", "VIDEO_WMS")
POINTS_STYLE = env("POINTS_STYLE", "POINTS_WMS")

# PostGIS settings
PG_HOST_LOCAL = env("PG_HOST_LOCAL", "127.0.0.1")
PG_PORT = int(env("PG_PORT", "5432"))
PG_DB = env("PG_DB", "gis")
PG_USER = env("PG_USER", "gisadmin")
PG_PASS = env("PG_PASS", "geoserver")
PG_HOST_GEOSERVER = env("PG_HOST_GEOSERVER", "pgbouncer")

# Path settings
INPUT_DIR = env("INPUT_DIR", "")  # Must be set via environment variable or use URL download
OUTPUT_ROOT = env("OUTPUT_ROOT", "/opt/geoserver/uploads")
GEOSERVER_DATA_DIR = env("GEOSERVER_DATA_DIR", "/opt/geoserver/data/geoserver_data")

# URL download settings (auto-discovery)
BASE_URL = env("BASE_URL", "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/FLOODS/sea_level_forecasts/probabilistic_data_driven/medium_term_forecasts/")
HOURS = ["00", "12"]  # Hour subfolders to check
# Dynamic: automatically use current year + current month (no hardcoding needed)
PERIODS_TO_PROCESS = [(datetime.date.today().year, datetime.date.today().month)]
USE_URL_DOWNLOAD = env("USE_URL_DOWNLOAD", "true").lower() == "true"
AUTO_CLEANUP = env("AUTO_CLEANUP", "true").lower() == "true"  # Cleanup geoserver_ready after each file





