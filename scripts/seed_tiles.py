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
import concurrent.futures
import datetime
import json
import subprocess
import sys
import time
import urllib.parse

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
ZOOM_START  = 1
ZOOM_STOP   = 4
GRID_SET_ID = "EPSG:900913x2"            # Web Mercator x2 — matches Leaflet/GWC default
TILE_FORMAT = "image/png8"
THREAD_COUNT = 2                         # parallel GWC threads per seed job
PURGE_DAYS  = 7                          # truncate tiles older than N days

AUTH = (GEOSERVER_USER, GEOSERVER_PASS)

# ─── Nginx warm-up config ───────────────────────────────────────────────────────
NGINX_WARMUP_URL  = os.environ.get("NGINX_WARMUP_URL", "http://localhost")
READY_DATES_PATH  = os.environ.get("READY_DATES_PATH", "/opt/geoserver/web/ready_dates.json")
WARMUP_WORKERS    = 20                   # parallel curl-like requests for nginx warm-up
GWC_POLL_INTERVAL = 30                   # seconds between GWC status polls
GWC_TIMEOUT_MIN   = 30                   # max minutes to wait for GWC seeding

# ─── PostGIS helpers ────────────────────────────────────────────────────────────

def get_db_conn():
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        dbname=PG_DB, user=PG_USER, password=PG_PASS
    )


def get_recent_time_values(layer: str, days: int = 7) -> list[str]:
    """Return distinct ISO TIME strings from the last `days` days, newest first."""
    conn = get_db_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT DISTINCT ingestion
                FROM "{layer}"."{layer}"
                WHERE ingestion >= NOW() - INTERVAL '{days} days'
                ORDER BY ingestion DESC
            """)
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
                    {"string": ["ELEVATION", elev_val]},
                    {"string": ["STYLES",    "E_and_T:VIDEO_WMS"]}
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


# ─── GWC completion wait ────────────────────────────────────────────────────────

def wait_for_gwc_seeding(layer: str) -> bool:
    """
    Poll GWC REST API until all seed jobs for `layer` complete.
    Returns True if done within timeout, False if timeout exceeded.
    """
    full_layer = f"{WORKSPACE}:{layer}"
    url        = f"{GEOSERVER_URL}/gwc/rest/seed/{full_layer}.json"
    deadline   = time.time() + GWC_TIMEOUT_MIN * 60

    print(f"  ⏳ Waiting for GWC seeding to complete (max {GWC_TIMEOUT_MIN} min)...")
    while time.time() < deadline:
        try:
            r = requests.get(url, auth=AUTH, timeout=15)
            if r.status_code == 200:
                jobs = r.json().get("long-array-array", [])
                if not jobs:
                    print(f"  ✅ GWC seeding complete for {layer}")
                    return True
                # jobs: [tilesProcessed, tilesTotal, tilesRemaining, numThreads, taskId]
                remaining = sum(j[2] for j in jobs if len(j) > 2)
                print(f"  ⏳ {len(jobs)} job(s) active, ~{remaining:,} tiles remaining...")
            else:
                print(f"  ⚠️  GWC poll returned HTTP {r.status_code}")
        except Exception as exc:
            print(f"  ⚠️  GWC poll error: {exc}")
        time.sleep(GWC_POLL_INTERVAL)

    print(f"  ❌ GWC seeding timeout after {GWC_TIMEOUT_MIN} min for {layer}")
    return False


# ─── Nginx warm-up ─────────────────────────────────────────────────────────────

def compute_tile_bboxes() -> list[tuple]:
    """
    Compute all tile BBOXes for zoom levels ZOOM_START–ZOOM_STOP.

    Uses Node.js (V8) to replicate Leaflet's exact trigonometric chain
    (pixel → lat/lng via exp/atan → Web Mercator via sin/log), so the
    BBOX float strings match the nginx cache keys generated by the browser.

    Falls back to Python linear formula if Node.js is unavailable.
    Returns list of (zoom, col, row, minX, minY, maxX, maxY).
    """
    # ── Node.js path: exact Leaflet V8 math ───────────────────────────────
    # Leaflet's actual code path:
    #   1. pixels → CRS metres   (untransform)
    #   2. CRS metres → LatLng degrees   (SphericalMercator.unproject — introduces deg roundtrip)
    #   3. LatLng degrees → CRS metres   (SphericalMercator.project)
    # The degree roundtrip (step 2→3) causes tiny but deterministic ULP shifts in y
    # that must be matched exactly so the nginx cache key is identical to the browser URL.
    js_code = r"""
