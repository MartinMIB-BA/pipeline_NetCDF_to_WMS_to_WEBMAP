"""
seed_tiles.py — Pre-seed GeoWebCache tiles for epis_wl75 and twl75 layers.

- Queries PostGIS for TIME + ELEVATION values from the last 7 days
- Sends GWC REST API seed requests for zoom levels 2-4, full world extent
- Truncates tiles older than 7 days to free cache space

Usage:
    python seed_tiles.py             # seed last 7 days, truncate old
    python seed_tiles.py --dry-run   # show what would be done, no requests
    python seed_tiles.py --truncate-only  # only remove old tiles
"""

from __future__ import annotations

import argparse
import datetime
import sys
import time

import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv()

import os

# ─── Config ────────────────────────────────────────────────────────────────────
GEOSERVER_URL  = os.environ.get("GEOSERVER_URL",  "http://localhost:8080/geoserver")
GEOSERVER_USER = os.environ.get("GEOSERVER_USER", "admin")
GEOSERVER_PASS = os.environ.get("GEOSERVER_PASSWORD", "geoserver")
WORKSPACE      = os.environ.get("WORKSPACE", "E_and_T")

PG_HOST = os.environ.get("PG_HOST_LOCAL", "127.0.0.1")
PG_PORT = int(os.environ.get("PG_PORT", "5432"))
PG_DB   = os.environ.get("PG_DB",   "gis")
PG_USER = os.environ.get("PG_USER", "gisadmin")
PG_PASS = os.environ.get("PG_PASS", "geoserver")

LAYERS = ["epis_wl75", "twl75"]          # layers to seed
ZOOM_START  = 2
ZOOM_STOP   = 4
GRID_SET_ID = "EPSG:900913x2"            # Web Mercator x2 — matches Leaflet/GWC default
TILE_FORMAT = "image/png"
THREAD_COUNT = 2                         # parallel GWC threads per seed job
SEED_DAYS   = 7                          # seed last N days
PURGE_DAYS  = 7                          # truncate tiles older than N days

AUTH = (GEOSERVER_USER, GEOSERVER_PASS)

# ─── PostGIS helpers ────────────────────────────────────────────────────────────

def get_db_conn():
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASS
    )


def get_time_values(layer: str, since: datetime.datetime) -> list[str]:
    """Return distinct ISO TIME strings from PostGIS for the given layer since `since`."""
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT ingestion
                FROM "{layer}"."{layer}"
                WHERE ingestion >= %s
                ORDER BY ingestion
            """, (since,))
            rows = cur.fetchall()
        return [row[0].strftime("%Y-%m-%dT%H:%M:%S.000Z") for row in rows]
    finally:
        conn.close()


def get_old_time_values(layer: str, before: datetime.datetime) -> list[str]:
    """Return distinct ISO TIME strings older than `before`."""
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT ingestion
                FROM "{layer}"."{layer}"
                WHERE ingestion < %s
                ORDER BY ingestion
            """, (before,))
            rows = cur.fetchall()
        return [row[0].strftime("%Y-%m-%dT%H:%M:%S.000Z") for row in rows]
    finally:
        conn.close()


