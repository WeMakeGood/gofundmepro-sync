# Classy Sync - Production Deployment Guide

This guide provides step-by-step instructions for deploying Classy Sync in production environments.

## 📋 Prerequisites

### System Requirements
- **Node.js**: 18.0.0 or higher
- **Database**: MySQL 5.7+, PostgreSQL 12+, or SQLite 3.x
- **Memory**: 512MB minimum, 2GB recommended
- **Storage**: 10GB minimum for logs and data
- **Network**: Outbound HTTPS access to Classy API and third-party services

### Required Credentials
- **Classy API**: Client ID and Client Secret for each organization
- **MailChimp** (optional): API Key and List ID
- **Database**: Connection credentials for production database

### Access Requirements
- **Classy API**: `https://api.classy.org/2.0/*` (OAuth2 authentication)
- **MailChimp API**: `https://*.api.mailchimp.com/3.0/*` (if using MailChimp integration)

## 🚀 Installation

### 1. Environment Setup
```bash
# Create deployment directory
mkdir /opt/classy-sync
cd /opt/classy-sync

# Clone repository
git clone <repository-url> .

# Install Node.js dependencies
npm ci --production
```

### 2. Database Configuration
Choose your database type and configure accordingly:

#### MySQL (Recommended for Production)
```bash
# Create database
mysql -u root -p -e "CREATE DATABASE classy_sync CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p -e "CREATE USER 'classy_sync'@'localhost' IDENTIFIED BY 'secure_password';"
mysql -u root -p -e "GRANT ALL PRIVILEGES ON classy_sync.* TO 'classy_sync'@'localhost';"
mysql -u root -p -e "FLUSH PRIVILEGES;"
```

#### PostgreSQL
```bash
# Create database and user
sudo -u postgres createuser --interactive classy_sync
sudo -u postgres createdb -O classy_sync classy_sync
```

#### SQLite (Development/Small Deployments)
```bash
# SQLite database will be created automatically
# Ensure write permissions to data directory
mkdir -p data
chmod 755 data
```

### 3. Environment Configuration
Create production environment file:

```bash
# Create environment file
cp .env.example .env

# Edit with production values
nano .env
```

**Required Environment Variables**:
```bash
# Database Configuration (MySQL Example)
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=classy_sync
DB_USER=classy_sync
DB_PASSWORD=secure_password

# Application Settings
NODE_ENV=production
LOG_LEVEL=info

# Optional: MailChimp Integration
MAILCHIMP_API_KEY=your_mailchimp_api_key
MAILCHIMP_LIST_ID=your_mailchimp_list_id

# Optional: Alert Webhooks
ALERT_WEBHOOK_URL=https://your-monitoring.com/webhook
ALERT_WEBHOOK_HEADERS={"Authorization":"Bearer your_token"}
```

### 4. Database Initialization
```bash
# Run database migrations
npm run db:migrate

# Seed reference data
npm run db:seed

# Verify database setup
npm run db:status
```

### 5. Health Check Verification
```bash
# Test system health
npm run health

# Expected output:
# ✅ database: HEALTHY
# ✅ plugin-manager: HEALTHY
# (✅ mailchimp: HEALTHY - if configured)
```

## 🏢 Organization Setup

### 1. Add Your First Organization
```bash
# Interactive organization setup
npm run org:add

# You'll be prompted for:
# - Organization name
# - Classy organization ID
# - Classy API client ID
# - Classy API client secret
```

### 2. Verify Organization Configuration
```bash
# List organizations
npm run org:list

# Test organization credentials
npm run health

# Test manual sync (small dataset)
npm run sync supporters incremental -- --limit=10
```

### 3. Bulk Organization Setup (Optional)
For multiple organizations, you can prepare credentials and add them programmatically:

```bash
# Example script for multiple organizations
node -e "
const { organizationManager } = require('./src/services/organization-manager');

async function setupOrganizations() {
  const orgs = [
    {
      name: 'Organization 1',
      classyId: 12345,
      clientId: 'client_id_1',
      clientSecret: 'client_secret_1'
    },
    // Add more organizations...
  ];

  for (const org of orgs) {
    await organizationManager.createOrganization({
      name: org.name,
      classyId: org.classyId,
      credentials: {
        clientId: org.clientId,
        clientSecret: org.clientSecret
      }
    });
    console.log('Added:', org.name);
  }
}

setupOrganizations().catch(console.error);
"
```

## ⚙️ Production Configuration

### 1. Daemon Configuration
Create or modify `daemon-config.json`:

```json
{
  "syncIntervals": {
    "supporters": 1800000,      // 30 minutes
    "transactions": 900000,     // 15 minutes  
    "campaigns": 3600000,       // 1 hour
    "recurringPlans": 3600000,  // 1 hour
    "plugins": 3600000          // 1 hour
  },
  "healthCheck": {
    "interval": 300000,         // 5 minutes
    "alertOnFailure": true
  },
  "statusReporting": {
    "interval": 3600000,        // 1 hour
    "logLevel": "info"
  },
  "autoRestart": {
    "enabled": true,
    "maxRestarts": 5,
    "restartDelay": 30000       // 30 seconds
  },
  "plugins": {
    "enabled": true,
    "mailchimp": true
  }
}
```

