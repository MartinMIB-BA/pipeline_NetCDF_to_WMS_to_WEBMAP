#!/usr/bin/env python3
"""
Orchestrator script - STREAM PROCESSING MODE
Downloads and processes one NetCDF file at a time through entire pipeline.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

from lib import config, download, tracking
from lib.download import parse_timestamp_from_filename


def print_stats():
    """Print processing statistics."""
    try:
        stats = tracking.get_processing_stats()
        
        print("\n" + "=" * 70)
        print("📊 PROCESSING STATISTICS")
        print("=" * 70)
        
        print(f"\nTotal files tracked: {stats['total']}")
        
        if stats['by_status']:
            print("\nBy status:")
            for status, count in stats['by_status'].items():
                print(f"  {status:.<20} {count}")
        
        if stats['recent_failures']:
            print("\nRecent failures:")
            for failure in stats['recent_failures']:
                print(f"  ❌ {failure['filename']}")
                print(f"     Error: {failure['error']}")
                print(f"     Date: {failure['date']}")
        
        print("=" * 70)
        
    except Exception as e:
        print(f"❌ Error getting stats: {e}")


def process_single_file(nc_path: str, worker_module: str, extra_args: list) -> bool:
    """
    Process a single NetCDF file with specified worker.
    
    Args:
        nc_path: Path to NetCDF file
        worker_module: Worker module name (e.g., 'workers.static_wms')
        extra_args: Extra arguments for worker
        
    Returns:
        True if successful, False otherwise
    """
    # Create temp input dir with just this file
    temp_input = tempfile.mkdtemp(prefix="wms_single_")
    
    try:
        # Copy NC file to temp input
        filename = os.path.basename(nc_path)
        temp_nc = os.path.join(temp_input, filename)
        shutil.copy2(nc_path, temp_nc)
        
        # Run worker on this single file
        cmd = [sys.executable, "-m", worker_module, "--input-dir", temp_input] + extra_args
        result = subprocess.run(cmd, check=False)
        
        return result.returncode == 0
        
    finally:
        # Cleanup temp input
        if os.path.exists(temp_input):
            shutil.rmtree(temp_input)


def main():
    parser = argparse.ArgumentParser(
        description="Run all WMS workers - STREAM PROCESSING MODE"
    )
    parser.add_argument("--reset-each-store", action="store_true", help="Reset GeoServer stores before upload")
    parser.add_argument("--no-reharvest", action="store_true", help="Skip reharvest step")
    parser.add_argument("--use-url", action="store_true", help="Download from URL instead of using local files")
    parser.add_argument("--no-cleanup", action="store_true", help="Don't cleanup geoserver_ready after each file")
    parser.add_argument("--stats", action="store_true", help="Show processing statistics and exit")
    parser.add_argument("--reset-file", metavar="FILENAME", help="Reset file status to allow reprocessing")
    parser.add_argument("--force-reprocess", action="store_true", help="Force reprocess all files (ignore tracking)")
    parser.add_argument("--no-tracking", action="store_true", help="Disable tracking system")
    args = parser.parse_args()
    
    # Initialize tracking database
    use_tracking = not args.no_tracking
        
    if use_tracking:
        try:
            print("🔧 Initializing tracking database...")
            tracking.initialize_tracking_db()
        except Exception as e:
            print(f"⚠️  Tracking initialization failed: {e}")
            sys.exit(1)
    
    # Handle special commands
    if args.stats:
        print_stats()
        return 0
    
    if args.reset_file:
        if tracking.reset_file_status(args.reset_file):
            print(f"✅ Reset file: {args.reset_file}")
        else:
            print(f"❌ File not found: {args.reset_file}")
        return 0
    
    # Determine settings
    use_url = args.use_url or config.USE_URL_DOWNLOAD
    auto_cleanup = not args.no_cleanup and config.AUTO_CLEANUP
    force_reprocess = args.force_reprocess
    
    print("=" * 70)
    print("WMS PROCESSING PIPELINE - STREAM MODE")
    print("=" * 70)
    print(f"Tracking: {'✅ Enabled' if use_tracking else '❌ Disabled'}")
    print(f"Mode: 🔄 Stream (one file at a time)")
    print(f"Auto-cleanup: {'✅ Yes' if auto_cleanup else '❌ No'}")
    
    # Get list of files to process
    files_to_process = []
    
    if use_url:
        print(f"\n📥 Auto-discovering NetCDF files...")
        print(f"   Base URL: {config.BASE_URL}")
        print(f"   Years: {config.YEARS_TO_PROCESS}")
        print(f"   Hours: {config.HOURS}\n")
        
        # Use auto-discovery iterator (with PostgreSQL tracking)
        from lib.download import iterate_all_files_in_year
        
        for filename, file_url, metadata in iterate_all_files_in_year(
            base_url=config.BASE_URL,
            years=config.YEARS_TO_PROCESS,
            hours=config.HOURS,
            use_tracking=use_tracking and not force_reprocess
        ):
            source_url = metadata['source_url']
            files_to_process.append((filename, file_url, source_url))
        
        if not files_to_process:
            print("\n✅ All files already processed!")
            return 0
        
        print(f"\n📋 Found {len(files_to_process)} file(s) to process\n")
    else:
        print(f"\n📂 Using local NetCDF files from: {config.INPUT_DIR}")
        nc_files = sorted([f for f in os.listdir(config.INPUT_DIR) if f.endswith('.nc')])
        files_to_process = [(f, None, None) for f in nc_files]
    
    # Build common arguments for workers
    extra_args = []
    if args.reset_each_store:
        extra_args.append("--reset-each-store")
    if args.no_reharvest:
        extra_args.append("--no-reharvest")
    
    # Worker modules
    workers = [
        ("static_wms", "workers.static_wms"),
        ("video_wms", "workers.video_wms"),
        ("points_wms", "workers.points_wms"),
    ]
    
    # Process each file through entire pipeline
    total_files = len(files_to_process)
    processed_count = 0
    failed_count = 0
    
    for idx, (filename, file_url, source_url) in enumerate(files_to_process, 1):
        print("\n" + "=" * 70)
        print(f"📄 FILE {idx}/{total_files}: {filename}")
        print("=" * 70)
        
        temp_nc = None
        
        try:
            # Download file if from URL
            if file_url:
                temp_dir = tempfile.mkdtemp(prefix="wms_stream_")
                temp_nc = os.path.join(temp_dir, filename)
                
                print(f"\n1️⃣  Downloading from: {source_url}")
                if download.download_nc_file(file_url, temp_nc):
                    # Mark as downloading in tracking
                    if use_tracking:
                        timestamp = parse_timestamp_from_filename(filename)
                        tracking.mark_file_downloading(filename, timestamp, file_url, None)
                else:
                    raise Exception("Download failed")
            else:
                temp_nc = os.path.join(config.INPUT_DIR, filename)
            
            # Process with each worker
            print(f"\n2️⃣  Processing through workers...")
            
            all_success = True
            for worker_name, worker_module in workers:
                print(f"\n   → {worker_name}...")
                
                if use_tracking:
                    tracking.mark_file_processing(filename, worker_name)
                
                success = process_single_file(temp_nc, worker_module, extra_args)
                
                if not success:
                    all_success = False
                    error_msg = f"Worker {worker_name} failed"
                    print(f"   ❌ {error_msg}")
                    
                    if use_tracking:
                        tracking.mark_file_failed(filename, error_msg)
                    break
                else:
                    print(f"   ✅ {worker_name} complete")
            
            if all_success:
                print(f"\n3️⃣  ✅ Upload complete!")
                
                if use_tracking:
                    tracking.mark_file_success(filename, [w[0] for w in workers])
                
                processed_count += 1
            else:
                failed_count += 1
            
            # Cleanup per-file
            if auto_cleanup and os.path.exists(config.OUTPUT_ROOT):
                print(f"\n4️⃣  🧹 Cleaning up GeoTIFFs...")
                shutil.rmtree(config.OUTPUT_ROOT)
                os.makedirs(config.OUTPUT_ROOT, exist_ok=True)
            
        except Exception as e:
            print(f"\n❌ Error processing {filename}: {e}")
            if use_tracking:
                tracking.mark_file_failed(filename, str(e))
            failed_count += 1
            
        finally:
            # Cleanup temp NC file
            if file_url and temp_nc and os.path.exists(os.path.dirname(temp_nc)):
                print(f"   🧹 Cleaning up temp download...")
                shutil.rmtree(os.path.dirname(temp_nc))
    
    # Final summary
    print("\n" + "=" * 70)
    print("🏁 PROCESSING COMPLETE")
    print("=" * 70)
    print(f"✅ Processed: {processed_count}/{total_files}")
    print(f"❌ Failed: {failed_count}/{total_files}")
    print("=" * 70)
    
    # Show stats
    if use_tracking:
        print_stats()
    
    return 0 if failed_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