def get_elevation_values(layer: str) -> list[str]:
    """Return distinct ELEVATION values for the given layer."""
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT elevation
                FROM "{layer}"."{layer}"
                ORDER BY elevation
            """)
            rows = cur.fetchall()
        return [str(int(row[0])) if row[0] == int(row[0]) else str(row[0]) for row in rows]
    finally:
        conn.close()


# ─── GWC REST helpers ───────────────────────────────────────────────────────────

def gwc_seed(layer: str, time_val: str, elev_val: str, seed_type: str = "seed", dry_run: bool = False) -> bool:
    """
    Send a seed or truncate request to GeoWebCache REST API.
    seed_type: 'seed' | 'reseed' | 'truncate'
    """
    full_layer = f"{WORKSPACE}:{layer}"
    url = f"{GEOSERVER_URL}/gwc/rest/seed/{full_layer}.json"

    body = {
        "seedRequest": {
            "name": full_layer,
            "bounds": {
                "coords": {"double": [-20037508.34, -20037508.34, 20037508.34, 20037508.34]}
            },
            "gridSetId": GRID_SET_ID,
            "zoomStart": ZOOM_START,
            "zoomStop": ZOOM_STOP,
            "format": TILE_FORMAT,
            "type": seed_type,
            "threadCount": THREAD_COUNT,
            "parameters": {
                "entry": [
                    {"string": ["TIME",      time_val]},
                    {"string": ["ELEVATION", elev_val]}
                ]
            }
        }
    }

    if dry_run:
        print(f"  [DRY-RUN] {seed_type.upper()} {full_layer} TIME={time_val} ELEV={elev_val}")
        return True

    try:
        r = requests.post(url, json=body, auth=AUTH, timeout=30)
        if r.status_code in (200, 202):
            return True
        else:
            print(f"  ⚠️  GWC {seed_type} failed ({r.status_code}): {r.text[:200]}")
            return False
    except Exception as e:
        print(f"  ❌ Request error: {e}")
        return False


def gwc_kill_all(layer: str) -> None:
    """Kill all running seed jobs for a layer."""
    full_layer = f"{WORKSPACE}:{layer}"
    url = f"{GEOSERVER_URL}/gwc/rest/seed/{full_layer}"
    try:
        requests.post(url, data="kill_all=all", auth=AUTH,
                      headers={"Content-Type": "application/x-www-form-urlencoded"},
                      timeout=10)
    except Exception:
        pass


# ─── Main logic ────────────────────────────────────────────────────────────────

def run_seed(dry_run: bool = False, truncate_only: bool = False):
    now   = datetime.datetime.utcnow()
    since = now - datetime.timedelta(days=SEED_DAYS)
    before = now - datetime.timedelta(days=PURGE_DAYS)

    print(f"\n{'='*60}")
    print(f"  GWC Tile Seeder")
    print(f"  Mode     : {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"  Layers   : {LAYERS}")
    print(f"  Zoom     : {ZOOM_START}–{ZOOM_STOP}")
    print(f"  Seed last: {SEED_DAYS} days (since {since.strftime('%Y-%m-%d')})")
    print(f"  Purge old: > {PURGE_DAYS} days (before {before.strftime('%Y-%m-%d')})")
    print(f"{'='*60}\n")

    for layer in LAYERS:
        print(f"📦 Layer: {layer}")

        # ── 1. Truncate old tiles ──────────────────────────────────────────
        try:
            old_times = get_old_time_values(layer, before)
        except Exception as e:
            print(f"  ⚠️  Could not query old TIME values: {e}")
            old_times = []

        if old_times:
            try:
                elevations = get_elevation_values(layer)
            except Exception as e:
                print(f"  ⚠️  Could not query ELEVATION values: {e}")
                elevations = ["0"]

            print(f"  🗑️  Truncating {len(old_times)} old TIME values × {len(elevations)} elevations...")
            truncated = 0
            for t in old_times:
                for e in elevations:
                    if gwc_seed(layer, t, e, seed_type="truncate", dry_run=dry_run):
                        truncated += 1
            print(f"  ✅ Truncated {truncated} combinations")
        else:
            print(f"  ℹ️  No old tiles to truncate")

        if truncate_only:
            continue

        # ── 2. Seed new tiles ──────────────────────────────────────────────
        try:
            new_times = get_time_values(layer, since)
        except Exception as e:
            print(f"  ⚠️  Could not query TIME values: {e}")
            new_times = []

        if not new_times:
            print(f"  ℹ️  No TIME values found in last {SEED_DAYS} days — skipping seed")
            continue

        try:
            elevations = get_elevation_values(layer)
        except Exception as e:
            print(f"  ⚠️  Could not query ELEVATION values: {e}")
            elevations = ["0"]

        total = len(new_times) * len(elevations)
        print(f"  🌱 Seeding {len(new_times)} TIME values × {len(elevations)} elevations = {total} jobs")
        print(f"     TIME range : {new_times[0]} → {new_times[-1]}")
        print(f"     ELEVATIONs : {elevations}")

        seeded = 0
        for t in new_times:
            for elv in elevations:
                if gwc_seed(layer, t, elv, seed_type="seed", dry_run=dry_run):
                    seeded += 1
                    sys.stdout.write(f"\r     Progress: {seeded}/{total}")
                    sys.stdout.flush()
                time.sleep(0.1)   # small delay to avoid overloading GWC queue

        print(f"\n  ✅ Submitted {seeded}/{total} seed jobs")

    print(f"\n{'='*60}")
    print("  Done. GWC is seeding tiles in the background.")
    print(f"  Monitor: {GEOSERVER_URL}/gwc/rest/seed.json")
    print(f"{'='*60}\n")


# ─── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pre-seed GWC tiles for video WMS layers")
    parser.add_argument("--dry-run",       action="store_true", help="Print actions without sending requests")
    parser.add_argument("--truncate-only", action="store_true", help="Only truncate old tiles, skip seeding")
    args = parser.parse_args()

    run_seed(dry_run=args.dry_run, truncate_only=args.truncate_only)
