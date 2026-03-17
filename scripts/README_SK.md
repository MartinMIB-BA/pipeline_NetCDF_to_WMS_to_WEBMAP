# WMS Spracovanie NetCDF Dát - Dokumentácia

## Prehľad Systému

Tento systém automaticky sťahuje, spracováva a publikuje NetCDF dáta morských hladín cez GeoServer ako WMS (Web Map Service) služby. Systém podporuje:

- ✅ **Automatické zisťovanie súborov** - Prehľadáva všetky dostupné NetCDF súbory v 2026
- ✅ **PostgreSQL sledovanie** - Zabraňuje opätovnému spracovaniu už hotových súborov
- ✅ **Správa dátovej retenzie** - Automaticky maže staré GeoTIFF súbory (predvolene 90 dní)
- ✅ **TIME dimenzie** - Podporuje časové série s optimalizovanou GetCapabilities
- ✅ **Tri typy WMS vrstiev** - Statické, video a bodové údaje

---

## Štruktúra Projektu

```
scripts/
├── run_all_wms.py              # Hlavný orchestrátor (STREAM MODE)
├── lib/
│   ├── config.py               # Konfigurácia a environment premenné
│   ├── download.py             # Sťahovanie a auto-discovery
│   ├── geoserver.py            # GeoServer REST API
│   ├── postgis.py              # PostGIS schéma management
│   ├── tracking.py             # PostgreSQL sledovanie súborov
│   └── netcdf_utils.py         # NetCDF pomocné funkcie
├── workers/
│   ├── static_wms.py           # Spracovanie statických vrstiev
│   ├── video_wms.py            # Spracovanie video vrstiev
│   └── points_wms.py           # Spracovanie bodových údajov
└── monitor_storage.sh          # Monitorovanie diskovej kapacity
```

---

## Inštalácia

### 1. Systémové Požiadavky

- Python 3.12+
- PostgreSQL 12+ s PostGIS rozšírením
- GeoServer 2.27+
- ~20GB voľného miesta na disku (s 90-dňovou retenciou)

### 2. Inštalácia Závislostí

```bash
cd scripts
conda create -n wms python=3.12
conda activate wms
pip install -r requirements.txt
```

**Hlavné závislosti:**
- xarray >= 2023.1.0
- rioxarray >= 0.15.0
- netCDF4 >= 1.6.0
- numpy >= 1.24.0
- psycopg2-binary >= 2.9.0
- requests >= 2.31.0
- rasterio >= 1.3.0

### 3. Konfigurácia PostgreSQL

Vytvoriť databázu pre sledovanie:
```sql
CREATE DATABASE postgres;
CREATE USER geoserver WITH PASSWORD 'geoserver';
GRANT ALL PRIVILEGES ON DATABASE postgres TO geoserver;

\c postgres
CREATE EXTENSION postgis;
```

### 4. Konfigurácia GeoServer

- Nainštalovať GeoServer
- Vytvoriť workspace `E_and_T`
- Nakonfigurovať PostGIS datastore pre ImageMosaic

---

## Konfigurácia

### Environment Premenné

Vytvoriť `.env` súbor alebo nastaviť v systéme:

```bash
# GeoServer
GEOSERVER_URL=https://geoserver.fornidev.org/geoserver
WORKSPACE=E_and_T
GEOSERVER_USER=admin
GEOSERVER_PASSWORD=geoserver

# PostgreSQL
PG_HOST_LOCAL=127.0.0.1
PG_PORT=5432
PG_DB=postgres
PG_USER=geoserver
PG_PASS=geoserver
PG_HOST_GEOSERVER=postgis  # Hostname z pohľadu GeoServera

# Cesty
INPUT_DIR=  # Nepoužíva sa pri URL sťahovaní (odporúčané)
OUTPUT_ROOT=/home/martin/scripts/geoserver_ready
GEOSERVER_DATA_DIR=/opt/geoserver/data_dir

# URL sťahovanie (auto-discovery)
BASE_URL=https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/FLOODS/sea_level_forecasts/probabilistic_data_driven/medium_term_forecasts/
USE_URL_DOWNLOAD=true
AUTO_CLEANUP=true  # Vymaže geoserver_ready hneď po spracovaní každého súboru

# Email notifikácie
EMAIL_TO=martin.jancovic01@gmail.com
EMAIL_FROM=martin.jancovic01@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx  # Gmail App Password (https://myaccount.google.com/apppasswords)
```

### Hardcoded Nastavenia v `lib/config.py`

```python
YEARS_TO_PROCESS = [2026]  # Roky na spracovanie
HOURS = ["00", "12"]       # Hodinové behy (2x denne)
```

---

## Používanie

### Základné Spustenie

