# Cron Job Installation for WMS Processing

## What has been created

1. ✅ [`wms_crontab.txt`](file:///Users/martinjancovic/Desktop/WMS_WMS_T/scripts/wms_crontab.txt) - Configuration for automatic execution

## Execution Schedule

| Time | Script | Log file | Email label |
|-----|--------|-----------|-------------|
| **08:00** | `run_wms_with_email.sh` | `/opt/geoserver/logs/wms_8am.log` | "8am" |
| **13:00** | `run_wms_with_email.sh` | `/opt/geoserver/logs/wms_2pm.log` | "2pm" |
| **20:00** | `run_wms_with_email.sh` | `/opt/geoserver/logs/wms_8pm.log` | "8pm" |
| **09:00** | `monitor_storage.sh` | `/opt/geoserver/logs/storage_monitor.log` | - |

## How to install on the server

**On the server run:**

```bash
# 1. Navigate to directory
cd /opt/geoserver/scripts

# 2. Create logs directory (if it does not exist)
mkdir -p /opt/geoserver/logs

# 3. Install crontab
crontab wms_crontab.txt

# 4. Verify installation
crontab -l
```

## Verification

After installation you can:

```bash
# View currently set cron jobs
crontab -l

# Monitor cron logs
tail -f /opt/geoserver/logs/cron.log

# Run manually (without waiting for cron)
bash run_wms_with_email.sh /opt/geoserver/logs/test.log "manual-test"
```

## What it will do

- **WMS Processing** will run 3× a day automatically
- After each run you will receive an **email** with the result (success/error)
- Logs are saved to `/opt/geoserver/logs/`
- Each run has its **own log file** based on the time

## Important

> [!IMPORTANT]
> Ensure you have **GMAIL_APP_PASSWORD** set in `/opt/geoserver/scripts/.env` on the server!

```bash
# Check .env on the server
cat /opt/geoserver/scripts/.env | grep GMAIL_APP_PASSWORD
```
