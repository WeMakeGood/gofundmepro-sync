# Deployment Guide

## Prerequisites

### System Requirements
- **Node.js**: 18+ LTS (recommended: 20.x)
- **Database**: SQLite (dev), MySQL 8+ (prod), or PostgreSQL 12+ (alternative)
- **Redis**: 6+ (optional, for job queues)
- **PM2**: Global installation for process management
- **Git**: For deployment automation

### API Access
- **GoFundMe Pro API**: Client ID and Secret
- **MailChimp API**: API Key and List ID (optional)

## Environment Setup

### 1. Clone and Configure

```bash
# Clone repository
git clone git@github.com:WeMakeGood/gofundmepro-sync.git
cd gofundmepro-sync

# Install dependencies
npm install

# Create environment configuration
cp .env.template .env
# Edit .env with your credentials
```

### 2. Database Setup

The system now uses **Knex.js** for universal database compatibility, supporting seamless switching between database types.

#### SQLite (Development/Small Scale)
```bash
# Default configuration - no additional setup needed
DB_TYPE=sqlite
# Database file created automatically at ./data/dev_database.sqlite

# Initialize database
npm run db:setup
```

#### MySQL (Production)
```bash
# Create database
mysql -u root -p
CREATE DATABASE classy_sync CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sync_user'@'localhost' IDENTIFIED BY 'secure_password';
GRANT ALL PRIVILEGES ON classy_sync.* TO 'sync_user'@'localhost';
FLUSH PRIVILEGES;

# Configure environment
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=classy_sync
DB_USER=sync_user
DB_PASSWORD=secure_password

# Initialize database with modern Knex system
npm run db:setup
```

#### PostgreSQL (Alternative Production)
```bash
# Create database
sudo -u postgres createdb classy_sync
sudo -u postgres createuser sync_user
sudo -u postgres psql -c "ALTER USER sync_user WITH PASSWORD 'secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE classy_sync TO sync_user;"

# Configure environment
DB_TYPE=pg
DB_HOST=localhost
DB_PORT=5432
DB_NAME=classy_sync
DB_USER=sync_user
DB_PASSWORD=secure_password

# Initialize database
npm run db:setup
```

#### Database Management Commands
```bash
# Check migration status
npm run db:status

# Apply pending migrations only
npm run db:init

# Reset and rebuild completely
npm run db:setup

# Validate schema integrity
npm run db:validate

# Test database flexibility
npm run db:test
```

### 3. Initial Data Sync

```bash
# Test with limited data first
npm run initial-sync -- --limit=100

# Full sync when ready (can take 10-30 minutes)
npm run initial-sync
```

### 🔄 **Sync System Performance & Reliability**

**Recent Critical Fixes (May 2025):**
- ✅ Fixed sync timestamp tracking to use actual data timestamps
- ✅ Added URL encoding for API date filters (GoFundMe Pro requirement)
- ✅ Implemented organization-wide transaction syncing for reliability
- ✅ Added graceful timeout handling for slow supporters API
- ✅ Resolved 4+ day sync gap issue with 90+ missing transactions recovered

**Expected Sync Behaviors:**
- **Transactions**: Fast, reliable syncing using organization-wide endpoints
- **Campaigns**: Uses client-side filtering due to API limitations
- **Supporters**: Includes timeout protection (60-second limit) - timeouts are expected and handled gracefully
- **Recurring Plans**: Standard incremental sync performance

### 4. MailChimp Integration (Optional)

```bash
# Configure in .env
MAILCHIMP_API_KEY=your-key-dc
MAILCHIMP_LIST_ID=your-list-id

# Test sync
npm run mailchimp-sync -- --dry-run --limit=10

# Full sync
npm run mailchimp-sync
```

## Production Deployment

### Option 1: PM2 (Recommended)

```bash
# Install PM2 globally
npm install -g pm2

# Production deployment
NODE_ENV=production pm2 start ecosystem.config.js --env production

# Monitor
pm2 status
pm2 logs gofundmepro-sync
pm2 monit

# Auto-start on system boot
pm2 startup
pm2 save
```

### Option 2: Systemd Service

Create `/etc/systemd/system/gofundmepro-sync.service`:

```ini
[Unit]
Description=GoFundMe Pro Sync Service
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/var/www/gofundmepro-sync
Environment=NODE_ENV=production
ExecStart=/usr/bin/node daemon.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=gofundmepro-sync

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl enable gofundmepro-sync
sudo systemctl start gofundmepro-sync
sudo systemctl status gofundmepro-sync
```

### Option 3: Docker (Future)

```bash
# Build image
docker build -t gofundmepro-sync .

# Run container
docker run -d \
  --name gofundmepro-sync \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  gofundmepro-sync
```

## Automated Deployment

### Using PM2 Ecosystem

```bash
# Setup deployment on server
pm2 deploy ecosystem.config.js production setup

# Deploy latest changes
pm2 deploy ecosystem.config.js production
```

### GitHub Actions (Example)

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'
        
    - name: Deploy to server
      run: |
        ssh ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} << 'EOF'
          cd /var/www/gofundmepro-sync
          git pull origin main
          npm install --production
          pm2 restart gofundmepro-sync
        EOF
```

## Monitoring and Maintenance

### Health Checks

```bash
# Check system status
npm run health-check

# Validate database integrity
npm run db:validate

# Validate supporter statistics accuracy
node scripts/recalculate-supporter-stats.js validate

# View logs
pm2 logs gofundmepro-sync
tail -f logs/sync.log
```

### Backup Strategy

```bash
# SQLite backup
cp data/classy.db data/classy-backup-$(date +%Y%m%d).db

