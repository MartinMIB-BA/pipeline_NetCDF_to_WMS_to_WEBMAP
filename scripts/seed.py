import requests
from requests.auth import HTTPBasicAuth
from datetime import datetime, timedelta
import time

# --- CONFIGURATION ---
GEOSERVER_URL = "http://localhost:8080/geoserver/gwc/rest/seed/E_and_T:epis_wl75.xml"
USER = "admin"
PASSWORD = "geoserver"

# TRY JUST A WEEK FIRST! (E.g. Jan 1 to Jan 7)
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
        print(f"✅ Sent: {time_val} | Elev: {elevation_val}")
    except Exception as e:
        print(f"⚠️ Error: {e}")

# --- LOOP ---
current_date = start_date
while current_date <= end_date:
    time_str = current_date.strftime("%Y-%m-%dT12:00:00Z")
    print(f"\n--- Adding day: {time_str} ---")
    
    for elev in elevations:
        start_seed(time_str, elev)
        time.sleep(3) # PAUSE 3 SECONDS BETWEEN TASKS
        
    current_date += timedelta(days=1)
    print("--- Short pause between days (30s) to let the disk breathe ---")
    time.sleep(90)
