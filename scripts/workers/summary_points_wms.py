#!/usr/bin/env python3
"""Summary Points WMS worker - processes coastal summary data (no RP dimension, TIME only)."""

from __future__ import annotations

import argparse
import os
import re
import zipfile
import json

import numpy as np
import xarray as xr
import rioxarray  # noqa

from lib import config
from lib.geoserver import (
    ensure_workspace,
    store_exists,
    delete_store_if_exists,
    wait_store_gone,
    upload_zip,
    reharvest_mosaic,
    wait_coverages,
    enable_time_dim,
    set_default_style,
)
from lib.netcdf_utils import parse_issue_dt_12_from_nc, yyyymmddhhmm_to_iso, ensure_lat_lon_da
from lib.postgis import ensure_postgis_schema, ensure_layer_indexes


# Coastal summary variables to process (single value per point, no RP dimension)
VARS = [
    "summary_twl_coast_01_01",
    "summary_twl_coast_01_03",
    "summary_twl_coast_01_15",
    "summary_twl_coast_04_15",
    "summary_twl_coast_10_15",
    "summary_epis_coast_01_01",
    "summary_epis_coast_01_03",
    "summary_epis_coast_01_15",
    "summary_epis_coast_04_15",
    "summary_epis_coast_10_15",
]


def write_mosaic_config(
    mosaic_dir: str,
    schema: str,
    pg_host_geoserver: str,
    pg_port: int,
    pg_db: str,
    pg_user: str,
    pg_pass: str,
) -> None:
    """Write ImageMosaic configuration for TIME dimension only (no elevation)."""
    with open(os.path.join(mosaic_dir, "indexer.properties"), "w") as f:
        f.write(
            "Schema=*the_geom:Polygon,location:String,ingestion:java.util.Date\n"
            "PropertyCollectors=TimestampFileNameExtractorSPI[timeregex](ingestion)\n"
            "TimeAttribute=ingestion\n"
            "Caching=false\n"
            "AbsolutePath=false\n"
        )

    with open(os.path.join(mosaic_dir, "timeregex.properties"), "w") as f:
        f.write("regex=.*_([0-9]{12})_.*?,format=yyyyMMddHHmm\n")

    with open(os.path.join(mosaic_dir, "datastore.properties"), "w") as f:
        f.write(
            "SPI=org.geotools.data.postgis.PostgisNGDataStoreFactory\n"
            "dbtype=postgis\n"
            f"host={pg_host_geoserver}\n"
            f"port={pg_port}\n"
            f"database={pg_db}\n"
            f"schema={schema}\n"
            f"user={pg_user}\n"
            f"passwd={pg_pass}\n"
            "validate connections=true\n"
            "max connections=10\n"
            "min connections=0\n"
        )


def build_arg_parser() -> argparse.ArgumentParser:
    """Build argument parser with defaults from config."""
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input-dir", default=config.INPUT_DIR)
    p.add_argument("--output-root", default=config.OUTPUT_ROOT)
    p.add_argument("--geoserver-url", default=config.GEOSERVER_URL)
    p.add_argument("--workspace", default=config.WORKSPACE)
    p.add_argument("--user", default=config.GEOSERVER_USER)
    p.add_argument("--password", default=config.GEOSERVER_PASSWORD)
    p.add_argument("--style", default=config.SUMMARY_STYLE)
    p.add_argument("--pg-host-local", default=config.PG_HOST_LOCAL)
    p.add_argument("--pg-port", type=int, default=config.PG_PORT)
    p.add_argument("--pg-db", default=config.PG_DB)
    p.add_argument("--pg-user", default=config.PG_USER)
    p.add_argument("--pg-pass", default=config.PG_PASS)
    p.add_argument("--pg-host-geoserver", default=config.PG_HOST_GEOSERVER)
    p.add_argument("--geoserver-data-dir", default=config.GEOSERVER_DATA_DIR)
    p.add_argument("--reset-each-store", action="store_true")
    p.add_argument("--no-reharvest", action="store_true")
    p.add_argument("--vars", nargs="+", default=VARS)
    return p


