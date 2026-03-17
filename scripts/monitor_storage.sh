#!/bin/bash
# Disk Usage Monitoring Script for WMS Processing
# Run this daily via cron to monitor disk space usage

GEOSERVER_DATA_DIR="${GEOSERVER_DATA_DIR:-/opt/geoserver/data_dir}"
WORKSPACE="${WORKSPACE:-E_and_T}"
ALERT_THRESHOLD_GB="${ALERT_THRESHOLD_GB:-50}"

echo "=================================================================="
echo "WMS DISK USAGE MONITORING - $(date)"
echo "=================================================================="
echo ""

# Check if directory exists
if [ ! -d "$GEOSERVER_DATA_DIR/data/$WORKSPACE" ]; then
    echo "⚠️  WARNING: Directory not found: $GEOSERVER_DATA_DIR/data/$WORKSPACE"
    exit 1
fi

# Display usage for each store
echo "📊 Storage Usage by Store:"
echo "------------------------------------------------------------------"
du -sh "$GEOSERVER_DATA_DIR/data/$WORKSPACE"/* 2>/dev/null | sort -h | while read size path; do
    store_name=$(basename "$path")
    
    # Convert size to GB for comparison
    size_in_gb=$(echo "$size" | awk '{
        if ($1 ~ /G$/) {
            gsub(/G$/, "", $1); print $1
        } else if ($1 ~ /M$/) {
            gsub(/M$/, "", $1); print $1/1024
        } else if ($1 ~ /K$/) {
            gsub(/K$/, "", $1); print $1/1024/1024
        } else {
            print $1/1024/1024/1024
        }
    }')
    
    # Check if over threshold
    if (( $(echo "$size_in_gb > $ALERT_THRESHOLD_GB" | bc -l) )); then
        echo "  ⚠️  $size  $store_name  (OVER ${ALERT_THRESHOLD_GB}GB THRESHOLD!)"
    else
        echo "  ✅  $size  $store_name"
    fi
done

echo ""
echo "📊 Total Storage Usage:"
echo "------------------------------------------------------------------"
du -sh "$GEOSERVER_DATA_DIR/data/$WORKSPACE" 2>/dev/null

echo ""
echo "📊 File Counts by Store:"
echo "------------------------------------------------------------------"
for store_dir in "$GEOSERVER_DATA_DIR/data/$WORKSPACE"/*; do
    if [ -d "$store_dir" ]; then
        store_name=$(basename "$store_dir")
        file_count=$(find "$store_dir" -name "*.tif" 2>/dev/null | wc -l)
        echo "  $store_name: $file_count GeoTIFF files"
    fi
done

echo ""
echo "=================================================================="
echo "Monitoring Complete"
echo "=================================================================="
