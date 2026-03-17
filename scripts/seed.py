import requests
from requests.auth import HTTPBasicAuth
from datetime import datetime, timedelta
import time

# --- KONFIGURÁCIA ---
GEOSERVER_URL = "http://localhost:8080/geoserver/gwc/rest/seed/E_and_T:epis_wl75.xml"
USER = "admin"
PASSWORD = "geoserver"

# SKÚS NAJPRV LEN TÝŽDEŇ! (Napr. 1.1. až 7.1.)
start_date = datetime(2026, 1, 1)
end_date = datetime(2026, 1, 4) 

elevations = [f"{float(i)}" for i in range(16)]

def start_seed(time_val, elevation_val):
    xml_payload = f"""<?xml version="1.0" encoding="UTF-8"?>
    <seedRequest>
      <name>E_and_T:epis_wl75</name>
      <gridSetId>EPSG:900913</gridSetId>
      <zoomStart>0</zoomStart>
      <zoomStop>5</zoomStop>
      <format>image/png</format>
      <type>seed</type>
      <threadCount>1</threadCount> <parameters>
        <entry><string>TIME</string><string>{time_val}</string></entry>
        <entry><string>ELEVATION</string><string>{elevation_val}</string></entry>
      </parameters>
    </seedRequest>
    """
    
    try:
        response = requests.post(
            GEOSERVER_URL,
            data=xml_payload,
            headers={"Content-Type": "text/xml"},
            auth=HTTPBasicAuth(USER, PASSWORD),
            timeout=10
        )
        print(f"✅ Odoslané: {time_val} | Elev: {elevation_val}")
    except Exception as e:
        print(f"⚠️ Chyba: {e}")

# --- CYKLUS ---
current_date = start_date
while current_date <= end_date:
    time_str = current_date.strftime("%Y-%m-%dT12:00:00Z")
    print(f"\n--- Pridávam deň: {time_str} ---")
    
    for elev in elevations:
        start_seed(time_str, elev)
        time.sleep(3) # PAUZA 3 SEKUNDY MEDZI ÚLOHAMI
        
    current_date += timedelta(days=1)
    print("--- Krátka pauza medzi dňami (30s), nech si disk vydýchne ---")
    time.sleep(90)