**S URL sťahovaním (odporúčané):**
```bash
conda activate wms
python run_all_wms.py --use-url
```

**S lokálnymi súbormi:**
```bash
python run_all_wms.py
```

### Možnosti Príkazového Riadku

```bash
python run_all_wms.py --help

Možnosti:
  --use-url              Sťahovať NetCDF súbory z URL
  --force-reprocess      Vynútiť opätovné spracovanie všetkých súborov
  --reset-file FILENAME  Resetovať stav konkrétneho súboru
  --stats                Zobraziť štatistiky spracovania
  --workers WORKERS      Špecifikovať workers (predvolene: all)
```

### Príklady

**Auto-discovery a spracovanie nových súborov:**
```bash
python run_all_wms.py --use-url
```

**Vynútiť opätovné spracovanie všetkých súborov:**
```bash
python run_all_wms.py --use-url --force-reprocess
```

**Zobraziť štatistiky:**
```bash
python run_all_wms.py --stats
```

**Resetovať konkrétny súbor:**
```bash
python run_all_wms.py --reset-file mediumTermTWLforecastGridded_202601010000-202601160000.nc
```

**Spracovať iba konkrétneho workera:**
```bash
python run_all_wms.py --use-url --workers static_wms
```

---

## Ako Systém Funguje

### 1. Auto-Discovery (Automatické Zisťovanie)

Systém automaticky prehľadáva FTP server:

```
1. Začne na: BASE_URL/2026/
2. Nájde mesačné priečinky: 01/, 02/, ..., 12/
3. V každom mesiaci nájde denné priečinky: 01/, 02/, ..., 31/
4. V každom dni kontroluje hodinové priečinky: 00/, 12/
5. Vylistuje všetky .nc súbory
6. Skontroluje PostgreSQL - preskočí už spracované
7. Stiahne a spracuje iba nové súbory
```

**Výhody:**
- Nie je potrebné hardcódovať dátumy
- Automaticky nájde všetky dostupné dáta
- 1 PostgreSQL dotaz namiesto 730+ (optimalizácia)
- Inteligentné preskakovanie už spracovaných súborov

### 2. Stream Processing

```
Súbor 1:
  → Sťahovanie do /tmp
  → Spracovanie cez 3 workers
  → Upload do GeoServer
  → Vyčistenie /tmp

Súbor 2:
  → Sťahovanie do /tmp
  → ...
```

**Výhody:**
- Nízka spotreba disku (iba 1 súbor naraz)
- FastFailure - chyby nezastavia celý proces
- Progresívne sledovanie (vidíte priebeh v reálnom čase)

### 3. Worker Typy

#### **static_wms.py** - Statické Pravdepodobnostné Vrstvy
Spracováva 12 premenných:
- `probabilityEpis10y_1_15`, `probabilityEpis10y_1_3`, `probabilityEpis10y_4_15`
- `probabilityEpis500y_1_15`, `probabilityEpis500y_1_3`, `probabilityEpis500y_4_15`
- `probabilityTWL10y_1_15`, `probabilityTWL10y_1_3`, `probabilityTWL10y_4_15`
- `probabilityTWL500y_1_15`, `probabilityTWL500y_1_3`, `probabilityTWL500y_4_15`

**Štyl:** `STATIC_WMS`

#### **video_wms.py** - Video Časové Série
Spracováva:
- `episWL75` (153 časových krokov)
- `TWL75` (153 časových krokov)

**Štyl:** `VIDEO_WMS`

#### **points_wms.py** - Bodové Pobrežné Údaje
Spracováva 6 premenných × 9 návratových období:
- `probabilityEpiscoast_01_15`, `probabilityEpiscoast_01_03`, `probabilityEpiscoast_04_15`
- `probabilityTWLcoast_01_15`, `probabilityTWLcoast_01_03`, `probabilityTWLcoast_04_15`

**Štyl:** `POINTS_WMS`  
**Dimenzie:** TIME + ELEVATION (rp0-rp8)

---

## PostgreSQL Sledovanie

### Tabuľka `wms_processing_log`

```sql
CREATE TABLE wms_processing_log (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    issue_timestamp VARCHAR(12) NOT NULL,
    status VARCHAR(50) NOT NULL,
    worker VARCHAR(100),
    download_url TEXT,
    error_message TEXT,
    processing_started TIMESTAMP,
    processing_completed TIMESTAMP
);
```

### Stavy Súborov

- `downloading` - Súbor sa práve sťahuje
- `processing` - Súbor sa spracováva
- `success` - Úspešne spracované ✅
- `failed` - Chyba pri spracovaní ❌

### Dotazy

