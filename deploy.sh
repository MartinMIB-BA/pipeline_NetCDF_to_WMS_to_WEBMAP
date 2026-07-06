#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Deploy script: merge develop → main, push to GitHub & server
# Usage: ./deploy.sh
# ═══════════════════════════════════════════════════════════════

set -e  # Exit on any error

SSH_KEY="/Users/martinjancovic/Documents/dev_projects/coastal_WMS/coastal_WMS_server/key/id_rsa"
SERVER="ubuntu@89.47.190.54"
SERVER_PATH="/opt/geoserver/web"

echo "🚀 Starting deployment..."
echo ""

# 1. Ensure we're on develop and it's clean
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "develop" ]; then
    echo "⚠️  Not on develop branch (currently on: $CURRENT_BRANCH)"
    echo "   Switching to develop..."
    git checkout develop
fi

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ You have uncommitted changes. Commit or stash them first."
    exit 1
fi

# 2. Push develop to GitHub (ensure remote is up to date)
echo "📤 Pushing develop to GitHub..."
git push origin develop

# 3. Switch to main and merge develop
echo "🔀 Merging develop → main..."
git checkout main
git merge develop -m "deploy: merge develop into main"

# 4. Push main to GitHub
echo "📤 Pushing main to GitHub..."
git push origin main

# 5. Deploy to server
echo "🖥️  Deploying to server..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SERVER" \
    "cd $SERVER_PATH && git pull origin main"

# 6. Switch back to develop
git checkout develop

echo ""
echo "✅ Deployment complete!"
echo "   GitHub main: updated"
echo "   Server:      updated"
echo "   Local:       back on develop"
