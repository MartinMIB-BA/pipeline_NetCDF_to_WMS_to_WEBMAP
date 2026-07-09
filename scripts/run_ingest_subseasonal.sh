#!/bin/bash
#
# Weekly Country Hazard CSV Ingest + Email Notification
# 1. Runs ingest_subseasonal.py (auto-discovers + imports the latest CSV from JRC FTP)
# 2. Sends an email on completion or failure
#
# Feeds the country_forecast_weekly table behind the "Country Hazard"
# choropleth layers (country_epis_summary / country_twl_summary).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LOG_FILE="${1:-/opt/geoserver/logs/ingest_subseasonal.log}"

# ── Activate conda ──────────────────────────────────────────────────────────
source /home/ubuntu/miniforge3/etc/profile.d/conda.sh || true
conda activate wms

# ── Load .env ───────────────────────────────────────────────────────────────
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

EMAIL_TO="${EMAIL_TO:-martin.jancovic01@gmail.com}"
EMAIL_FROM="${EMAIL_FROM:-martin.jancovic01@gmail.com}"

if [ -z "$GMAIL_APP_PASSWORD" ]; then
    echo "❌ Error: GMAIL_APP_PASSWORD not set in .env file"
    exit 1
fi

export PYTHONUNBUFFERED=1

# ── Truncate log file for this run ──────────────────────────────────────────
: > "$LOG_FILE"

# ── Run the ingest ───────────────────────────────────────────────────────────
{
echo "========================================"
echo "  Country Hazard CSV Ingest Started: $(date)"
echo "========================================"
} | tee -a "$LOG_FILE"

python "$SCRIPT_DIR/ingest_subseasonal.py" 2>&1 | tee -a "$LOG_FILE"
INGEST_EXIT=${PIPESTATUS[0]}

{
echo ""
echo "  Ingest finished at $(date)  [status: $([ "$INGEST_EXIT" -eq 0 ] && echo OK || echo FAILED)]"
echo "========================================"
} | tee -a "$LOG_FILE"

# ── Send email ───────────────────────────────────────────────────────────────
if [ "$INGEST_EXIT" -eq 0 ]; then
    STATUS="success"
    SUBJECT="Country Hazard Ingest — OK ✅"
    BODY="Weekly subseasonal CSV ingest completed successfully at $(date).

Server: $(hostname)
Log: $LOG_FILE"
else
    STATUS="failed"
    SUBJECT="Country Hazard Ingest — FAILED ❌"
    BODY="Weekly subseasonal CSV ingest FAILED at $(date).

Server: $(hostname)
Log: $LOG_FILE

Action required: Review the attached log. Common causes — JRC FTP directory
structure changed, no new CSV published yet this week, or a DB connection issue."
fi

python "$SCRIPT_DIR/send_email_notification.py" \
    "$SUBJECT" \
    "$BODY" \
    "$LOG_FILE" \
    "$STATUS"

exit "$INGEST_EXIT"