**Zobraziť všetky spracované súbory:**
```sql
SELECT filename, issue_timestamp, status, processing_completed 
FROM wms_processing_log 
WHERE status = 'success' 
ORDER BY processing_completed DESC;
```

**Počet úspešných vs. neúspešných:**
```sql
SELECT status, COUNT(*) 
FROM wms_processing_log 
GROUP BY status;
```

**Neúspešné súbory:**
```sql
SELECT filename, error_message 
FROM wms_processing_log 
WHERE status = 'failed';
```

---

## Správa Dát

### Automatické Čistenie

Po spracovaní každého NetCDF súboru systém automaticky:
1. Nahrá GeoTIFFy do GeoServera (ktorý ich uloží do svojho `data_dir`)
2. **Hneď vymaže celý pracovný adresár** `geoserver_ready/`
3. Vytvorí nový prázdny `geoserver_ready/` pre ďalší súbor

**Dôležité:**
- ✅ **GeoServer WMS data** - zachovávajú sa navždy v `data_dir`
- ✅ **PostGIS index** - obsahuje všetky časové kroky
- 🗑️ **Pracovný adresár** (`geoserver_ready/`) - maže sa hneď po každom súbore
- 💾 **Úspora disku** - pracovný adresár nikdy nepresiahne veľkosť 1 súboru (~13GB)

**Prečo to takto funguje:**
1. GeoTIFFy sa vytvárajú v `geoserver_ready/` (dočasný pracovný adresár)
2. Zbalia sa do ZIP a nahrávajú do GeoServera
3. GeoServer ich rozbalí do svojho `data_dir` (trvalé úložisko)
4. Pracovný adresár sa **hneď** vymaže
5. WMS vrstvy v GeoServeri zostávajú dostupné navždy

**Konfigurácia:**
```bash
export AUTO_CLEANUP=true  # Automatické mazanie po každom súbore (predvolené)
```

---

## Monitorovanie

### 1. Monitorovanie Diskovej Kapacity

```bash
./monitor_storage.sh
```

**Výstup:**
```
================================================================
WMS DISK USAGE MONITORING - Thu Jan  9 14:00:00 CET 2026
================================================================

📊 Storage Usage by Store:
------------------------------------------------------------------
  ✅  2.3G  probabilityTWL10y_1_15
  ✅  2.1G  probabilityTWL500y_1_3
  ⚠️  52G   video_layer  (OVER 50GB THRESHOLD!)

📊 Total Storage Usage:
------------------------------------------------------------------
120G    /opt/geoserver/data_dir/data/E_and_T

📊 File Counts by Store:
------------------------------------------------------------------
  probabilityTWL10y_1_15: 180 GeoTIFF files
  probabilityTWL500y_1_3: 180 GeoTIFF files
```

**Cron job (denne o 8:00):**
```bash
0 8 * * * /path/to/scripts/monitor_storage.sh >> /var/log/wms_storage.log 2>&1
```

### 2. Automatické Email Notifikácie

Použite wrapper script `run_wms_with_email.sh`:

```bash
# Nastavte v .env súbore
EMAIL_TO=martin.jancovic01@gmail.com
EMAIL_FROM=martin.jancovic01@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx

# Spustite
./run_wms_with_email.sh /home/martin/logs/wms.log "manual-test"
```

**Test email konfigurácie:**
```bash
python test_email.py
```

---

## Riešenie Problémov

### Problém: HTTP 500 pri prvom spustení

**Riešenie:** Použite `--reset-each-store` pri prvom spustení:
```bash
python run_all_wms.py --use-url --reset-each-store
```

### Problém: "Permission denied" pri zapisovaní

**Riešenie:** Skontrolujte oprávnenia:
```bash
chmod -R 755 /home/martin/scripts/geoserver_ready
```

### Problém: PostgreSQL connection refused

**Riešenie:** Skontrolujte či PostgreSQL beží:
```bash
sudo systemctl status postgresql
sudo systemctl start postgresql
```

### Problém: GeoServer nereaguje

**Riešenie:** Reštartujte GeoServer:
```bash
sudo systemctl restart geoserver
```

### Problém: 404 chyby pri auto-discovery

**Riešenie:** Už opravené v najnovšej verzii! Systém teraz správne parsuje iba názvy priečinkov.

### Problém: Disk je plný

**Riešenie 1:** Povoliť automatické čistenie:
```bash
export AUTO_CLEANUP_OLD_DATA=true
export RETENTION_DAYS=60  # Kratšia retencia
```

**Riešenie 2:** Manuálne vyčistenie:
```bash
python run_all_wms.py --reset-each-store  # Vymaže všetko a začne odznova
```

---

## Produkčné Nasadenie

### 1. Nastavenie Automatizovaného Behu

