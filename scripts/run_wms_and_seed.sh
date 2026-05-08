#!/bin/bash
#
# WMS Processing + GWC Tile Seeding with single Email Notification
# 1. Runs run_all_wms.py  (data processing)
# 2. Runs seed_tiles.py   (pre-seed GeoWebCache)
# 3. Sends ONE combined email on completion or failure
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

LOG_FILE="${1:-/opt/geoserver/logs/wms_seed.log}"
RUN_TIME="${2:-$(date +%H:%M)}"

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
export TQDM_MININTERVAL=5

# ── Truncate log file for this run ──────────────────────────────────────────
: > "$LOG_FILE"

# ── Step 1: WMS processing ──────────────────────────────────────────────────
{
echo "========================================"
echo "  WMS Processing Started: $(date)"
echo "  Run time: $RUN_TIME"
echo "========================================"
} | tee -a "$LOG_FILE"

WMS_OK=true
NOTHING_NEW=false
python "$SCRIPT_DIR/run_all_wms.py" --use-url 2>&1 | tee -a "$LOG_FILE"
WMS_EXIT=${PIPESTATUS[0]}

if [ "$WMS_EXIT" -eq 2 ]; then
    NOTHING_NEW=true
elif [ "$WMS_EXIT" -ne 0 ]; then
    WMS_OK=false
fi

{
echo ""
if [ "$NOTHING_NEW" = true ]; then
    echo "  WMS finished at $(date)  [status: NOTHING NEW]"
else
    echo "  WMS finished at $(date)  [status: $([ "$WMS_OK" = true ] && echo OK || echo FAILED)]"
fi
echo "========================================"
} | tee -a "$LOG_FILE"

# ── Step 2: GWC Tile Seeding ────────────────────────────────────────────────
SEED_OK=true
if [ "$NOTHING_NEW" = true ]; then
    {
    echo ""
    echo "========================================"
    echo "  GWC Tile Seeding: SKIPPED (no new files)"
    echo "========================================"
    } | tee -a "$LOG_FILE"
elif [ "$WMS_OK" = true ]; then
    {
    echo ""
    echo "========================================"
    echo "  GWC Tile Seeding Started: $(date)"
    echo "========================================"
    } | tee -a "$LOG_FILE"

    if ! python "$SCRIPT_DIR/seed_tiles.py" 2>&1 | tee -a "$LOG_FILE"; then
        SEED_OK=false
    fi

    {
    echo ""
    echo "  Seeding finished at $(date)  [status: $([ "$SEED_OK" = true ] && echo OK || echo FAILED)]"
    echo "========================================"
    } | tee -a "$LOG_FILE"
fi

# ── Step 3: Send combined email ─────────────────────────────────────────────
if [ "$NOTHING_NEW" = true ]; then
    STATUS="success"
    SUBJECT="WMS + Seed ($RUN_TIME) — nothing new ℹ️"
    BODY="No new files found on JRC server. Seeding skipped.

Server: $(hostname)
Log: $LOG_FILE"
elif [ "$WMS_OK" = true ] && [ "$SEED_OK" = true ]; then
    STATUS="success"
    SUBJECT="WMS + Seed ($RUN_TIME) — OK ✅"
    BODY="WMS processing and GWC tile seeding completed successfully at $(date).

Server: $(hostname)
Log: $LOG_FILE"
elif [ "$WMS_OK" = false ]; then
    STATUS="failed"
    SUBJECT="WMS + Seed ($RUN_TIME) — WMS FAILED ❌"
    BODY="WMS processing FAILED at $(date). Seeding was skipped.

Server: $(hostname)
Log: $LOG_FILE

Action required: Review errors in the attached log."
else
    STATUS="failed"
    SUBJECT="WMS + Seed ($RUN_TIME) — Seeding FAILED ❌"
    BODY="WMS processing completed OK, but GWC tile seeding FAILED at $(date).

Server: $(hostname)
Log: $LOG_FILE

Action required: Review seed errors in the attached log."
fi

python "$SCRIPT_DIR/send_email_notification.py" \
    "$SUBJECT" \
    "$BODY" \
    "$LOG_FILE" \
    "$STATUS"

# Exit with error code if anything failed
if [ "$WMS_OK" = false ] || [ "$SEED_OK" = false ]; then
    exit 1
fi