# MySQL backup
mysqldump -u sync_user -p classy_sync > backup-$(date +%Y%m%d).sql
```

### Regular Maintenance

1. **Daily**: Monitor sync jobs and error rates
2. **Weekly**: Review database growth and performance, validate supporter statistics
3. **Monthly**: Update dependencies and security patches
4. **Quarterly**: Full system backup and disaster recovery test

### Data Integrity Maintenance

```bash
# Validate supporter lifetime calculations
node scripts/recalculate-supporter-stats.js validate

# Fix supporter statistics if discrepancies found
npm run fix:supporter-stats

# Validate database schema integrity
npm run db:validate
```

## Sync Scheduling

### Recommended Schedule (Updated for Reliability)

- **Incremental Sync**: Every hour (more reliable than 15 minutes)
- **Full Sync**: Daily at 2 AM (low traffic time)
- **MailChimp Sync**: Daily after full sync completion
- **System Restart**: Weekly for memory cleanup

**Note**: Hourly incremental syncs are now recommended due to:
- API timeout handling for supporters
- Improved reliability with organization-wide transaction syncing
- Better handling of API rate limits

### Cron Configuration

```bash
# Edit crontab
crontab -e

# Updated sync schedule (hourly for reliability)
0 * * * * cd /var/www/gofundmepro-sync && npm run manual-sync supporters incremental
5 * * * * cd /var/www/gofundmepro-sync && npm run manual-sync transactions incremental
10 * * * * cd /var/www/gofundmepro-sync && npm run manual-sync campaigns incremental
15 * * * * cd /var/www/gofundmepro-sync && npm run manual-sync recurring_plans incremental

# Daily full sync and MailChimp
0 2 * * * cd /var/www/gofundmepro-sync && npm run initial-sync
30 2 * * * cd /var/www/gofundmepro-sync && npm run mailchimp-sync
```

## Security Configuration

### File Permissions

```bash
# Set proper permissions
chmod 600 .env
chmod 755 scripts/*.js
chmod -R 750 src/
chown -R deploy:deploy /var/www/gofundmepro-sync
```

### Database Security

```sql
-- Remove unnecessary privileges
REVOKE ALL PRIVILEGES ON *.* FROM 'sync_user'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON classy_sync.* TO 'sync_user'@'localhost';

-- Enable SSL (recommended)
REQUIRE SSL;
```

### API Rate Limiting

- **GoFundMe Pro**: 1000 requests/hour (built-in throttling)
- **MailChimp**: 10 requests/second (configurable)

## Troubleshooting

### Common Issues

1. **Supporters API Timeouts (Expected Behavior)**
   ```bash
   # This is normal and handled gracefully
   tail -f logs/combined.log | grep "timeout"
   # Look for: "Supporters API too slow, skipping incremental sync this time"
   # This is acceptable since supporters update infrequently
   ```

2. **Missing Recent Transactions**
   ```bash
   # Check sync timestamps are working correctly
   node scripts/manual-sync.js transactions incremental --dry-run
   # Should show proper last sync times from actual data
   ```

3. **API Rate Limits**
   ```bash
   # Check logs for 429 errors
   grep "429" logs/sync.log
   
   # Adjust batch sizes in .env
   SYNC_BATCH_SIZE=50
   ```

2. **Database Connection Issues**
   ```bash
   # Test database connection with Knex
   npm run db:test
   
   # Or manually test
   node -e "
   const db = require('./src/core/knex-database');
   db.getInstance().connect().then(() => console.log('Connected'))
   "
   ```

3. **Memory Issues**
   ```bash
   # Monitor memory usage
   pm2 monit
   
   # Adjust PM2 memory limit
   pm2 restart gofundmepro-sync --max-memory-restart 512M
   ```

4. **Supporter Statistics Issues**
   ```bash
   # Check for data discrepancies
   node scripts/recalculate-supporter-stats.js validate
   
   # Fix incorrect lifetime calculations
   npm run fix:supporter-stats
   
   # Validate supporter_summary view is working
   npm run db:validate
   ```

### Log Analysis

```bash
# Error analysis
grep -i error logs/sync.log | tail -20

# Performance monitoring
grep "duration" logs/sync.log | grep "API call"

# Sync statistics
grep "Sync completed" logs/sync.log | tail -10
```

## Performance Optimization

### Database Optimization

```sql
-- Index analysis
ANALYZE TABLE supporters, transactions, recurring_plans, campaigns;

-- Query optimization
EXPLAIN SELECT * FROM supporter_summary WHERE donor_value_tier = 'Major Donor';
```

### API Optimization

- Batch size tuning: Start with 100, adjust based on response times
- Parallel processing: Consider multiple sync workers for large datasets
- Incremental sync: Use wherever possible to minimize API calls

### System Resources

- **CPU**: 2+ cores recommended for production
- **Memory**: 2GB minimum, 4GB recommended
- **Storage**: 10GB+ for database growth
- **Network**: Stable connection with 10+ Mbps

## Scaling Considerations

### Horizontal Scaling

- **Read Replicas**: For reporting and analytics
- **Queue Workers**: Separate sync and integration workers
- **Load Balancing**: Multiple sync instances with Redis coordination

### Vertical Scaling

- **Database**: Upgrade to dedicated MySQL server
- **Compute**: Scale CPU/memory based on data volume
- **Storage**: SSD recommended for database performance

---

For additional support, refer to the README.md or create a GitHub issue.