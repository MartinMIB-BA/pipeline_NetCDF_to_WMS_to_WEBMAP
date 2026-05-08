#!/usr/bin/env python3
"""
backfill.py — Manually backfill WMS data for a full year (or custom range).

Scans the JRC FTP server for all months of the given year, downloads any
files not yet processed (checked against PostgreSQL tracking), and runs
them through the full worker pipeline (static_wms, video_wms, points_wms).

Usage:
    python backfill.py                        # full year 2026 (default)
    python backfill.py --year 2025            # different year
    python backfill.py --year 2026 --from-month 3 --to-month 6  # Mar–Jun 2026
    python backfill.py --dry-run              # show what would be downloaded, no processing
    python backfill.py --force                # re-process even already-successful files
"""

from __future__ import annotations

import argparse
import datetime
import os
import shutil
import subprocess
import sys
import tempfile

from lib import config, download, tracking
from lib.download import parse_timestamp_from_filename, iterate_files_in_periods


# ─── Workers ───────────────────────────────────────────────────────────────────
WORKERS = [
    ("static_wms",  "workers.static_wms"),
    ("video_wms",   "workers.video_wms"),
    ("points_wms",  "workers.points_wms"),
]


def process_single_file(nc_path: str, worker_module: str, extra_args: list) -> bool:
    """Run one worker subprocess on a single NC file."""
    temp_input = tempfile.mkdtemp(prefix="wms_backfill_")
    try:
        filename = os.path.basename(nc_path)
        shutil.copy2(nc_path, os.path.join(temp_input, filename))
        cmd = [sys.executable, "-m", worker_module, "--input-dir", temp_input] + extra_args
        result = subprocess.run(cmd, check=False)
        return result.returncode == 0
    finally:
        if os.path.exists(temp_input):
            shutil.rmtree(temp_input)


def build_periods(year: int, from_month: int, to_month: int) -> list[tuple[int, int]]:
    """Build list of (year, month) tuples to process."""
    today = datetime.date.today()
    periods = []
    for month in range(from_month, to_month + 1):
        # Don't go into the future
        if datetime.date(year, month, 1) > today.replace(day=1):
            break
        periods.append((year, month))
    return periods


