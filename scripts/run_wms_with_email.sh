#!/bin/bash
#
# WMS Processing with Email Notifications
# Runs WMS processing and sends email notification on completion/failure
#

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Activate conda environment
echo "Activating conda environment 'wms'..."
# Source user's bash_profile/bashrc so conda init is available in non-interactive cron jobs
source ~/.bashrc 2>/dev/null || true
# Alternatively evaluate conda hook directly
eval "$(conda shell.bash hook 2>/dev/null)" || true
conda activate wms

LOG_FILE="$1"  # Log file path passed as argument
RUN_TIME="$2"  # Run time identifier (8am, 2pm, 6pm)

# Load environment variables (including Gmail App Password)
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# Default values if not in .env
EMAIL_TO="${EMAIL_TO:-martin.jancovic01@gmail.com}"
EMAIL_FROM="${EMAIL_FROM:-martin.jancovic01@gmail.com}"

# Check if Gmail App Password is set
if [ -z "$GMAIL_APP_PASSWORD" ]; then
    echo "❌ Error: GMAIL_APP_PASSWORD not set in .env file"
    exit 1
fi

# Run WMS processing and capture output
echo "========================================"
echo "WMS Processing Started: $(date)"
echo "Run time: $RUN_TIME"
echo "========================================"

# Make Python output unbuffered for real-time logging
export PYTHONUNBUFFERED=1
# Reduce progress bar update frequency for readable logs (update every 5 seconds)
export TQDM_MININTERVAL=5

if python run_all_wms.py --use-url 2>&1 | tee "$LOG_FILE"; then
    # Success
    echo "✅ WMS Processing completed successfully"
    
    # Send success email
    python send_email_notification.py \
        "WMS Processing ($RUN_TIME)" \
        "WMS processing completed successfully at $(date).

Files processed: See attached log
Next run: Scheduled via cron

Server: $(hostname)
Log: $LOG_FILE" \
        "$LOG_FILE" \
        "success"
else
    # Failure
    echo "❌ WMS Processing failed"
    
    # Send failure email
    python send_email_notification.py \
        "WMS Processing ($RUN_TIME)" \
        "⚠️ WMS processing FAILED at $(date).

Please check the attached log file for details.

Server: $(hostname)
Log: $LOG_FILE

Action required: Review errors and restart if needed." \
        "$LOG_FILE" \
        "failed"
    
    exit 1
fi