### 2. Logging Configuration
Configure log rotation and retention:

```bash
# Create logs directory
mkdir -p /var/log/classy-sync
chown classy-sync:classy-sync /var/log/classy-sync

# Configure logrotate
cat > /etc/logrotate.d/classy-sync << EOF
/var/log/classy-sync/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 classy-sync classy-sync
    postrotate
        systemctl reload classy-sync
    endscript
}
EOF
```

### 3. System Service Setup

#### Systemd Service (Recommended)
```bash
# Create service file
sudo cat > /etc/systemd/system/classy-sync.service << EOF
[Unit]
Description=Classy Sync - Automated Data Synchronization
After=network.target mysql.service

[Service]
Type=simple
User=classy-sync
Group=classy-sync
WorkingDirectory=/opt/classy-sync
ExecStart=/usr/bin/node src/daemon.js start
ExecStop=/usr/bin/node src/daemon.js stop
Restart=always
RestartSec=10

# Environment
EnvironmentFile=/opt/classy-sync/.env

# Logging
StandardOutput=append:/var/log/classy-sync/daemon.log
StandardError=append:/var/log/classy-sync/error.log

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/classy-sync

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable classy-sync
sudo systemctl start classy-sync
```

#### PM2 Process Manager (Alternative)
```bash
# Install PM2 globally
npm install -g pm2

# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'classy-sync',
    script: 'src/daemon.js',
    args: 'start',
    cwd: '/opt/classy-sync',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/classy-sync/error.log',
    out_file: '/var/log/classy-sync/daemon.log',
    log_file: '/var/log/classy-sync/combined.log'
  }]
};
EOF

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 🔍 Monitoring Setup

### 1. Health Monitoring
Set up regular health checks:

```bash
# Create health check script
cat > /opt/classy-sync/scripts/health-check.sh << EOF
#!/bin/bash
cd /opt/classy-sync

# Run health check
HEALTH_OUTPUT=\$(npm run health --silent 2>&1)
HEALTH_STATUS=\$?

if [ \$HEALTH_STATUS -ne 0 ]; then
    echo "CRITICAL: Classy Sync health check failed"
    echo "\$HEALTH_OUTPUT"
    # Send alert (webhook, email, etc.)
    if [ -n "\$ALERT_WEBHOOK_URL" ]; then
        curl -X POST "\$ALERT_WEBHOOK_URL" \
             -H "Content-Type: application/json" \
             -d "{\"status\":\"critical\",\"message\":\"Health check failed\",\"output\":\"\$HEALTH_OUTPUT\"}"
    fi
    exit 1
else
    echo "OK: Classy Sync is healthy"
    exit 0
fi
EOF

chmod +x /opt/classy-sync/scripts/health-check.sh

# Add to crontab for external monitoring
echo "*/5 * * * * /opt/classy-sync/scripts/health-check.sh" | crontab -
```

### 2. Performance Monitoring
Create performance monitoring script:

```bash
cat > /opt/classy-sync/scripts/performance-report.sh << EOF
#!/bin/bash
cd /opt/classy-sync

echo "=== Classy Sync Performance Report ==="
echo "Date: \$(date)"
echo ""

# Daemon status
echo "--- Daemon Status ---"
npm run daemon:status --silent

echo ""

# System health
echo "--- System Health ---"
npm run health --silent

echo ""

# Performance metrics
echo "--- Performance Metrics ---"
npm run status --json --silent | jq '.memory, .performance'

echo ""
echo "=========================="
EOF

chmod +x /opt/classy-sync/scripts/performance-report.sh

# Schedule daily performance reports
echo "0 8 * * * /opt/classy-sync/scripts/performance-report.sh | mail -s 'Classy Sync Daily Report' admin@yourorg.com" | crontab -
```

### 3. Log Monitoring
Set up log monitoring with your preferred solution:

```bash
# Example: Simple log monitoring
cat > /opt/classy-sync/scripts/log-monitor.sh << EOF
#!/bin/bash

# Monitor error patterns in logs
tail -f /var/log/classy-sync/error.log | while read line; do
    if echo "\$line" | grep -q "CRITICAL\|ERROR\|Failed"; then
        echo "Alert: \$line"
        # Send alert
    fi
done
EOF

chmod +x /opt/classy-sync/scripts/log-monitor.sh
```

## 🧪 Testing & Validation

### 1. Pre-Production Testing
```bash
# Test all critical functions
npm run health:detailed
npm run daemon:status
npm run org:list

# Test sync operations (limit to small dataset)
npm run sync supporters incremental -- --limit=10
npm run sync transactions incremental -- --limit=10

