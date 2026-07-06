#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Deploy STAGING: push develop to GitHub & update staging server
# Usage: ./deploy-staging.sh
# ═══════════════════════════════════════════════════════════════

set -e

SSH_KEY="/Users/martinjancovic/Documents/dev_projects/coastal_WMS/coastal_WMS_server/key/id_rsa"
SERVER="ubuntu@89.47.190.54"
SERVER_PATH="/opt/geoserver/web_dev"

echo "🧪 Deploying to STAGING (port 8082)..."
echo ""

# 1. Ensure we're on develop and it's clean
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "develop" ]; then
    echo "⚠️  Not on develop branch (currently on: $CURRENT_BRANCH)"
    echo "   Switching to develop..."
    git checkout develop
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ You have uncommitted changes. Commit or stash them first."
    exit 1
fi

# 2. Push develop to GitHub
echo "📤 Pushing develop to GitHub..."
git push origin develop

# 3. Update staging on server
echo "🖥️  Updating staging server..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SERVER" \
    "cd $SERVER_PATH && git pull origin develop"

echo ""
echo "✅ Staging deployed!"
echo "   URL: http://89.47.190.54:8082"
echo "   Branch: develop"
