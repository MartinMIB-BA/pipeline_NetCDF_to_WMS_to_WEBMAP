# WMS Leaflet Viewer - Production Version

Interaktívna WMS mapa s Leaflet + GeoServer (PostGIS ImageMosaic).

## 📦 Súbory

### Production
- **index.html** - Hlavná stránka
- **app.js** - Optimalizovaný JavaScript (zoom-fix + GridLayer patches)
- **proxy_async.py** - Async CORS proxy (používaj tento!)

### Dokumentácia
- **README.md** - Tento súbor
- **ASYNC_PROXY_GUIDE.md** - Guide pre async proxy

## 🚀 Spustenie

### 1. Spusti Proxy

```bash
python3 proxy_async.py
```

Mali by si vidieť:
```
🚀 Async CORS Proxy for GeoServer
Target:  https://geoserver.fornidev.org/geoserver
Proxy:   http://localhost:8080
```

### 2. Otvor Mapu

**Option A: Direct** (odporúčané)
```bash
open index.html
```

**Option B: Local Server**
```bash
python3 -m http.server 8000
# Potom otvor: http://localhost:8000
```

## ✅ Opravy v Tejto Verzii

### Zoom Crash Fix (GridLayer Patches)
```javascript
// Zabráni: "Cannot read properties of null (reading 'project')"
L.GridLayer.prototype._updateLevels = function () {
    if (!this._map || this.isDestroying) {
        return; // Safe exit
    }
    // ... pokračuje normálne
};
```

**Patch-ované metódy:**
- ✅ `_updateLevels` - hlavná ochrana
- ✅ `_resetGrid` - zabráni crash pri reset
- ✅ `_setView` - zabráni crash počas animácie
- ✅ `_removeTile` - bezpečné odstránenie tiles
- ✅ `_abortLoading` - bezpečné rušenie requestov

### Zoom Rendering Fix
```javascript
// Forced redraw po zoome
map.on('zoomend', function () {
    setTimeout(() => {
        wmsLayer.redraw(); // Vynúti načítanie tiles
    }, 100);
});
```

### Optimálna Konfigurácia
```javascript
updateWhenIdle: true,      // Počká na koniec zoomu
updateWhenZooming: false,  // NIKDY počas zoomu
updateInterval: 200,       // Rýchle updates
keepBuffer: 0,             // Len viditeľné tiles
```

## 🎯 Vlastnosti

- 🗺️ **Layer Selection** - Všetky static, coastal & video layers
- ⏰ **Time Control** - Výber forecast timestampu
- 📊 **Elevation/RP** - Return period slider (0-8)
- 🎨 **Opacity** - Nastavenie priehľadnosti
- 📍 **Interactive Map** - Pan & zoom
- 🔒 **Crash Protection** - Defensive GridLayer patches
- ⚡ **Zoom Safe** - Forced redraw po zoome

## 🐛 Riešenie Problémov

### WMS layer sa nezobrazuje po zoome?
1. Obnov stránku (Ctrl+R)
2. Skontroluj konzolu - mali by si vidieť:
   - `🔄 [ZOOM FIX] Forcing WMS layer redraw`
   - ⚠️ Warning-y sú OK (znamená že patch funguje!)
3. Červené crash-e by NEMALI byť

### Proxy nefunguje?
```bash
# Uisti sa že beží async verzia
ps aux | grep proxy_async

# Ak nie, spusti ju:
python3 proxy_async.py
```

### Konzola ukazuje warning-y?
To je NORMÁLNE! Tieto warning-y znamenajú že defensive patches fungujú:
- ✅ `⚠️ GridLayer._updateLevels blocked` - OK
- ✅ `⚠️ GridLayer._resetGrid blocked` - OK
- ✅ `⚠️ GridLayer._setView blocked` - OK

**Crash-e ktoré by NEMALI byť:**
- ❌ `Uncaught TypeError: Cannot read properties of null`

## 📊 Layer Typy

### Static Probability (TIME only)
- probabilityEpis10y_*, probabilityTWL10y_*, etc.

### Coastal Points (TIME + ELEVATION)
- probabilityEpiscoast_*, probabilityTWLcoast_*
- RP values: 0-8

### Video Layers (TIME + ELEVATION)
- episWL75, TWL75
- Lead time: 0-99

## 🔧 Konfigurácia

### Zmeniť GeoServer URL
Edituj `proxy_async.py`:
```python
GEOSERVER_URL = "https://your-server.com/geoserver"
```

### Zmeniť proxy port
Edituj `proxy_async.py`:
```python
PORT = 8080  # Zmeň na iný port ak 8080 je obsadený
```

Potom aktualizuj `app.js`:
```javascript
const GEOSERVER_URL = 'http://localhost:8080'; // Použiť nový port
```

## 📝 Version History

### v2.0 - Zoom Fix (2026-01-20)
- ✅ Defensive GridLayer patches (5 metód)
- ✅ Forced redraw po zoome
- ✅ updateWhenIdle: true
- ✅ Vyčistené testovacie súbory

### v1.0 - Initial Release
- Basic WMS viewer
- CORS proxy
- Time/elevation controls

---

**GeoServer:** https://geoserver.fornidev.org/geoserver  
**Workspace:** E_and_T
