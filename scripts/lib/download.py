"""
NetCDF download utilities for WMS workers.
Downloads NetCDF files from remote HTTP/FTP sources.
"""

import os
import tempfile
import urllib.request
import urllib.parse
from typing import List, Optional
from html.parser import HTMLParser


class DirectoryListParser(HTMLParser):
    """Parse Apache/Nginx directory listing to find files or folders."""
    
    def __init__(self, filter_extension=None, folders_only=False):
        super().__init__()
        self.items = []
        self.filter_extension = filter_extension
        self.folders_only = folders_only
        
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            for attr, value in attrs:
                if attr == 'href':
                    # Skip parent directory
                    if value == '../':
                        continue
                    
                    # Skip absolute URLs (http://, https://, ftp://)
                    if value.startswith(('http://', 'https://', 'ftp://', '//')):
                        continue
                    
                    # Skip paths starting with / (absolute paths)
                    if value.startswith('/'):
                        continue
                    
                    if self.folders_only:
                        # Collect folders (end with /)
                        if value.endswith('/'):
                            # Extract just the folder name, not the full path
                            folder_name = value.rstrip('/').split('/')[-1]
                            if folder_name:  # Ignore empty strings
                                self.items.append(folder_name)
                    elif self.filter_extension:
                        # Filter by extension
                        if value.endswith(self.filter_extension):
                            # Extract just the filename
                            filename = value.split('/')[-1]
                            if filename:
                                self.items.append(filename)
                    else:
                        # Collect everything
                        item_name = value.rstrip('/').split('/')[-1]
                        if item_name:
                            self.items.append(item_name)


def list_remote_nc_files(base_url: str) -> List[str]:
    """
    List all .nc files from a remote directory.
    
    Args:
        base_url: URL to directory (e.g., https://example.com/data/)
        
    Returns:
        List of .nc filenames
    """
    try:
        with urllib.request.urlopen(base_url, timeout=30) as response:
            html = response.read().decode('utf-8')
            
        parser = DirectoryListParser(filter_extension='.nc')
        parser.feed(html)
        
        return parser.items
    except Exception as e:
        print(f"Warning: Could not list files from {base_url}: {e}")
        return []


def list_remote_folders(url: str) -> List[str]:
    """
    List all subdirectories from a remote directory.
    
    Args:
        url: URL to directory (e.g., https://example.com/2026/)
        
    Returns:
        List of folder names (without trailing /)
    """
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            html = response.read().decode('utf-8')
            
        parser = DirectoryListParser(folders_only=True)
        parser.feed(html)
        
        return parser.items
    except Exception:
        # 404 or other errors - return empty list
        return []


