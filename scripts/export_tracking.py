#!/usr/bin/env python3
"""
Export tracking data to CSV.
"""

import csv
import sys
from datetime import datetime

from lib import config, tracking


def export_to_csv(filename="wms_tracking_export.csv"):
    """Export tracking data to CSV file."""
    
    with tracking.get_db_cursor() as cur:
        # Get all data
        cur.execute("""
            SELECT 
                id,
                filename,
                issue_timestamp,
                file_url,
                file_size_bytes,
                download_date,
                processing_start,
                processing_end,
                status,
                layer_type,
                layers_processed,
                error_message,
                created_at,
                updated_at
            FROM wms_processing_log
            ORDER BY processing_end DESC NULLS LAST
        """)
        
        # Get column names
        columns = [desc[0] for desc in cur.description]
        
        # Write to CSV
        with open(filename, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            
            # Header
            writer.writerow(columns)
            
            # Data
            for row in cur.fetchall():
                writer.writerow(row)
        
        print(f"✅ Exported to: {filename}")
        print(f"   Total rows: {cur.rowcount}")
        



def print_summary():
    """Print summary to console."""
    
    with tracking.get_db_cursor() as cur:
        print("\n" + "=" * 80)
        print("WMS PROCESSING LOG SUMMARY")
        print("=" * 80)
        
        # Total count
        cur.execute("SELECT COUNT(*) FROM wms_processing_log")
        total = cur.fetchone()[0]
        print(f"\nTotal files: {total}")
        
        # By status
        cur.execute("""
            SELECT status, COUNT(*) 
            FROM wms_processing_log 
            GROUP BY status 
            ORDER BY COUNT(*) DESC
        """)
        
        print("\nBy status:")
        for status, count in cur.fetchall():
            print(f"  {status:.<20} {count:>5} ({count/total*100:.1f}%)")
        
        # Recent successes
        cur.execute("""
            SELECT filename, processing_end 
            FROM wms_processing_log 
            WHERE status = 'success' 
            ORDER BY processing_end DESC 
            LIMIT 5
        """)
        
        print("\nRecent successes:")
        for filename, proc_end in cur.fetchall():
            print(f"  ✅ {filename}")
            print(f"     {proc_end}")
        
        # Recent failures
        cur.execute("""
            SELECT filename, error_message, updated_at 
            FROM wms_processing_log 
            WHERE status = 'failed' 
            ORDER BY updated_at DESC 
            LIMIT 5
        """)
        
        failures = cur.fetchall()
        if failures:
            print("\nRecent failures:")
            for filename, error, updated in failures:
                print(f"  ❌ {filename}")
                print(f"     Error: {error}")
                print(f"     Date: {updated}")
        
        print("\n" + "=" * 80)
        



if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "--summary":
            print_summary()
        else:
            export_to_csv(sys.argv[1])
    else:
        # Default: export to CSV
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"wms_tracking_{timestamp}.csv"
        export_to_csv(filename)
        print("\nUse --summary for console summary")