def main() -> None:
    """Process coastal summary point data and upload to GeoServer."""
    args = build_arg_parser().parse_args()

    # Load variable mapping
    script_dir = os.path.dirname(os.path.abspath(__file__))
    mapping_path = os.path.join(script_dir, "../variable_mapping.json")
    with open(mapping_path) as f:
        mapping = json.load(f)
        if "__comment__" in mapping:
            del mapping["__comment__"]

    auth = (args.user, args.password)

    os.makedirs(args.output_root, exist_ok=True)
    ensure_workspace(args.geoserver_url, auth, args.workspace)

    nc_files = sorted([f for f in os.listdir(args.input_dir) if f.endswith(".nc")])
    if not nc_files:
        raise RuntimeError(f"No .nc files in {args.input_dir}")

    for store_name in args.vars:
        source_aliases = mapping.get(store_name, [store_name])
        var_name = store_name
        schema = re.sub(r"[^a-z0-9_]+", "_", store_name.lower())

        exists = store_exists(args.geoserver_url, auth, args.workspace, store_name)
        if args.reset_each_store:
            if exists:
                print(f"🔄 Resetting store: {store_name}")
            delete_store_if_exists(args.geoserver_url, auth, args.workspace, store_name)
            wait_store_gone(args.geoserver_url, auth, args.workspace, store_name, timeout=90)
            exists = False
        elif exists:
            print(f"ℹ️  Store exists: {store_name} (will append new data)")

        ensure_postgis_schema(
            schema=schema,
            reset=args.reset_each_store,
            pg_host=args.pg_host_local,
            pg_port=args.pg_port,
            pg_db=args.pg_db,
            pg_user=args.pg_user,
            pg_pass=args.pg_pass,
        )

        mosaic_dir = os.path.join(args.output_root, store_name)
        if args.reset_each_store and os.path.isdir(mosaic_dir):
            for root, dirs, files in os.walk(mosaic_dir, topdown=False):
                for fn in files:
                    os.remove(os.path.join(root, fn))
                for d in dirs:
                    os.rmdir(os.path.join(root, d))
        os.makedirs(mosaic_dir, exist_ok=True)

        wrote_any = False
        times_for_test: list[str] = []

        # Process NetCDF files
        skipped_count = 0
        processed_count = 0

        for fn in nc_files:
            path = os.path.join(args.input_dir, fn)

            try:
                ds = xr.open_dataset(path, engine='netcdf4')
            except Exception as e:
                print(f"\n  ⚠️  Cannot open {fn}: {e}")
                print(f"  ⏭️  Skipping — file likely corrupted on source server.")
                print(f"      Will retry automatically on next cron run.\n")
                continue

            # Find which alias exists in this file
            valid_alias = None
            for alias in source_aliases:
                if alias in ds:
                    valid_alias = alias
                    break

            if not valid_alias:
                ds.close()
                continue

            issue_dt12 = parse_issue_dt_12_from_nc(fn)
            out_tif = os.path.join(mosaic_dir, f"{var_name}_{issue_dt12}_00.tif")

            if os.path.exists(out_tif):
                skipped_count += 1
                ds.close()
                continue

            print(f"\nProcessing {fn} - var={var_name}, issue={issue_dt12}")

            # Extract coastal point coordinates
            lat1d = ds["latitudeSATcoast"].values
            lon1d = ds["longitudeSATcoast"].values

            # Remove NaN coordinates
            mask = (~np.isnan(lat1d)) & (~np.isnan(lon1d))
            lat1d = lat1d[mask]
            lon1d = lon1d[mask]

            # Compute real pixel size
            dx = np.median(np.diff(np.unique(lon1d)))
            dy = np.median(np.diff(np.unique(lat1d)))
            print(f"  Detected coastal dx={dx}, dy={dy}")

            # Build regular grid
            min_lon = lon1d.min()
            max_lon = lon1d.max()
            min_lat = lat1d.min()
            max_lat = lat1d.max()

            lons = np.arange(min_lon, max_lon + dx, dx)
            lats = np.arange(min_lat, max_lat + dy, dy)

            # Create mapping
            lon_to_idx = {v: i for i, v in enumerate(lons)}
            lat_to_idx = {v: i for i, v in enumerate(lats)}

            # Snap original irregular lon/lat to nearest regular cell
            snapped_lon = np.array([lons[np.argmin(np.abs(lons - x))] for x in lon1d])
            snapped_lat = np.array([lats[np.argmin(np.abs(lats - y))] for y in lat1d])

            # Extract values — 1D array (no RP dimension)
            vals = ds[valid_alias].values[mask].astype("float32")

            # Create empty grid and fill
            grid = np.full((len(lats), len(lons)), np.nan, dtype="float32")
            for i in range(len(vals)):
                iy = lat_to_idx[snapped_lat[i]]
                ix = lon_to_idx[snapped_lon[i]]
                grid[iy, ix] = vals[i]

            # Convert to DataArray
            da = xr.DataArray(
                grid,
                coords={"lat": lats, "lon": lons},
                dims=("lat", "lon"),
            )

            da = ensure_lat_lon_da(da)
            da.rio.write_nodata(-9999.0, inplace=True)

            # Save as GeoTIFF
            da.rio.to_raster(out_tif, compress="LZW", tiled=True, blockxsize=256, blockysize=256)
            print(f"  Saved {out_tif}")
            processed_count += 1
            wrote_any = True

            ds.close()
            times_for_test.append(issue_dt12)

        if skipped_count > 0:
            print(f"  Skipped {skipped_count} existing file(s)")
        if processed_count > 0:
            print(f"  Processed {processed_count} new file(s)")

        if not wrote_any:
            print(f"[SKIP] {var_name}: not found in NC files")
            continue

        # Write mosaic config
        write_mosaic_config(
            mosaic_dir,
            schema,
            pg_host_geoserver=args.pg_host_geoserver,
            pg_port=args.pg_port,
            pg_db=args.pg_db,
            pg_user=args.pg_user,
            pg_pass=args.pg_pass,
        )

        # Create ZIP and upload
        zip_path = os.path.join(args.output_root, f"{store_name}.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for root, _, files in os.walk(mosaic_dir):
                for f in files:
                    full = os.path.join(root, f)
                    arc = os.path.relpath(full, mosaic_dir)
                    z.write(full, arc)

        configure = "all"
        r = upload_zip(args.geoserver_url, auth, args.workspace, store_name, zip_path, configure)
        if r.status_code >= 300:
            raise RuntimeError(f"Upload failed (HTTP {r.status_code}): {r.text}")

        # Reharvest if needed
        if exists and not args.no_reharvest:
            gs_mosaic_dir = f"{args.geoserver_data_dir}/data/{args.workspace}/{store_name}"
            reharvest_mosaic(args.geoserver_url, auth, args.workspace, store_name, gs_mosaic_dir)

        # Enable TIME dimension only (no elevation for summary layers)
        covs = wait_coverages(args.geoserver_url, auth, args.workspace, store_name, timeout=90)
        if not covs:
            raise RuntimeError(f"Store created but no coverages detected for {store_name}")

        for cov in covs:
            enable_time_dim(args.geoserver_url, auth, args.workspace, store_name, cov)
            set_default_style(args.geoserver_url, auth, args.workspace, cov, args.style)

        # Ensure performance indexes
        ensure_layer_indexes(
            schema=schema,
            pg_host=args.pg_host_local,
            pg_port=args.pg_port,
            pg_db=args.pg_db,
            pg_user=args.pg_user,
            pg_pass=args.pg_pass,
        )

        t0 = sorted(times_for_test)[0]
        print(f"OK: {store_name} (schema={schema}, time={yyyymmddhhmm_to_iso(t0)})")


if __name__ == "__main__":
    main()