def iterate_files_in_periods(
    base_url: str,
    periods: List[tuple],
    hours: List[str] = None,
    use_tracking: bool = True
):
    """
    Automatically discover and iterate .nc files in specified (year, month) periods.
    
    Prehľadáva iba zadané (rok, mesiac) kombinácie – nie celý rok.
    
    Args:
        base_url: Base URL (e.g., ".../medium_term_forecasts/")
        periods: List of (year, month) tuples (e.g., [(2026, 3)])
        hours: Hour folders to check (default: ["00", "12"])
        use_tracking: Check PostgreSQL tracking (default: True)
    
    Yields:
        (filename, full_url, metadata) for unprocessed files only
    """
    if hours is None:
        hours = ["00", "12"]
    
    # Import tracking if enabled
    if use_tracking:
        try:
            from . import tracking
        except ImportError:
            use_tracking = False
            print("⚠️  Tracking not available")
    
    # Ensure base_url ends with /
    if not base_url.endswith('/'):
        base_url += '/'
    
    print(f"\n🔍 AUTO-DISCOVERING FILES")
    print(f"   Base URL: {base_url}")
    print(f"   Periods: {[f'{y}/{m:02d}' for y, m in periods]}")
    print(f"   Hours: {hours}\n")
    
    # ✅ OPTIMIZATION: Load all processed files ONCE (batch query)
    processed_files = set()
    if use_tracking:
        try:
            print(f"📊 Loading processed files from PostgreSQL...")
            # Get all successfully processed filenames
            with tracking.get_db_cursor() as cur:
                cur.execute("""
                    SELECT filename FROM wms_processing_log 
                    WHERE status = 'success'
                """)
                processed_files = {row[0] for row in cur.fetchall()}
                print(f"   ✅ Loaded {len(processed_files)} processed file(s)\n")
        except Exception as e:
            print(f"   ⚠️  Tracking load failed: {e}\n")
    
    total_files = 0
    skipped_files = 0
    
    for year, month in periods:
        month_str = f"{month:02d}"
        year_url = f"{base_url}{year}/"
        month_url = f"{year_url}{month_str}/"
        print(f"\n📅 Processing period: {year}/{month_str}")
        
        # Discover all day folders in the specific month
        days = list_remote_folders(month_url)
        if not days:
            print(f"   ⚠️  No day folders found in {year}/{month_str}")
            continue
        
        print(f"   ✅ Found {len(days)} day(s)")
        
        for day in sorted(days):
            day_url = f"{month_url}{day}/"
            
            for hour in hours:
                hour_url = f"{day_url}{hour}/"
                
                # List .nc files in this hour folder
                nc_files = list_remote_nc_files(hour_url)
                
                if not nc_files:
                    continue
                
                for nc_file in nc_files:
                    total_files += 1
                    
                    # ✅ FAST: In-memory lookup instead of database query
                    if use_tracking and nc_file in processed_files:
                        skipped_files += 1
                        continue  # Skip already processed
                    
                    # Build file URL and metadata
                    file_url = urllib.parse.urljoin(hour_url, nc_file)
                    
                    try:
                        timestamp = parse_timestamp_from_filename(nc_file)
                    except:
                        timestamp = "unknown"
                    
                    metadata = {
                        "year": year,
                        "month": month_str,
                        "day": day,
                        "hour": hour,
                        "timestamp": timestamp,
                        "source_url": hour_url
                    }
                    
                    # Yield unprocessed file
                    print(f"      📄 {year}/{month_str}/{day}/{hour}: {nc_file}")
                    yield (nc_file, file_url, metadata)
    
    print(f"\n📊 DISCOVERY SUMMARY")
    print(f"   Total files discovered: {total_files}")
    if use_tracking:
        print(f"   Already processed (skipped): {skipped_files}")
        print(f"   To download: {total_files - skipped_files}")



def download_nc_file(url: str, local_path: str) -> bool:
    """
    Download a NetCDF file from URL to local path with progress bar.
    
    Args:
        url: Full URL to .nc file
        local_path: Local filesystem path to save file
        
    Returns:
        True if successful, False otherwise
    """
    try:
        import sys
        from tqdm import tqdm
        
        # Get file size
        req = urllib.request.Request(url, method='HEAD')
        with urllib.request.urlopen(req, timeout=30) as response:
            file_size = int(response.headers.get('Content-Length', 0))
        
        # Download with progress bar
        filename = os.path.basename(url)
        
        with urllib.request.urlopen(url, timeout=120) as response:
            with open(local_path, 'wb') as f:
                with tqdm(
                    total=file_size,
                    unit='B',
                    unit_scale=True,
                    unit_divisor=1024,
                    desc=f"📥 {filename}",
                    ncols=80,
                    file=sys.stdout,
                    leave=False
                ) as pbar:
                    chunk_size = 8192
                    while True:
                        chunk = response.read(chunk_size)
                        if not chunk:
                            break
                        f.write(chunk)
                        pbar.update(len(chunk))
        
        print(f"✅ {filename}")
        return True
        
    except ImportError:
        # Fallback without progress bar if tqdm not installed
        print(f"  Downloading: {os.path.basename(url)} (install tqdm for progress bar)...")
        
        with urllib.request.urlopen(url, timeout=120) as response:
            with open(local_path, 'wb') as f:
                chunk_size = 8192
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
        
        print(f"  ✓ Downloaded: {os.path.basename(local_path)}")
        return True
        
    except Exception as e:
        print(f"  ✗ Download failed: {e}")
        return False


