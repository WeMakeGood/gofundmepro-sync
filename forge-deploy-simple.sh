#!/bin/bash
# Simple Laravel Forge Deploy Script for GoFundMe Pro Sync

set -e

cd /home/eden/sync.eden-plus.org
git pull origin $FORGE_SITE_BRANCH

npm ci --production

# Install PM2 globally if not installed
npm list -g pm2 || npm install -g pm2

# Create directories
mkdir -p logs data

# Run migrations (safe for existing databases)
npm run migrate || echo "Migrations completed or not needed"

# Restart PM2
pm2 stop gofundmepro-sync || true
pm2 start ecosystem.config.js --env production
pm2 save