# Test MailChimp integration (if configured)
npm run mailchimp:sync -- --dry-run --limit=5
```

### 2. Load Testing
```bash
# Test with larger datasets
npm run sync supporters incremental -- --limit=100
npm run sync transactions full -- --limit=50

# Monitor resource usage
top -p $(pgrep -f "classy-sync")
```

### 3. Failure Recovery Testing
```bash
# Test daemon restart
npm run daemon:restart

# Verify automatic recovery
npm run daemon:status

# Check health after restart
npm run health
```

## 🚀 Production Launch

### 1. Initial Sync
```bash
# Start daemon for first time
npm run daemon:start

# Monitor initial sync
npm run daemon:status
npm run health:watch
```

### 2. Verification
```bash
# Check all organizations are syncing
npm run daemon:schedule

# Verify data integrity
npm run health:detailed

# Check performance metrics
npm run status --json
```

### 3. Ongoing Operations
```bash
# Daily checks
npm run daemon:status
npm run health

# Weekly performance review
npm run status --json

# Monthly failure analysis
grep "ERROR\|Failed" /var/log/classy-sync/*.log | tail -20
```

## 📊 Scaling Considerations

### Performance Optimization
- **Database Indexing**: Ensure proper indexes on frequently queried fields
- **Connection Pooling**: Configure database connection pools for high load
- **Memory Management**: Monitor memory usage and adjust Node.js heap size if needed

### High Availability
- **Database Replication**: Set up master-slave database replication
- **Load Balancing**: Consider multiple instances for high-volume organizations
- **Backup Strategy**: Implement regular database backups and disaster recovery

### Multi-Server Deployment
- **Container Deployment**: Docker/Kubernetes deployment for scalability
- **Service Mesh**: Microservices architecture for large-scale deployments
- **External Monitoring**: Integration with DataDog, New Relic, etc.

## 🔧 Maintenance Procedures

### Regular Maintenance
```bash
# Weekly tasks
npm run health:detailed
npm audit
npm update --production

# Monthly tasks
npm run db:cleanup  # If implemented
npm run performance:analyze  # If implemented

# Quarterly tasks
npm run security:audit  # If implemented
npm run db:optimize  # If implemented
```

### Backup Procedures
```bash
# Database backup
mysqldump -u classy_sync -p classy_sync > backup_$(date +%Y%m%d).sql

# Configuration backup
tar -czf config_backup_$(date +%Y%m%d).tar.gz .env daemon-config.json

# Log archive
tar -czf logs_$(date +%Y%m%d).tar.gz /var/log/classy-sync/
```

### Update Procedures
```bash
# Stop daemon
npm run daemon:stop

# Backup current version
cp -r /opt/classy-sync /opt/classy-sync.backup.$(date +%Y%m%d)

# Pull updates
git pull origin main

# Update dependencies
npm ci --production

# Run migrations (if any)
npm run db:migrate

# Test updated system
npm run health

# Restart daemon
npm run daemon:start

# Verify operation
npm run daemon:status
```

## 🆘 Troubleshooting

### Common Issues

**1. Database Connection Failed**
```bash
# Check database status
systemctl status mysql  # or postgresql

# Test connection
npm run db:status

# Check credentials
npm run health database
```

**2. API Authentication Failed**
```bash
# Check organization credentials
npm run org:list

# Test API connectivity
npm run health

# Re-add organization if needed
npm run org:add
```

**3. Daemon Won't Start**
```bash
# Check for existing processes
ps aux | grep classy-sync

# Check PID file
cat daemon.pid

# Remove stale PID file
rm daemon.pid

# Start daemon
npm run daemon:start
```

**4. High Memory Usage**
```bash
# Check memory usage
npm run status --json | jq '.memory'

# Restart daemon to clear memory
npm run daemon:restart

# Monitor for memory leaks
npm run health:watch
```

### Log Analysis
```bash
# View recent errors
tail -50 /var/log/classy-sync/error.log

# Search for specific issues
grep "timeout\|connection\|failed" /var/log/classy-sync/*.log

# View daemon logs
journalctl -u classy-sync -f
```

### Emergency Procedures
```bash
# Emergency stop
npm run daemon:stop
pkill -f classy-sync

# Safe restart
npm run daemon:restart

# Recovery mode (manual sync)
npm run sync supporters incremental -- --limit=1
```

## 📞 Support

### Getting Help
- **Documentation**: Check comprehensive guides in repository
- **Health Diagnostics**: Use built-in `npm run health:detailed`
- **Log Analysis**: Review logs for specific error messages
- **Community**: Open source project with active development

### Reporting Issues
When reporting issues, include:
- Health check output: `npm run health:detailed`
- Daemon status: `npm run daemon:status`
- Recent logs: Last 50 lines from error logs
- Environment details: OS, Node.js version, database type

---

**Your Classy Sync system is now ready for production! 🚀**

For ongoing support and updates, monitor the repository and maintain regular backups and health checks.