def download_from_url_pattern(
    base_url: str,
    temp_dir: str,
    subfolders: Optional[List[str]] = None,
    use_tracking: bool = True
) -> List[str]:
    """
    Download all .nc files from a URL and its subfolders.
    Skips files that have already been successfully processed (if tracking enabled).
    
    Args:
        base_url: Base URL (e.g., https://example.com/data/2026/01/01/)
        temp_dir: Local temporary directory to download to
        subfolders: List of subfolder names to check (e.g., ['00', '12'])
        use_tracking: If True, skip already-processed files
        
    Returns:
        List of downloaded file paths
    """
    downloaded_files = []
    
    # Import tracking here to avoid circular dependency
    if use_tracking:
        try:
            from . import tracking
        except ImportError:
            use_tracking = False
            print("⚠️  Tracking not available, downloading all files")
    
    # Ensure base_url ends with /
    if not base_url.endswith('/'):
        base_url += '/'
    
    # Collect all files to potentially download
    files_to_check = []
    
    # If subfolders specified, iterate through them
    if subfolders:
        for subfolder in subfolders:
            subfolder_url = urllib.parse.urljoin(base_url, subfolder + '/')
            print(f"\nChecking subfolder: {subfolder_url}")
            
            # List files in subfolder
            nc_files = list_remote_nc_files(subfolder_url)
            
            if not nc_files:
                print(f"  No .nc files found in {subfolder}/")
                continue
            
            print(f"  Found {len(nc_files)} .nc file(s)")
            
            # Add to check list with full URL
            for nc_file in nc_files:
                file_url = urllib.parse.urljoin(subfolder_url, nc_file)
                files_to_check.append((nc_file, file_url))
    else:
        # No subfolders, download directly from base_url
        print(f"\nChecking: {base_url}")
        nc_files = list_remote_nc_files(base_url)
        
        if not nc_files:
            print("  No .nc files found")
            return []
        
        print(f"  Found {len(nc_files)} .nc file(s)")
        
        for nc_file in nc_files:
            file_url = urllib.parse.urljoin(base_url, nc_file)
            files_to_check.append((nc_file, file_url))
    
    # Filter out already-processed files if tracking enabled
    if use_tracking and files_to_check:
        print(f"\n📊 Checking processing status...")
        
        # Extract timestamps and check tracking
        files_with_timestamps = []
        for nc_file, file_url in files_to_check:
            try:
                # Try to extract timestamp from filename
                timestamp = parse_timestamp_from_filename(nc_file)
                
                if tracking.is_file_processed(nc_file, timestamp):
                    print(f"  ⏭️  Skip (already processed): {nc_file}")
                    continue
                    
                files_with_timestamps.append((nc_file, file_url, timestamp))
                
            except Exception:
                # If can't extract timestamp, download anyway
                files_with_timestamps.append((nc_file, file_url, "unknown"))
        
        if not files_with_timestamps:
            print(f"\n✅ All files already processed! Nothing to download.")
            return []
        
        print(f"\n📥 Downloading {len(files_with_timestamps)} new/unprocessed file(s)...")
    else:
        files_with_timestamps = [(f[0], f[1], "unknown") for f in files_to_check]
    
    # Download files
    for nc_file, file_url, timestamp in files_with_timestamps:
        local_path = os.path.join(temp_dir, nc_file)
        
        if download_nc_file(file_url, local_path):
            downloaded_files.append(local_path)
            
            # Mark as downloading in tracking
            if use_tracking and timestamp != "unknown":
                try:
                    tracking.mark_file_downloading(nc_file, timestamp, file_url, None)
                except Exception as e:
                    print(f"  ⚠️  Tracking update failed: {e}")
    
    return downloaded_files


def parse_timestamp_from_filename(filename: str) -> str:
    """
    Extract YYYYMMDDHHMM timestamp from NetCDF filename.
    
    Args:
        filename: NetCDF filename
        
    Returns:
        12-digit timestamp string
        
    Raises:
        ValueError: If timestamp cannot be extracted
    """
    import re
    
    # Try pattern: _YYYYMMDDHHMM-
    m = re.search(r"_(\d{12})-", filename)
    if m:
        return m.group(1)
    
    # Try pattern: _YYYYMMDDHHMM.
    m = re.search(r"_(\d{12})\.", filename)
    if m:
        return m.group(1)
    
    # Try any 12 consecutive digits
    m = re.search(r"(\d{12})", filename)
    if m:
        return m.group(1)
    
    raise ValueError(f"Cannot extract timestamp from filename: {filename}")




