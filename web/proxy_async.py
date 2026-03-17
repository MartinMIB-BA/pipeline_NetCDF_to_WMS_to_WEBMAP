#!/usr/bin/env python3
"""
Async CORS proxy for WMS (GeoServer + Copernicus) with:
- global concurrency limit (protects GeoServer/PostGIS)
- sane connection pooling (matches concurrency)
- better stats (queued vs inflight)
- ServiceExceptionReport detection (only flags errors for GetMap)
"""

import asyncio
import time
from datetime import datetime
from urllib.parse import urlencode

import aiohttp
from aiohttp import web


# --- WMS upstreams ---
WMS_SERVERS = {
    "geoserver": "http://89.47.190.36:8080/geoserver/E_and_T",  # EU node GeoServer
    "gwc":       "http://89.47.190.36:8080/geoserver",           # GeoWebCache (tile cache)
    "copernicus": "https://geoserver.gfm.eodc.eu/geoserver/gfm/wms", # EODC GFM Geoserver
}
DEFAULT_SERVER = "geoserver"

# --- Proxy runtime ---
HOST = "localhost"
PORT = 8080

# Global throttle - MATCHED to GeoServer datastore max connections
# Global throttle - MATCHED to GeoServer datastore max connections
MAX_CONCURRENT_REQUESTS = 10  # Reduced to prevent DB pool exhaustion (was 40)

# Connection pooling: keep it close to concurrency
POOL_LIMIT_PER_HOST = MAX_CONCURRENT_REQUESTS          # per upstream host
POOL_LIMIT_TOTAL = MAX_CONCURRENT_REQUESTS * 2         # across all hosts (small safety margin)

# Timeouts (tune if needed)
TIMEOUT_TOTAL = 180
TIMEOUT_CONNECT = 10
TIMEOUT_SOCK_READ = 120

# Caching (for testing keep it off to avoid "why did it not change?")
CACHE_MAX_AGE_SECONDS = 3600  # 1 hour browser caching


def _cache_headers() -> dict:
    if CACHE_MAX_AGE_SECONDS <= 0:
        return {"Cache-Control": "no-store"}
    return {
        "Cache-Control": f"public, max-age={CACHE_MAX_AGE_SECONDS}",
        "Expires": "Thu, 31 Dec 2026 23:59:59 GMT",
    }


class Stats:
    def __init__(self) -> None:
        self.total_requests = 0
        self.queued = 0
        self.inflight = 0
        self.errors = 0
        self.total_bytes = 0
        self.total_time = 0.0

    def snapshot(self) -> dict:
        avg_time = self.total_time / self.total_requests if self.total_requests else 0.0
        avg_size = self.total_bytes / self.total_requests if self.total_requests else 0.0
        return {
            "total_requests": self.total_requests,
            "queued": self.queued,
            "inflight": self.inflight,
            "errors": self.errors,
            "total_mb": self.total_bytes / 1024 / 1024,
            "avg_time_s": avg_time,
            "avg_kb": avg_size / 1024,
        }


stats = Stats()


# GWC video layers: route these to GWC service endpoint with snapped BBOX
GWC_VIDEO_LAYERS = {'twl75', 'epis_wl75'}