Upravte crontab:
```bash
crontab -e
```

Pridajte:
```cron
# WMS Processing with Email Notifications (3x daily)
0 8  * * * cd /home/martin/scripts && bash run_wms_with_email.sh /home/martin/logs/wms_8am.log "8am"
0 14 * * * cd /home/martin/scripts && bash run_wms_with_email.sh /home/martin/logs/wms_2pm.log "2pm"
0 18 * * * cd /home/martin/scripts && bash run_wms_with_email.sh /home/martin/logs/wms_6pm.log "6pm"

# Storage Monitoring (daily at 9am)
0 9 * * * /home/martin/scripts/monitor_storage.sh >> /home/martin/logs/storage_monitor.log 2>&1
```

### 2. Email Notifikácie

Nastavte Gmail App Password v `.env` súbore:

```bash
EMAIL_TO=martin.jancovic01@gmail.com
EMAIL_FROM=martin.jancovic01@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
```

**Vytvorenie Gmail App Password:**
1. Prejdite na https://myaccount.google.com/apppasswords
2. Vytvorte nové App Password pre "Mail"
3. Skopírujte heslo do `.env` súboru

**Test konfigurácie:**
```bash
python test_email.py
```

### 3. Log Rotácia

Wrapper script automaticky:
- Uchováva posledné 3 úspešné logy
- Uchováva posledných 7 dní chybových logov

---

## GeoServer WMS Použitie

### GetCapabilities

```
https://geoserver.fornidev.org/geoserver/E_and_T/wms?
  service=WMS&
  version=1.3.0&
  request=GetCapabilities
```

### GetMap Príklad

```
https://geoserver.fornidev.org/geoserver/E_and_T/wms?
  service=WMS&
  version=1.3.0&
  request=GetMap&
  layers=E_and_T:probabilityTWL10y_1_15&
  styles=STATIC_WMS&
  bbox=-180,-90,180,90&
  width=800&
  height=400&
  srs=EPSG:4326&
  format=image/png&
  time=2026-01-01T00:00:00Z
```

### TIME Dimenzie

**Formát:**
```
time=2026-01-01T00:00:00Z                    # Konkrétny čas
time=2026-01-01T00:00:00Z/2026-01-15T00:00:00Z  # Časový rozsah
```

### ELEVATION Dimenzie (iba pre points_wms)

```
elevation=0       # rp0
elevation=1       # rp1
...
elevation=8       # rp8
```

---

## Výkon a Škálovateľnosť

### Denný Beh (2 nové súbory)

- **Discovery:** ~10-20 sekúnd
- **PostgreSQL check:** ~100ms (1 dotaz)
- **Sťahovanie:** ~20 minút (2×13GB)
- **Spracovanie:** ~10-20 minút (3 workers)
- **Celkový čas:** ~30-40 minút ✅

### Ročný Objem

| Metrika | Hodnota |
|---------|---------|
| NetCDF súbory | 730 (2×denne) |
| GeoTIFF súbory | ~108,000 (s retenciou: ~16,200) |
| Diskový priestor | 65-330 GB (s 90-dňovou retenciou) |
| PostgreSQL riadky | ~4,380 (6 workers × 730 súborov) |
| GetCapabilities | ~50 KB (DISCRETE_INTERVAL) |

---

## Bezpečnosť

**Environment premenné:**
- Nikdy necommitujte `.env` do git
- Používajte silné heslá pre PostgreSQL a GeoServer
- Obmedzte prístup k SSH kúčom

**Firewall:**
```bash
# Povoliť iba potrebné porty
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 5432/tcp  # PostgreSQL (iba internal)
sudo ufw allow 8080/tcp  # GeoServer (iba internal/reverse proxy)
```

---

## Podpora a Kontakt

Pre otázky a problémy:
- Skontrolujte logy v `scripts/logs/`
- Pozrite PostgreSQL `wms_processing_log` tabuľku
- Spustite `--stats` pre diagnostiku

---

## Zhrnutie Funkcií

✅ **Auto-discovery** - Automaticky nájde všetky .nc súbory v 2026  
✅ **PostgreSQL tracking** - Inteligentné preskakovanie spracovaných súborov  
✅ **Dátová retencia** - Automatické mazanie starých súborov  
✅ **TIME optimizácia** - DISCRETE_INTERVAL pre rýchlejšie GetCapabilities  
✅ **Stream processing** - Nízka spotreba disku  
✅ **Monitorovanie** - Disk usage a error alerts  
✅ **3 typy WMS** - Static, Video, Points s vlastnými štýlmi  
✅ **Produkčne pripravené** - Spustiteľné 2× denne po celý rok  

**Systém je hotový na produkciu!** 🚀
