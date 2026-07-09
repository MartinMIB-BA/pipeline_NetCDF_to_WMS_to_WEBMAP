"""
ingest_subseasonal.py — Download subseasonal CSV from JRC FTP and import into PostGIS.

Scans the JRC FTP directory structure for CSV files, downloads any not yet in the DB,
and inserts them into country_forecast_weekly with the correct forecast_date.

Usage:
    python3 ingest_subseasonal.py                  # auto-discover and ingest latest
    python3 ingest_subseasonal.py --backfill       # ingest ALL available CSVs
    python3 ingest_subseasonal.py --file path.csv --date 2026-06-29  # manual single file

FTP structure:
    .../subseasonal_forecasts/YYYY/MM/DD/00/subSeasonalCoastalForecast_YYYYMMDD0000-*.csv

forecast_date is parsed from the DD folder (= Monday of the forecast week).
"""

import os
import sys
import re
import argparse
import tempfile
from datetime import date, datetime
from io import StringIO

import requests
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

# ── Config ────────────────────────────────────────────────────────────────────
BASE_URL = os.environ.get(
    "SUBSEASONAL_BASE_URL",
    "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/FLOODS/"
    "sea_level_forecasts/probabilistic_data_driven/subseasonal_forecasts/"
)

PG_HOST = os.environ.get("PG_HOST", "89.47.190.54")
PG_PORT = int(os.environ.get("PG_PORT", "5432"))
PG_DB = os.environ.get("PG_DB", "gis")
PG_USER = os.environ.get("PG_USER", "gisadmin")
PG_PASS = os.environ.get("PG_PASS", "geoserver")

# CSV column mapping → DB columns
COL_MAP = {
    "GID_0": "gid_0",
    "summary_Epis_1_10": "summary_epis_1_10",
    "summary_TWL_1_10": "summary_twl_1_10",
    "max_probabilityEpis_01_47_RP10": "max_prob_epis_rp10",
    "max_probabilityEpis_01_47_RP100": "max_prob_epis_rp100",
    "max_probabilityEpis_01_47_RP500": "max_prob_epis_rp500",
    "max_probabilityTWL_01_47_RP10": "max_prob_twl_rp10",
    "max_probabilityTWL_01_47_RP100": "max_prob_twl_rp100",
    "max_probabilityTWL_01_47_RP500": "max_prob_twl_rp500",
    "n_grid_points_inside_buffer": "n_grid_points",
    "processing_status": "processing_status",
}

DB_COLUMNS = [
    "gid_0", "forecast_date",
    "summary_epis_1_10", "summary_twl_1_10",
    "max_prob_epis_rp10", "max_prob_epis_rp100", "max_prob_epis_rp500",
    "max_prob_twl_rp10", "max_prob_twl_rp100", "max_prob_twl_rp500",
    "n_grid_points", "processing_status",
]


# ── Helpers ───────────────────────────────────────────────────────────────────
def list_links(url):
    """Parse Apache directory listing for href links."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return re.findall(r'href="([^"?][^"]*)"', resp.text)


def discover_csvs():
    """Walk the FTP directory tree and return list of (forecast_date, csv_url)."""
    results = []
    years = [l.strip("/") for l in list_links(BASE_URL) if re.match(r"^\d{4}/$", l)]
    for year in sorted(years):
        months = [l.strip("/") for l in list_links(f"{BASE_URL}{year}/") if re.match(r"^\d{2}/$", l)]
        for month in sorted(months):
            days = [l.strip("/") for l in list_links(f"{BASE_URL}{year}/{month}/") if re.match(r"^\d{2}/$", l)]
            for day in sorted(days):
                hour_url = f"{BASE_URL}{year}/{month}/{day}/00/"
                try:
                    files = list_links(hour_url)
                except Exception:
                    continue
                for f in files:
                    if f.endswith(".csv") and "CoastalForecast" in f:
                        forecast_dt = date(int(year), int(month), int(day))
                        csv_url = f"{hour_url}{f}"
                        results.append((forecast_dt, csv_url))
    return results


def get_existing_dates(conn):
    """Return set of forecast_date values already in DB."""
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT forecast_date FROM country_forecast_weekly")
        return {row[0] for row in cur.fetchall()}


def download_csv(url):
    """Download CSV content as string."""
    print(f"  ⬇️  Downloading {url.split('/')[-1]}...")
    resp = requests.get(url, timeout=120)
    resp.raise_for_status()
    return resp.text


def parse_and_insert(csv_text, forecast_date, conn):
    """Parse CSV and insert rows into DB."""
    df = pd.read_csv(StringIO(csv_text))

    # Rename columns
    df = df.rename(columns=COL_MAP)

    # Add forecast_date
    df["forecast_date"] = forecast_date

    # Keep only DB columns (drop NAME_0, n_buffer_polygons etc.)
    df = df[[c for c in DB_COLUMNS if c in df.columns]]

    # Replace NaN with None for PostgreSQL NULL
    df = df.where(pd.notnull(df), None)

    # Build tuples
    rows = [tuple(row[c] for c in DB_COLUMNS) for _, row in df.iterrows()]

    # Insert (ON CONFLICT skip — idempotent)
    insert_sql = f"""
        INSERT INTO country_forecast_weekly ({', '.join(DB_COLUMNS)})
        VALUES %s
        ON CONFLICT (gid_0, forecast_date) DO NOTHING
    """
    with conn.cursor() as cur:
        execute_values(cur, insert_sql, rows)
    conn.commit()
    print(f"  ✅ Inserted {len(rows)} rows for forecast_date={forecast_date}")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Ingest subseasonal CSV into PostGIS")
    parser.add_argument("--backfill", action="store_true", help="Import ALL available CSVs")
    parser.add_argument("--file", type=str, help="Path to local CSV file (manual import)")
    parser.add_argument("--date", type=str, help="Forecast date YYYY-MM-DD (required with --file)")
    args = parser.parse_args()

    conn = psycopg2.connect(host=PG_HOST, port=PG_PORT, dbname=PG_DB, user=PG_USER, password=PG_PASS)
    existing = get_existing_dates(conn)
    print(f"📊 Existing forecast dates in DB: {len(existing)}")

    if args.file:
        # Manual single file import
        if not args.date:
            print("❌ --date is required with --file")
            sys.exit(1)
        forecast_dt = date.fromisoformat(args.date)
        with open(args.file, "r") as f:
            csv_text = f.read()
        parse_and_insert(csv_text, forecast_dt, conn)

    else:
        # Auto-discover from FTP
        print(f"🔍 Scanning JRC FTP: {BASE_URL}")
        all_csvs = discover_csvs()
        print(f"   Found {len(all_csvs)} CSV(s) on server")

        if not args.backfill:
            # Only latest
            all_csvs = [all_csvs[-1]] if all_csvs else []

        new_csvs = [(dt, url) for dt, url in all_csvs if dt not in existing]
        print(f"   New (not yet in DB): {len(new_csvs)}")

        for forecast_dt, csv_url in new_csvs:
            print(f"\n📥 Processing forecast_date={forecast_dt}")
            csv_text = download_csv(csv_url)
            parse_and_insert(csv_text, forecast_dt, conn)

    conn.close()
    print("\n🏁 Done!")


if __name__ == "__main__":
    main()