def build_target_url(request: web.Request) -> tuple[str, str, str]:
    """Return (target_url, server_name, layer_name)."""
    target_server = request.query.get("target", DEFAULT_SERVER)

    if request.path.startswith("/gwc/"):
        target_server = "gwc"

    # ─── Smart GWC routing ────────────────────────────────────────────────────
    # ALL tiled requests for known GWC video layers → /gwc/service/wms
    # GWC now has RegexParameterFilter for TIME and ELEVATION (accepts any value).
    # Pre-seeded tiles return CACHE HIT; unseeded frames get rendered and then cached.
    is_tiled    = request.query.get("tiled", "").lower() == "true"
    layer_param = request.query.get("layers", "")
    layer_short = layer_param.split(":")[-1]  # strip workspace prefix

    if is_tiled and layer_short in GWC_VIDEO_LAYERS and target_server != "gwc":
        target_server = "gwc"
    # ─────────────────────────────────────────────────────────────────────────

    base_url = WMS_SERVERS.get(target_server, WMS_SERVERS[DEFAULT_SERVER])

    # Copy params, remove our routing param
    query_params = dict(request.query)
    query_params.pop("target", None)

    # Snap BBOX for GWC requests to avoid 400 Bad Request (float precision)
    if target_server == "gwc" and "bbox" in query_params:
        width = int(query_params.get("width", 256))
        orig_bbox = query_params["bbox"]
        query_params["bbox"] = _snap_bbox_to_gwc_grid(query_params["bbox"], width)
        if layer_short in GWC_VIDEO_LAYERS:
            with open("proxy_debug.log", "a") as f:
                f.write(f"GWC BBOX: orig={orig_bbox} snapped={query_params['bbox']}\n")

    # ─── Rewrite params for GWC compatibility ────────────────────────────────
    # GWC for these layers requires: VERSION=1.1.1, SRS=EPSG:900913, FORMAT=image/png
    # TIME and ELEVATION are KEPT (GWC RegexParameterFilter now accepts any value)
    if target_server == "gwc" and layer_short in GWC_VIDEO_LAYERS:
        # Switch to WMS 1.1.1 so GWC uses SRS instead of CRS
        query_params.pop("VERSION", None)
        query_params["version"] = "1.1.1"
        # Replace CRS → SRS (WMS 1.1.1 syntax) using EPSG:900913 gridset
        query_params.pop("crs", None)
        query_params.pop("CRS", None)
        query_params["srs"] = "EPSG:900913"
        # GWC only accepts formats it was seeded with; png8 is not one of them
        fmt = query_params.get("format", query_params.get("FORMAT", "image/png"))
        query_params.pop("FORMAT", None)
        if "png8" in fmt or "jpeg" in fmt.lower():
            query_params["format"] = "image/png"
        # NOTE: TIME and ELEVATION are intentionally kept – GWC uses them for
        # per-dimension cache lookup (RegexParameterFilter accepts .* values)
    # ─────────────────────────────────────────────────────────────────────────




    query_string = urlencode(query_params, doseq=True, safe=":/,")

    if target_server == "gwc":
        is_wmts = "wmts" in request.path
        if is_wmts:
            target_url = f"{base_url}/gwc/service/wmts?{query_string}"
        else:
            target_url = f"{base_url}/gwc/service/wms?{query_string}"
    elif target_server == "geoserver":
        target_url = f"{base_url}/wms?{query_string}"
    else:
        target_url = f"{base_url}?{query_string}"

    layer = request.query.get("layers", "unknown")
    return target_url, target_server.upper(), layer


# GWC EPSG:900913 (=EPSG:3857) GridSet parameters
_EARTH_HALF = 20037508.342789244  # half circumference in meters


def _snap_bbox_to_gwc_grid(bbox_str: str, width: int) -> str:
    """
    Snap a Leaflet-generated BBOX to the exact GWC tile grid.
    GWC rejects requests with floating point imprecision outside its grid cells.

    For a 256px tile in EPSG:3857:
      tile_size = 2 * EARTH_HALF / 2^zoom
      zoom can be inferred from (maxx - minx) / tile_size
    """
    import math
    try:
        minx, miny, maxx, maxy = map(float, bbox_str.split(","))
        tile_w = maxx - minx  # meters across tile

        # Compute zoom level from tile width  (2 * EARTH_HALF / 2^z = tile_w)
        full = 2 * _EARTH_HALF
        z = round(math.log2(full / tile_w))
        tile_size = full / (2 ** z)

        # Snap to grid by integer tile indices
        col = round((minx + _EARTH_HALF) / tile_size)
        row = round((_EARTH_HALF - maxy) / tile_size)

        snap_minx = -_EARTH_HALF + col * tile_size
        snap_maxx = snap_minx + tile_size
        snap_maxy = _EARTH_HALF - row * tile_size
        snap_miny = snap_maxy - tile_size

        return f"{snap_minx},{snap_miny},{snap_maxx},{snap_maxy}"
    except Exception:
        return bbox_str  # fallback to original if anything goes wrong



def is_wms_service_exception(content_type: str, content: bytes, request: web.Request) -> bool:
    """
    GeoServer often returns HTTP 200 with XML ServiceExceptionReport for GetMap.
    Only treat XML as error if it contains ServiceExceptionReport and request is GetMap.
    """
    req_type = request.query.get("request", "").lower()
    if req_type != "getmap":
        return False

    if "xml" not in (content_type or "").lower():
        return False

    # cheap signature check
    txt = content.decode("utf-8", errors="ignore")
    return "ServiceExceptionReport" in txt or "<ServiceException" in txt


