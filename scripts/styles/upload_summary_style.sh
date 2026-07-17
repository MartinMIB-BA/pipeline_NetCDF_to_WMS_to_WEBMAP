#!/bin/bash
# Upload SUMMARY_WMS style to GeoServer
# Usage: ./upload_summary_style.sh [GEOSERVER_URL] [USER] [PASSWORD]

GEOSERVER_URL="${1:-http://89.47.190.54:8080/geoserver}"
USER="${2:-admin}"
PASSWORD="${3:-geoserver}"
STYLE_NAME="SUMMARY_WMS"
SLD_FILE="$(dirname "$0")/SUMMARY_WMS.sld"

echo "Uploading ${STYLE_NAME} to ${GEOSERVER_URL}..."

# Check if style exists
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -u "${USER}:${PASSWORD}" \
  "${GEOSERVER_URL}/rest/styles/${STYLE_NAME}.json")

if [ "$HTTP_CODE" = "200" ]; then
    echo "Style exists — updating..."
    curl -s -u "${USER}:${PASSWORD}" \
      -X PUT \
      -H "Content-Type: application/vnd.ogc.sld+xml" \
      -d @"${SLD_FILE}" \
      "${GEOSERVER_URL}/rest/styles/${STYLE_NAME}"
else
    echo "Creating new style..."
    # Create style entry
    curl -s -u "${USER}:${PASSWORD}" \
      -X POST \
      -H "Content-Type: application/json" \
      -d "{\"style\":{\"name\":\"${STYLE_NAME}\",\"filename\":\"${STYLE_NAME}.sld\"}}" \
      "${GEOSERVER_URL}/rest/styles"

    # Upload SLD body
    curl -s -u "${USER}:${PASSWORD}" \
      -X PUT \
      -H "Content-Type: application/vnd.ogc.sld+xml" \
      -d @"${SLD_FILE}" \
      "${GEOSERVER_URL}/rest/styles/${STYLE_NAME}"
fi

echo ""
echo "✅ Done. Style ${STYLE_NAME} uploaded to ${GEOSERVER_URL}"
