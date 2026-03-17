# Async Proxy Usage Guide

## Quick Start

**1. Stop old proxy** (if running):
```bash
# In terminal where proxy.py is running:
Ctrl+C
```

**2. Start async proxy**:
```bash
python3 proxy_async.py
```

**3. Verify** - You should see:
```
🚀 High-Performance Async CORS Proxy for GeoServer
Target:  https://geoserver.fornidev.org/geoserver
Proxy:   http://localhost:8080
Mode:    Async (aiohttp) with connection pooling
Rate:    Max 4 concurrent requests
```

**4. Test** - Open map in browser (http://localhost:8000)

## Features

✅ **True Parallelism** - No Python GIL limitation  
✅ **Connection Pooling** - Reuses 10 TCP connections  
✅ **Rate Limiting** - Max 4 concurrent to protect GeoServer  
✅ **30-Day Caching** - Repeat loads instant  

## Expected Performance

- Initial load: 3-5 seconds (vs 10-30s before)
- Zoom/pan: 1-2 seconds
- Re-visiting: < 1 second (cached)

## Monitoring

View stats: http://localhost:8080/stats
