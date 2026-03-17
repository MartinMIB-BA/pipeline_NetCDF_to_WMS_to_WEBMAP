"""
File processing tracking system using PostgreSQL/PostGIS.
Records which NetCDF files have been processed to enable efficient incremental updates.
"""

from __future__ import annotations

import psycopg2
import contextlib
from datetime import datetime
from typing import List, Optional, Tuple, Dict, Any, Generator

from . import config


@contextlib.contextmanager
def get_db_cursor(commit: bool = False) -> Generator[Any, None, None]:
    """
    Context manager for database connections.
    Ensures connection is always closed, even on error.
    """
    conn = None
    try:
        conn = psycopg2.connect(
            host=config.PG_HOST_LOCAL,
            port=config.PG_PORT,
            dbname=config.PG_DB,
            user=config.PG_USER,
            password=config.PG_PASS
        )
        if commit:
            conn.autocommit = False # We will manage transaction
        else:
            conn.autocommit = True # Read-only mostly
            
        cur = conn.cursor()
        try:
            # Ensure public schema is selected
            cur.execute("SET search_path TO public")
             
            yield cur
            if commit:
                conn.commit()
        except Exception:
            if commit:
                conn.rollback()
            raise
        finally:
            cur.close()
    finally:
        if conn:
            conn.close()


def initialize_tracking_db() -> None:
    """
    Initialize tracking database schema.
    Creates wms_processing_log table if it doesn't exist.
    """
    with get_db_cursor(commit=True) as cur:
        # Create tracking table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS wms_processing_log (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) NOT NULL UNIQUE,
                issue_timestamp VARCHAR(12) NOT NULL,
                file_url TEXT,
                file_size_bytes BIGINT,
                download_date TIMESTAMP,
                processing_start TIMESTAMP,
                processing_end TIMESTAMP,
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                layer_type VARCHAR(50),
                layers_processed TEXT[],
                error_message TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        
        # Create indexes
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_filename 
            ON wms_processing_log(filename)
        """)
        
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_issue_timestamp 
            ON wms_processing_log(issue_timestamp)
        """)
        
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_status 
            ON wms_processing_log(status)
        """)
        
    print("✅ Tracking database initialized")


def is_file_processed(filename: str, issue_timestamp: str) -> bool:
    """
    Check if a file has already been successfully processed.
    """
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT 1 FROM wms_processing_log 
            WHERE filename = %s 
            AND issue_timestamp = %s 
            AND status = 'success'
            LIMIT 1
        """, (filename, issue_timestamp))
        
        return cur.fetchone() is not None


def mark_file_downloading(
    filename: str,
    issue_timestamp: str,
    file_url: str,
    file_size: Optional[int] = None
) -> None:
    """
    Mark file as being downloaded.
    """
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            INSERT INTO wms_processing_log 
                (filename, issue_timestamp, file_url, file_size_bytes, download_date, status)
            VALUES (%s, %s, %s, %s, NOW(), 'downloading')
            ON CONFLICT (filename) 
            DO UPDATE SET
                download_date = NOW(),
                file_url = EXCLUDED.file_url,
                file_size_bytes = EXCLUDED.file_size_bytes,
                status = 'downloading',
                updated_at = NOW()
        """, (filename, issue_timestamp, file_url, file_size))


def mark_file_processing(filename: str, layer_type: str) -> None:
    """
    Mark file as being processed.
    """
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            UPDATE wms_processing_log
            SET status = 'processing',
                layer_type = %s,
                processing_start = NOW(),
                updated_at = NOW()
            WHERE filename = %s
        """, (layer_type, filename))


def mark_file_success(filename: str, layers: List[str]) -> None:
    """
    Mark file as successfully processed.
    """
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            UPDATE wms_processing_log
            SET status = 'success',
                layers_processed = %s,
                processing_end = NOW(),
                error_message = NULL,
                updated_at = NOW()
            WHERE filename = %s
        """, (layers, filename))


def mark_file_failed(filename: str, error: str) -> None:
    """
    Mark file as failed processing.
    """
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            UPDATE wms_processing_log
            SET status = 'failed',
                error_message = %s,
                processing_end = NOW(),
                updated_at = NOW()
            WHERE filename = %s
        """, (error, filename))


def get_unprocessed_files(file_list: List[Tuple[str, str]]) -> List[Tuple[str, str]]:
    """
    Filter file list to only unprocessed files.
    """
    if not file_list:
        return []
    
    with get_db_cursor() as cur:
        # Get all successfully processed files
        cur.execute("""
            SELECT filename FROM wms_processing_log 
            WHERE status = 'success'
        """)
        
        processed = {row[0] for row in cur.fetchall()}
        
        # Filter out processed files
        return [
            (fname, ts) for fname, ts in file_list 
            if fname not in processed
        ]


def get_processing_stats() -> Dict[str, Any]:
    """
    Get processing statistics.
    """
    with get_db_cursor() as cur:
        # Count by status
        cur.execute("""
            SELECT status, COUNT(*) 
            FROM wms_processing_log 
            GROUP BY status
        """)
        
        stats = {
            'by_status': dict(cur.fetchall()),
            'total': 0
        }
        
        # Total count
        cur.execute("SELECT COUNT(*) FROM wms_processing_log")
        stats['total'] = cur.fetchone()[0]
        
        # Recent failures
        cur.execute("""
            SELECT filename, error_message, updated_at
            FROM wms_processing_log
            WHERE status = 'failed'
            ORDER BY updated_at DESC
            LIMIT 5
        """)
        
        stats['recent_failures'] = [
            {'filename': row[0], 'error': row[1], 'date': row[2]}
            for row in cur.fetchall()
        ]
        
        return stats


def reset_file_status(filename: str) -> bool:
    """
    Reset file status to allow reprocessing.
    """
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            DELETE FROM wms_processing_log
            WHERE filename = %s
        """, (filename,))
        
        return cur.rowcount > 0