async def init_app(app: web.Application) -> None:
    connector = aiohttp.TCPConnector(
        limit=POOL_LIMIT_TOTAL,
        limit_per_host=POOL_LIMIT_PER_HOST,
        ttl_dns_cache=300,
        keepalive_timeout=30,
    )
    timeout = aiohttp.ClientTimeout(
        total=TIMEOUT_TOTAL,
        connect=TIMEOUT_CONNECT,
        sock_read=TIMEOUT_SOCK_READ,
    )
    session = aiohttp.ClientSession(
        connector=connector,
        timeout=timeout,
        headers={"User-Agent": "WMS-Viewer-Proxy/2.1"},
    )

    app["connector"] = connector
    app["session"] = session
    app["sem"] = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    print("=" * 70)
    print("🚀 Multi-Server Async CORS Proxy for WMS")
    print("=" * 70)
    print(f"GeoServer:   {WMS_SERVERS['geoserver']}")
    print(f"Copernicus:  {WMS_SERVERS['copernicus']}")
    print(f"Proxy:       http://{HOST}:{PORT}")
    print("Mode:        Async (aiohttp) with connection pooling")
    print(f"Rate:        Max {MAX_CONCURRENT_REQUESTS} concurrent requests (GLOBAL)")
    print(f"Pool:        total={POOL_LIMIT_TOTAL}, per_host={POOL_LIMIT_PER_HOST}")
    print(f"Cache:       {'off (no-store)' if CACHE_MAX_AGE_SECONDS <= 0 else f'{CACHE_MAX_AGE_SECONDS}s'}")
    print("=" * 70)
    print("Tip: add ?target=copernicus to route to Copernicus.\n")


async def cleanup(app: web.Application) -> None:
    print("\n👋 Shutting down proxy...")
    session: aiohttp.ClientSession = app.get("session")
    connector: aiohttp.TCPConnector = app.get("connector")
    if session:
        await session.close()
    if connector:
        await connector.close()


async def handle_options(_: web.Request) -> web.Response:
    return web.Response(
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
    )


async def handle_stats(_: web.Request) -> web.Response:
    s = stats.snapshot()
    txt = (
        "Proxy Statistics\n"
        "================\n"
        f"Total Requests:    {s['total_requests']}\n"
        f"Queued:            {s['queued']}\n"
        f"In-flight:         {s['inflight']}\n"
        f"Errors:            {s['errors']}\n"
        f"Total Data:        {s['total_mb']:.2f} MB\n"
        f"Avg Request Time:  {s['avg_time_s']:.2f} s\n"
        f"Avg Response Size: {s['avg_kb']:.1f} KB\n"
    )
    return web.Response(text=txt, content_type="text/plain")


