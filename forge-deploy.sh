#!/bin/bash

# Laravel Forge Deploy Script for GoFundMe Pro Sync
# Updated for Node.js application with MySQL

set -e  # Exit on any error

echo "🚀 Starting deployment..."

# Navigate to the project directory
cd /home/eden/sync.eden-plus.org

# Pull latest code
echo "📦 Pulling latest code from $FORGE_SITE_BRANCH..."
git pull origin $FORGE_SITE_BRANCH

# Install dependencies (production only)
echo "📋 Installing dependencies..."
npm ci --production --silent

# Install PM2 globally if not already installed
echo "🔧 Checking PM2 installation..."
if ! npm list -g pm2 > /dev/null 2>&1; then
    echo "Installing PM2 globally..."
    npm install -g pm2
else
    echo "PM2 already installed"
fi

# Create required directories with proper permissions
echo "📁 Creating required directories..."
mkdir -p /home/eden/sync.eden-plus.org/logs
mkdir -p /home/eden/sync.eden-plus.org/data
chmod 755 /home/eden/sync.eden-plus.org/logs
chmod 755 /home/eden/sync.eden-plus.org/data

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ ERROR: .env file not found!"
    echo "Please create .env file with production configuration"
    exit 1
fi

# Run database migrations (skip init-db as it would wipe existing data)
echo "🗄️ Running database migrations..."
if npm run migrate > /dev/null 2>&1; then
    echo "✅ Database migrations completed"
else
    echo "⚠️ Database migrations failed or not needed"
fi

# Test database connection before proceeding
echo "🔍 Testing database connection..."
if node -e "
require('dotenv').config();
const { getInstance } = require('./src/core/database');
(async () => {
  try {
    const db = getInstance();
    await db.connect();
    const health = await db.healthCheck();
    if (health.status === 'ok') {
      console.log('✅ Database connection successful');
      await db.close();
    } else {
      console.error('❌ Database health check failed:', health);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
})();
"; then
    echo "Database connection verified"
else
    echo "❌ Database connection test failed - aborting deployment"
    exit 1
fi

# Stop existing PM2 process gracefully if running
echo "🛑 Stopping existing PM2 processes..."
pm2 stop gofundmepro-sync || echo "No existing process to stop"

# Start or reload PM2 using the ecosystem config
echo "🎯 Starting application with PM2..."
pm2 start ecosystem.config.js --env production

# Wait a few seconds for the process to stabilize
sleep 5

# Check if the process is running successfully
if pm2 list | grep -q "gofundmepro-sync.*online"; then
    echo "✅ Application started successfully"
else
    echo "❌ Application failed to start - checking logs..."
    pm2 logs gofundmepro-sync --lines 20
    exit 1
fi

# Save PM2 process list to resurrect on reboot
echo "💾 Saving PM2 process list..."
pm2 save

# Setup PM2 startup script (idempotent - safe to run multiple times)
echo "🔄 Setting up PM2 startup script..."
# Use the actual user that Forge uses (typically 'forge')
FORGE_USER=${USER:-forge}
FORGE_HOME=${HOME:-/home/forge}
pm2 startup systemd -u $FORGE_USER --hp $FORGE_HOME > /dev/null 2>&1 || true

# Display final status
echo ""
echo "🎉 Deployment completed successfully!"
echo ""
echo "📊 Application Status:"
pm2 list | grep gofundmepro-sync

echo ""
echo "📋 Recent logs:"
pm2 logs gofundmepro-sync --lines 5 --nostream

echo ""
echo "🔗 Useful commands:"
echo "  View logs: pm2 logs gofundmepro-sync"
echo "  Restart:   pm2 restart gofundmepro-sync"
echo "  Stop:      pm2 stop gofundmepro-sync"
echo "  Status:    pm2 status"