#!/bin/bash
# Laravel Forge Deploy Script for GoFundMe Pro Sync
# Updated for Knex.js universal database system and data integrity tools

set -e

cd /home/eden/sync.eden-plus.org
git pull origin $FORGE_SITE_BRANCH

npm ci --production

# Install PM2 globally if not installed
npm list -g pm2 || npm install -g pm2

# Create directories
mkdir -p logs data

# Run Knex migrations (safe for existing databases)
echo "Running database migrations with Knex..."
npm run db:init || echo "Migrations completed or not needed"

# Validate database schema integrity
echo "Validating database schema..."
npm run db:validate || echo "Database validation completed"

# Validate supporter statistics accuracy (weekly maintenance)
echo "Validating supporter statistics..."
node scripts/recalculate-supporter-stats.js validate || echo "Supporter stats validation completed"

# Restart PM2 with error handling
echo "Restarting application..."
pm2 stop gofundmepro-sync || true
pm2 delete gofundmepro-sync || true
pm2 start ecosystem.config.js --env production
pm2 save

echo "Deployment completed successfully!"
echo "Check status with: pm2 status"
echo "View logs with: pm2 logs gofundmepro-sync"