def main():
    parser = argparse.ArgumentParser(
        description="Backfill WMS data for a full year from JRC FTP server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument("--year",       type=int, default=2026,   help="Year to backfill (default: 2026)")
    parser.add_argument("--from-month", type=int, default=1,      help="Start month 1-12 (default: 1)")
    parser.add_argument("--to-month",   type=int, default=12,     help="End month 1-12 (default: 12)")
    parser.add_argument("--dry-run",    action="store_true",       help="Only list files, do not download or process")
    parser.add_argument("--force",      action="store_true",       help="Re-process files already marked as success")
    parser.add_argument("--no-cleanup", action="store_true",       help="Keep GeoTIFFs after each file")
    parser.add_argument("--skip-file",  metavar="FILENAME",         help="Mark file as skipped so it is excluded from processing")
    args = parser.parse_args()

    # Handle --skip-file before anything else
    if args.skip_file:
        try:
            print("🔧 Initializing tracking database...")
            tracking.initialize_tracking_db()
            tracking.mark_file_skipped(args.skip_file, "Manually skipped — corrupted or unavailable source file")
            print(f"⏭️  Skipped file: {args.skip_file}")
            print(f"   (Use --reset-file via run_all_wms.py to un-skip when the file is fixed)")
        except Exception as e:
            print(f"❌ Failed to skip file: {e}")
            return 1
        return 0

    periods = build_periods(args.year, args.from_month, args.to_month)

    if not periods:
        print("No periods to process.")
        return 0

    print("\n" + "=" * 70)
    print("  WMS BACKFILL")
    print("=" * 70)
    print(f"  Year     : {args.year}")
    print(f"  Months   : {args.from_month} – {min(args.to_month, periods[-1][1])}")
    print(f"  Periods  : {[f'{y}/{m:02d}' for y, m in periods]}")
    print(f"  Mode     : {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"  Force    : {'Yes (re-process successes)' if args.force else 'No (skip already done)'}")
    print("=" * 70 + "\n")

    # Init tracking
    try:
        print("🔧 Initializing tracking database...")
        tracking.initialize_tracking_db()
    except Exception as e:
        print(f"❌ Tracking init failed: {e}")
        return 1

    # Discover files
    use_tracking = not args.force
    files_to_process = []
    for filename, file_url, metadata in iterate_files_in_periods(
        base_url=config.BASE_URL,
        periods=periods,
        hours=config.HOURS,
        use_tracking=use_tracking
    ):
        files_to_process.append((filename, file_url, metadata))

    if not files_to_process:
        print("\n✅ All files already processed — nothing to do.")
        return 0

    print(f"\n📋 Found {len(files_to_process)} file(s) to process\n")

    if args.dry_run:
        print("DRY RUN — files that would be downloaded:")
        for filename, _, meta in files_to_process:
            print(f"  {meta['year']}/{meta['month']}/{meta['day']}/{meta['hour']}  →  {filename}")
        return 0

    # Process each file
    auto_cleanup = not args.no_cleanup
    total = len(files_to_process)
    success_count = 0
    failed_count = 0

    for idx, (filename, file_url, metadata) in enumerate(files_to_process, 1):
        print("\n" + "=" * 70)
        print(f"📄 FILE {idx}/{total}: {filename}")
        print(f"   Period: {metadata['year']}/{metadata['month']}/{metadata['day']}/{metadata['hour']}")
        print("=" * 70)

        temp_dir = tempfile.mkdtemp(prefix="wms_backfill_dl_")
        temp_nc  = os.path.join(temp_dir, filename)

        try:
            # Download
            print(f"\n1️⃣  Downloading from: {metadata['source_url']}")
            if not download.download_nc_file(file_url, temp_nc):
                raise RuntimeError("Download failed")

            timestamp = parse_timestamp_from_filename(filename)
            tracking.mark_file_downloading(filename, timestamp, file_url, None)

            # Run workers
            print(f"\n2️⃣  Processing through workers...")
            all_ok = True
            for worker_name, worker_module in WORKERS:
                print(f"\n   → {worker_name}...")
                tracking.mark_file_processing(filename, worker_name)
                ok = process_single_file(temp_nc, worker_module, [])
                if ok:
                    print(f"   ✅ {worker_name} done")
                else:
                    print(f"   ❌ {worker_name} failed")
                    tracking.mark_file_failed(filename, f"Worker {worker_name} failed")
                    all_ok = False
                    break

            if all_ok:
                tracking.mark_file_success(filename, [w[0] for w in WORKERS])
                success_count += 1
                print(f"\n3️⃣  ✅ Done")
            else:
                failed_count += 1

            # Cleanup GeoTIFFs
            if auto_cleanup and os.path.exists(config.OUTPUT_ROOT):
                print(f"\n4️⃣  🧹 Cleaning up GeoTIFFs...")
                shutil.rmtree(config.OUTPUT_ROOT)
                os.makedirs(config.OUTPUT_ROOT, exist_ok=True)

        except Exception as e:
            print(f"\n❌ Error: {e}")
            tracking.mark_file_failed(filename, str(e))
            failed_count += 1

        finally:
            if os.path.exists(temp_dir):
                print("   🧹 Cleaning up temp download...")
                shutil.rmtree(temp_dir)

    # Summary
    print("\n" + "=" * 70)
    print("🏁  BACKFILL COMPLETE")
    print("=" * 70)
    print(f"  ✅ Success : {success_count}/{total}")
    print(f"  ❌ Failed  : {failed_count}/{total}")
    print("=" * 70 + "\n")

    return 0 if failed_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
