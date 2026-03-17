import os
import sys
from dotenv import load_dotenv

# Load just like the app does
load_dotenv()

from lib import config

print("="*50)
print("DEBUG: Connection Configuration")
print("="*50)
print(f"User:     {config.PG_USER}")
print(f"Database: {config.PG_DB}")
print(f"Password: {config.PG_PASS}")
print(f"Host:     {config.PG_HOST_LOCAL}")
print(f"Port:     {config.PG_PORT}")
print("="*50)

# Check for environment variable overrides
print("\nEnvironment Variable Check:")
for var in ['PG_USER', 'PG_DB', 'PG_PASS']:
    val = os.environ.get(var)
    if val:
        print(f"  {var} is set in environment: {val}")
    else:
        print(f"  {var} is NOT set in environment (using .env or default)")

try:
    import psycopg2
    print("\nAttempting connection...")
    conn = psycopg2.connect(
        host=config.PG_HOST_LOCAL,
        port=config.PG_PORT,
        dbname=config.PG_DB,
        user=config.PG_USER,
        password=config.PG_PASS
    )
    print("✅ Connection SUCCESS!")
    conn.close()
except Exception as e:
    print(f"❌ Connection FAILED: {e}")