async def handle_wms_request(request: web.Request) -> web.Response:
    acquired = False
    stats.total_requests += 1
    request_id = stats.total_requests
    start_time = time.time()
    target_url, server_name, layer_name = build_target_url(request)

    # DEBUG: Log the time and elevation parameters
    time_param = request.query.get("time", "")
    elev_param = request.query.get("elevation", "")
    layer_param = request.query.get("layers", "")
    if "epis_wl75" in layer_param or "twl75" in layer_param:
        with open("proxy_debug.log", "a") as f:
            f.write(f"REQUEST {layer_param} | time={time_param} | elevation={elev_param} | url={request.url}\n")
    # END DEBUG

    stats.queued += 1
    sem: asyncio.Semaphore = request.app["sem"]

    try:
        async with sem:
            acquired = True
            stats.queued -= 1
            stats.inflight += 1

            print(
                f"[{datetime.now().strftime('%H:%M:%S')}] "
                f"#{request_id} [{server_name}] {layer_name[:40]}... "
                f"(inflight: {stats.inflight}, queued: {stats.queued})"
            )

            session: aiohttp.ClientSession = request.app["session"]
            
            # ATTEMPT 1: Target URL
            async with session.get(target_url) as resp:
                content = await resp.read()
                content_type = resp.headers.get("Content-Type", "application/octet-stream")
                status = resp.status
                xml_exc = is_wms_service_exception(content_type, content, request)
                # Log GeoWebCache cache hit/miss if header present
                gwc_result = resp.headers.get("geowebcache-cache-result", "")
                if gwc_result.upper() == "HIT":
                    print(f"       🟢 [CACHE HIT] served from GWC cache")

            # FALLBACK LOGIC: If GWC fails (404/400/XML), try standard WMS
            if (status != 200 or xml_exc) and server_name == "GWC":
                err_body = content.decode("utf-8", errors="ignore")
                
                # Extract proper error message from HTML if present
                import re
                match = re.search(r'<body>(.*?)</body>', err_body, re.IGNORECASE | re.DOTALL)
                if match:
                    clean_err = re.sub(r'<[^>]+>', '', match.group(1)).strip()
                    clean_err = re.sub(r'\s+', ' ', clean_err)
                else:
                    clean_err = err_body[:200].replace('\n', ' ').strip()
                
                print(f"  ⚠️  #{request_id} GWC failed (HTTP {status}): {clean_err}")
                print(f"       → trying fallback WMS...")
                
                # Construct fallback URL: 
                # 1. Replace endpoint
                fallback_url = target_url.replace("/gwc/service/wms", "/wms")
                # 2. Remove 'tiled=true' to avoid confusing standard WMS if GWC failed
                fallback_url = fallback_url.replace("&tiled=true", "").replace("?tiled=true", "?")
                
                async with session.get(fallback_url) as resp_fb:
                    content_fb = await resp_fb.read()
                    type_fb = resp_fb.headers.get("Content-Type", "application/octet-stream")
                    status_fb = resp_fb.status
                    xml_exc_fb = is_wms_service_exception(type_fb, content_fb, request)
                    
                    # If fallback is better or at least valid, use it
                    if status_fb == 200 and not xml_exc_fb:
                        print(f"  ✓ #{request_id} Fallback WMS succeeded!")
                        content = content_fb
                        content_type = type_fb
                        status = status_fb
                        xml_exc = False
                        target_url = fallback_url # for final logging
                    else:
                         print(f"  ❌ #{request_id} Fallback also failed (HTTP {status_fb}).")
            
            # Final stats & logging
            elapsed = time.time() - start_time
            stats.total_time += elapsed
            stats.total_bytes += len(content)

            # Extract GWC cache header
            gwc_result = resp.headers.get("geowebcache-cache-result") if 'resp' in locals() and resp else None
            if not gwc_result and 'resp_fb' in locals() and resp_fb:
                gwc_result = resp_fb.headers.get("geowebcache-cache-result")

            if status != 200 or xml_exc:
                stats.errors += 1
                err_type = "XML ServiceExceptionReport" if xml_exc else f"HTTP {status}"
                print(f"  ⚠️ #{request_id} FAILED: {err_type}")
                print(f"     URL: {target_url}")
                if xml_exc:
                    # Try to decode for preview
                    try:
                        preview = content.decode("utf-8", errors="ignore")[:500].replace("\n", " ")
                        print(f"     Response: {preview}")
                    except Exception:
                        pass
            else:
                # Color coded HIT/MISS printout
                if gwc_result:
                    elev = request.query.get("elevation", request.query.get("ELEVATION", "?"))
                    time_p = request.query.get("time", request.query.get("TIME", "?"))
                    
                    if "HIT" in gwc_result:
                        print(f"  🟢 [GWC {gwc_result}] #{request_id} in {elapsed:.2f}s | Elev: {elev} | Time: {time_p[:13]}")
                    elif "MISS" in gwc_result:
                        print(f"  🔴 [GWC {gwc_result}] #{request_id} in {elapsed:.2f}s | Elev: {elev} | Time: {time_p[:13]}")
                    else:
                        print(f"  🟡 [GWC {gwc_result}] #{request_id} in {elapsed:.2f}s | Elev: {elev} | Time: {time_p[:13]}")
                else:
                    print(f"  ✓ #{request_id} OK in {elapsed:.2f}s ({len(content):,} bytes)")

            headers = {
                "Content-Type": content_type,
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                **_cache_headers(),
            }
                
            if gwc_result:
                headers["geowebcache-cache-result"] = gwc_result

            final_status = 502 if xml_exc else status
            return web.Response(body=content, status=final_status, headers=headers)

    except asyncio.TimeoutError:
        stats.errors += 1
        elapsed = time.time() - start_time
        print(f"  ✗ #{request_id} TIMEOUT after {elapsed:.1f}s")
        return web.Response(
            text="Gateway timeout - upstream WMS took too long",
            status=504,
            headers={"Access-Control-Allow-Origin": "*", **_cache_headers()},
        )

    except Exception as e:
        stats.errors += 1
        elapsed = time.time() - start_time
        print(f"  ✗ #{request_id} ERROR after {elapsed:.1f}s: {str(e)[:200]}")
        return web.Response(
            text=f"Proxy error: {e}",
            status=502,
            headers={"Access-Control-Allow-Origin": "*", **_cache_headers()},
        )

    finally:
        # if we never acquired semaphore, we are still queued
        if not acquired:
            stats.queued = max(0, stats.queued - 1)
        else:
            stats.inflight = max(0, stats.inflight - 1)


def main() -> None:
    app = web.Application()

    # Routes
    app.router.add_get("/wms", handle_wms_request)
    app.router.add_options("/wms", handle_options)
    app.router.add_get("/gwc/service/wms", handle_wms_request)   # GWC direct path
    app.router.add_options("/gwc/service/wms", handle_options)   # GWC CORS preflight
    app.router.add_get("/gwc/service/wmts", handle_wms_request)  # WMTS direct path
    app.router.add_options("/gwc/service/wmts", handle_options)  # WMTS CORS preflight
    app.router.add_get("/stats", handle_stats)
    app.router.add_get("/", lambda _: web.Response(text="OK\n", content_type="text/plain"))

    # Lifecycle
    app.on_startup.append(init_app)
    app.on_cleanup.append(cleanup)

    web.run_app(app, host=HOST, port=PORT, print=lambda _: None)


if __name__ == "__main__":
    main()