const R         = 6378137;
const TILE_SIZE = 512;
const zoomStart = %d;
const zoomStop  = %d;

// Replicates Leaflet's exact code path (including degrees roundtrip).
function pixelToMercator(px, py, scale) {
    // Step 1 — untransform: pixels → CRS metres (Leaflet CRS.EPSG3857 transformation)
    const x_m = (px / scale - 0.5) * 2 * Math.PI * R;
    const y_m = (0.5 - py / scale) * 2 * Math.PI * R;

    // Step 2 — SphericalMercator.unproject: metres → LatLng in DEGREES
    const lat_deg = (2 * Math.atan(Math.exp(y_m / R)) - Math.PI / 2) * (180 / Math.PI);
    const lng_deg = x_m / R * (180 / Math.PI);

    // Step 3 — SphericalMercator.project: LatLng degrees → CRS metres
    const d   = Math.PI / 180;
    const sin = Math.max(Math.min(Math.sin(lat_deg * d), 1 - 1e-15), -(1 - 1e-15));
    const x   = R * lng_deg * d;
    const y   = R * Math.log((1 + sin) / (1 - sin)) / 2;
    return [x, y];
}

const results = [];
for (let z = zoomStart; z <= zoomStop; z++) {
    const n     = 1 << z;          // 2^z
    const scale = TILE_SIZE * n;   // = TILE_SIZE * 2^z  (512-px tiles)
    for (let col = 0; col < n; col++) {
        for (let row = 0; row < n; row++) {
            // top-left corner → (minX, maxY)
            const [x1, y1] = pixelToMercator(col * TILE_SIZE,       row * TILE_SIZE,       scale);
            // bottom-right corner → (maxX, minY)
            const [x2, y2] = pixelToMercator((col + 1) * TILE_SIZE, (row + 1) * TILE_SIZE, scale);
            results.push([z, col, row, x1, y2, x2, y1]);  // minX, minY, maxX, maxY
        }
    }
}
process.stdout.write(JSON.stringify(results));
""" % (ZOOM_START, ZOOM_STOP)

    try:
        result = subprocess.run(
            ['node', '-e', js_code],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0 and result.stdout:
            raw = json.loads(result.stdout)
            bboxes = [tuple(item) for item in raw]
            print(f"  ✅ BBOX computed via Node.js V8 ({len(bboxes)} tiles)")
            return bboxes
        else:
            print(f"  ⚠️  Node.js BBOX failed (rc={result.returncode}): "
                  f"{result.stderr[:200]} — falling back to Python formula")
    except FileNotFoundError:
        print("  ⚠️  node not found — falling back to Python formula")
    except Exception as exc:
        print(f"  ⚠️  Node.js BBOX error: {exc} — falling back to Python formula")

    # ── Python fallback: linear formula (may differ by ~3 ULP on Y) ───────
    half_world = 20037508.342789244
    bboxes_fb: list[tuple] = []
    for z in range(ZOOM_START, ZOOM_STOP + 1):
        n         = 2 ** z
        tile_size = 2 * half_world / n
        for col in range(n):
            for row in range(n):
                minX = col * tile_size - half_world
                maxX = (col + 1) * tile_size - half_world
                maxY = half_world - row * tile_size
                minY = half_world - (row + 1) * tile_size
                bboxes_fb.append((z, col, row, minX, minY, maxX, maxY))
    return bboxes_fb


def _warmup_single(session: requests.Session, layer: str,
                   time_val: str, elev_val: str, bbox: tuple) -> bool:
    """Fire one nginx warmup request. Returns True on HTTP 200.

    IMPORTANT: bbox commas must be literal, NOT percent-encoded (%2C).
    Nginx cache key = full URI string.  Leaflet sends raw commas in bbox,
    so we must do the same — using requests' params= would encode them as %2C
    and the cache keys would never match.
    """
    _, _col, _row, minX, minY, maxX, maxY = bbox

    def _fmt(v: float) -> str:
        return str(int(v)) if v == int(v) else str(v)

    # Build bbox string with literal commas
    bbox_str = ','.join(_fmt(v) for v in (minX, minY, maxX, maxY))

    # Encode all other params normally, then append bbox manually
    qs = urllib.parse.urlencode({
        'service':     'WMS',
        'request':     'GetMap',
        'layers':      f'{WORKSPACE}:{layer}',
        'styles':      '',
        'format':      'image/png8',
        'transparent': 'true',
        'version':     '1.1.1',
        'time':        time_val,
        'elevation':   elev_val,
        'tiled':       'true',
        'SRS':         'EPSG:900913x2',
        'srs':         'EPSG:3857',
        'width':       '512',
        'height':      '512',
    })
    url = f"{NGINX_WARMUP_URL}/geoserver/gwc/service/wms?{qs}&bbox={bbox_str}"

    try:
        r = session.get(url, timeout=30)
        return r.status_code == 200
    except Exception:
        return False


def run_nginx_warmup(layer: str, time_vals: list[str],
                     elev_vals: list[str], dry_run: bool = False) -> bool:
    """
    Warm nginx proxy cache for every tile × time × elevation combination.
    Uses a thread pool (WARMUP_WORKERS) so all tiles fly in parallel.
    Returns True if all requests succeeded.
    """
    bboxes      = compute_tile_bboxes()
    total_tiles = len(time_vals) * len(elev_vals) * len(bboxes)

    if dry_run:
        print(f"  [DRY-RUN] WARMUP {layer}: "
              f"{len(time_vals)} time(s) × {len(elev_vals)} elev(s) "
              f"× {len(bboxes)} tiles = {total_tiles} requests")
        return True

    print(f"  🔥 Nginx warmup: {len(time_vals)} time(s) × {len(elev_vals)} elev(s) "
          f"× {len(bboxes)} tiles = {total_tiles} requests")

    tasks: list[tuple] = [
        (t, e, b)
        for t in time_vals
        for e in elev_vals
        for b in bboxes
    ]

    done = errors = 0
    session = requests.Session()
    session.headers.update({'Connection': 'keep-alive'})

    with concurrent.futures.ThreadPoolExecutor(max_workers=WARMUP_WORKERS) as pool:
        futs = {
            pool.submit(_warmup_single, session, layer, t, e, b): (t, e, b)
            for t, e, b in tasks
        }
        for fut in concurrent.futures.as_completed(futs):
            done += 1
            if not fut.result():
                errors += 1
            if done % 200 == 0 or done == total_tiles:
                sys.stdout.write(f"\r     Progress: {done}/{total_tiles} ({errors} errors)")
                sys.stdout.flush()

    print(f"\n  ✅ Nginx warmup done: {done - errors}/{done} tiles cached")
    return errors == 0


# ─── Ready-dates JSON ──────────────────────────────────────────────────────────

def write_ready_dates(all_seeded_times: list[str], dry_run: bool = False) -> None:
    """
    Merge newly seeded dates with any existing ready_dates.json,
    drop dates older than PURGE_DAYS, and write the file.
    The frontend reads this to block dates that are not yet fully cached.
    """
    now    = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    cutoff = now - datetime.timedelta(days=PURGE_DAYS)

    # Convert timestamps to YYYY-MM-DD date strings
    new_date_strs: set[str] = set()
    for t in all_seeded_times:
        try:
            d = datetime.datetime.fromisoformat(t.replace('Z', '+00:00')).date()
            if datetime.datetime.combine(d, datetime.time()) >= cutoff:
                new_date_strs.add(str(d))
        except ValueError:
            pass

    # Merge with existing ready dates (if any)
    existing: list[str] = []
    try:
        with open(READY_DATES_PATH) as f:
            existing = json.load(f).get("ready_dates", [])
    except FileNotFoundError:
        pass
    except Exception as exc:
        print(f"  ⚠️  Could not read existing {READY_DATES_PATH}: {exc}")

    # Keep existing dates that are still within the purge window
    for d in existing:
        try:
            if datetime.date.fromisoformat(d) >= cutoff.date():
                new_date_strs.add(d)
        except ValueError:
            pass

    ready = sorted(new_date_strs)
    data  = {
        "ready_dates": ready,
        "updated_at":  now.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    }

    if dry_run:
        print(f"  [DRY-RUN] Would write {READY_DATES_PATH}: {ready}")
        return

    try:
        with open(READY_DATES_PATH, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"  ✅ {READY_DATES_PATH} updated — {len(ready)} ready date(s): {ready}")
    except Exception as exc:
        print(f"  ❌ Failed to write {READY_DATES_PATH}: {exc}")


# ─── Main logic ────────────────────────────────────────────────────────────────

def run_seed(dry_run: bool = False, truncate_only: bool = False, days: int = 7):
    now    = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    before = now - datetime.timedelta(days=PURGE_DAYS)

    print(f"\n{'='*60}")
    print(f"  GWC Tile Seeder + Nginx Warm-up")
    print(f"  Mode     : {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"  Layers   : {LAYERS}")
    print(f"  Zoom     : {ZOOM_START}–{ZOOM_STOP}")
    print(f"  Seed     : last {days} day(s)")
    print(f"  Purge old: > {PURGE_DAYS} days (before {before.strftime('%Y-%m-%d')})")
    print(f"{'='*60}\n")

    # Collect seeded times per layer so we can warm-up and update ready_dates.json
    seeded_data: dict[str, tuple[list[str], list[str]]] = {}  # layer -> (times, elevs)

    # ── Phase 1: GWC truncate + seed (submit jobs) ─────────────────────────
    for layer in LAYERS:
        print(f"📦 Layer: {layer}")

        # 1a. Truncate old tiles
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

            print(f"  🗑️  Truncating {len(old_times)} old TIME value(s) × {len(elevations)} elevation(s)...")
            truncated = 0
            for t in old_times:
                for e in elevations:
                    if gwc_seed(layer, t, e, seed_type="truncate", dry_run=dry_run):
                        truncated += 1
            print(f"  ✅ Truncated {truncated} combination(s)")
        else:
            print(f"  ℹ️  No old tiles to truncate")

        if truncate_only:
            continue

        # 1b. Seed last N days
        try:
            recent_times = get_recent_time_values(layer, days=days)
        except Exception as e:
            print(f"  ⚠️  Could not query recent TIME values: {e}")
            recent_times = []

        if not recent_times:
            print(f"  ℹ️  No TIME values found in last {days} days — skipping seed")
            continue

        try:
            elevations = get_elevation_values(layer)
        except Exception as e:
            print(f"  ⚠️  Could not query ELEVATION values: {e}")
            elevations = ["0"]

        total = len(recent_times) * len(elevations)
        print(f"  🌱 Seeding {len(recent_times)} TIME value(s) × {len(elevations)} elevation(s) = {total} job(s)")
        print(f"     TIMEs      : {recent_times}")
        print(f"     ELEVATIONs : {elevations}")

        seeded = 0
        for t in recent_times:
            for elv in elevations:
                if gwc_seed(layer, t, elv, seed_type="seed", dry_run=dry_run):
                    seeded += 1
                    sys.stdout.write(f"\r     Progress: {seeded}/{total}")
                    sys.stdout.flush()
                time.sleep(0.1)

        print(f"\n  ✅ Submitted {seeded}/{total} seed job(s)")
        seeded_data[layer] = (recent_times, elevations)

    if truncate_only:
        print(f"\n{'='*60}")
        print("  Truncate-only mode — skipping GWC wait and nginx warm-up.")
        print(f"{'='*60}\n")
        return

    if not seeded_data:
        print(f"\n{'='*60}")
        print("  No layers were seeded — skipping warm-up and ready_dates update.")
        print(f"{'='*60}\n")
        return

    # ── Phase 2: Wait for GWC to finish, then warm nginx ──────────────────
    all_seeded_times: list[str] = []
    gwc_failed = False

    for layer, (recent_times, elevations) in seeded_data.items():
        print(f"\n🕐 Phase 2 — {layer}")

        gwc_ok = wait_for_gwc_seeding(layer)
        if not gwc_ok:
            gwc_failed = True
            print(f"  ⚠️  GWC timeout for {layer} — skipping nginx warm-up for this layer")
            continue

        run_nginx_warmup(layer, recent_times, elevations, dry_run=dry_run)
        all_seeded_times.extend(recent_times)

    # ── Phase 3: Write ready_dates.json ───────────────────────────────────
    print(f"\n📋 Phase 3 — ready_dates.json")
    if all_seeded_times:
        write_ready_dates(all_seeded_times, dry_run=dry_run)
    else:
        print("  ⚠️  No layers completed warm-up — ready_dates.json not updated")

    print(f"\n{'='*60}")
    if gwc_failed:
        print("  ⚠️  Finished with GWC timeout(s). Check GeoServer logs.")
    else:
        print("  ✅ GWC seeding + nginx warm-up complete.")
    print(f"{'='*60}\n")


# ─── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pre-seed GWC tiles for video WMS layers")
    parser.add_argument("--dry-run",       action="store_true", help="Print actions without sending requests")
    parser.add_argument("--truncate-only", action="store_true", help="Only truncate old tiles, skip seeding")
    parser.add_argument("--days",          type=int, default=7,  help="How many days back to seed (default: 7)")
    args = parser.parse_args()

    run_seed(dry_run=args.dry_run, truncate_only=args.truncate_only, days=args.days)
