"""PostGIS database utilities."""

from __future__ import annotations

import psycopg2


def ensure_postgis_schema(
    schema: str, reset: bool, pg_host: str, pg_port: int, pg_db: str, pg_user: str, pg_pass: str
) -> None:
    """Create or reset PostGIS schema for ImageMosaic index."""
    conn = None
    try:
        conn = psycopg2.connect(host=pg_host, port=pg_port, dbname=pg_db, user=pg_user, password=pg_pass)
        conn.autocommit = True
        cur = conn.cursor()
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
            if reset:
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE;')
            cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}";')
            cur.execute(f'GRANT ALL ON SCHEMA "{schema}" TO "{pg_user}";')
        finally:
            cur.close()
    finally:
        if conn:
            conn.close()


def ensure_layer_indexes(
    schema: str, pg_host: str, pg_port: int, pg_db: str, pg_user: str, pg_pass: str
) -> int:
    """
    Ensure performance indexes exist for the given schema's main table.
    Focuses on 'ingestion' and 'elevation' columns.
    Returns number of indexes created.
    """
    conn = None
    try:
        conn = psycopg2.connect(host=pg_host, port=pg_port, dbname=pg_db, user=pg_user, password=pg_pass)
        conn.autocommit = True
        cur = conn.cursor()
        created_count = 0
        
        try:
            # 1. Find the table in the schema (ImageMosaic usually creates one)
            cur.execute(f"SELECT tablename FROM pg_tables WHERE schemaname = '{schema}';")
            tables = [r[0] for r in cur.fetchall()]
            
            if not tables:
                return 0
                
            target_table = tables[0] # Assume main table
            full_table_name = f'"{schema}"."{target_table}"'
            
            # 2. Get existing indexes
            cur.execute(f"""
                SELECT indexdef 
                FROM pg_indexes 
                WHERE schemaname = '{schema}' AND tablename = '{target_table}';
            """)
            index_defs = [r[0] for r in cur.fetchall()]
            
            # 3. Check and create indexes
            cols_to_index = ["ingestion", "elevation"]
            
            for col in cols_to_index:
                # Check if column exists
                cur.execute(f"""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_schema = '{schema}' AND table_name = '{target_table}' AND column_name = '{col}';
                """)
                if not cur.fetchone():
                    continue # Column doesn't exist

                # Check if index exists (simple string check)
                idx_exists = any(col in defn for defn in index_defs)
                
                if not idx_exists:
                    idx_name = f"idx_{schema}_{target_table}_{col}"[:63] # Truncate to max Pg identifier length
                    print(f"  ⚡ Creating index: {idx_name} ON {full_table_name}({col})")
                    try:
                        cur.execute(f'CREATE INDEX "{idx_name}" ON {full_table_name} ("{col}");')
                        created_count += 1
                    except Exception as e:
                        print(f"     ❌ Failed to create index: {e}")
        finally:
            cur.close()
    finally:
        if conn:
            conn.close()
        
    return created_count
