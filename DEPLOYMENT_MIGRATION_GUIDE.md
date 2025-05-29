# Database Migration Deployment Guide

## Overview
This guide ensures consistent and reliable database migrations across all environments, with specific focus on MySQL production deployments.

## Pre-Deployment Checklist

### 1. Environment Verification
```bash
# Verify database connection
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "SELECT 1"

# Check database type in .env
grep "DB_TYPE=" .env

# Verify Node.js environment
node -v  # Should be >= 16.x
npm -v   # Should be >= 8.x
```

### 2. Backup Current Database
```bash
# Create backup before any migration
mysqldump -u $DB_USER -p$DB_PASSWORD $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).sql

# Verify backup integrity
mysql -u $DB_USER -p$DB_PASSWORD -e "CREATE DATABASE temp_verify;"
mysql -u $DB_USER -p$DB_PASSWORD temp_verify < backup_*.sql
mysql -u $DB_USER -p$DB_PASSWORD -e "DROP DATABASE temp_verify;"
```

## Migration Process

### For Fresh Deployments (New Database)

1. **Initialize Database**
```bash
# Apply base MySQL-compatible schema
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < migrations/001_create_initial_tables_mysql.sql
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < migrations/002_add_consent_fields_mysql.sql
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < migrations/004_flexible_donor_segmentation_mysql.sql
```

2. **Apply Analytics Views**
```bash
# Apply the comprehensive segmentation system (combines 005-007)
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < /tmp/migration_005.sql
```

3. **Verify Schema**
```bash
node scripts/migrate.js status
```

### For Existing Deployments (Database Updates)

1. **Check Current Status**
```bash
node scripts/migrate.js status
```

2. **Apply Pending Migrations**
```bash
# Run standard migration process
node scripts/migrate.js up
```

3. **Manual View Updates** (if needed)
```bash
# Update analytical views with latest fixes
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "
DROP VIEW IF EXISTS supporter_summary;
DROP VIEW IF EXISTS donor_value_distribution;
DROP VIEW IF EXISTS donor_engagement_distribution;
DROP VIEW IF EXISTS campaign_performance;
"

# Reapply views
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < /tmp/migration_005.sql
```

## Database Schema Validation

### Required Tables Verification
```sql
-- Verify all required tables exist
SELECT 
    table_name,
    CASE 
        WHEN table_name IN (
            'organizations', 'campaigns', 'supporters', 'recurring_plans', 
            'transactions', 'fundraising_teams', 'fundraising_pages', 
            'sync_jobs', 'migrations', 'donor_segmentation_config'
        ) THEN '✅ Required'
        ELSE '⚠️  Optional'
    END as status
FROM information_schema.tables 
WHERE table_schema = DATABASE()
ORDER BY table_name;
```

### Required Views Verification
```sql
-- Verify all required views exist
SELECT 
    table_name as view_name,
    CASE 
        WHEN table_name IN (
            'campaign_performance', 'supporter_summary', 
            'donor_value_distribution', 'donor_engagement_distribution'
        ) THEN '✅ Required'
        ELSE '⚠️  Unknown'
    END as status
FROM information_schema.views 
WHERE table_schema = DATABASE()
ORDER BY table_name;
```

### Data Integrity Checks
```sql
-- Verify foreign key relationships
SELECT 
    'Campaigns without organization' as check_name,
    COUNT(*) as count
FROM campaigns c 
LEFT JOIN organizations o ON c.organization_id = o.id 
WHERE c.organization_id IS NOT NULL AND o.id IS NULL

UNION ALL

SELECT 
    'Transactions without supporter' as check_name,
    COUNT(*) as count
FROM transactions t 
LEFT JOIN supporters s ON t.supporter_id = s.id 
WHERE t.supporter_id IS NOT NULL AND s.id IS NULL

UNION ALL

SELECT 
    'Supporters with null lifetime amounts (should be rare)' as check_name,
    COUNT(*) as count
FROM supporters 
WHERE lifetime_donation_amount IS NULL AND lifetime_donation_count > 0;
```

## Troubleshooting

### Common Issues and Solutions

#### 1. Migration Runner Fails
```bash
# Check database connection
node -e "require('./src/core/database').getInstance().connect().then(() => console.log('✅ Connected')).catch(console.error)"

# Check migration table exists
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "DESCRIBE migrations;"
```

#### 2. View Creation Fails
```bash
# Check for conflicting views
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "SHOW FULL TABLES WHERE table_type = 'VIEW';"

# Drop and recreate all views
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "
DROP VIEW IF EXISTS supporter_summary;
DROP VIEW IF EXISTS donor_value_distribution;
DROP VIEW IF EXISTS donor_engagement_distribution;
DROP VIEW IF EXISTS campaign_performance;
"
```

#### 3. SQLite vs MySQL Syntax Errors
- Always use MySQL-compatible migration files for production
- Replace `julianday()` with `DATEDIFF()`
- Replace `INSERT OR IGNORE` with `INSERT IGNORE`
- Replace `INTEGER PRIMARY KEY AUTOINCREMENT` with `INT AUTO_INCREMENT PRIMARY KEY`

### Migration Rollback Process
```bash
# Rollback last migration
node scripts/migrate.js rollback

# Rollback to specific version
node scripts/migrate.js rollback 003

# Manual rollback (if automated fails)
mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "
DELETE FROM migrations WHERE version = 'XXX';
-- Add manual cleanup SQL here
"
```

## Environment-Specific Configuration

### Development (SQLite)
- Use original migration files in `migrations/`
- Faster setup and testing
- Data persistence in local file

### Production (MySQL)
- Use MySQL-compatible migration files (`*_mysql.sql`)
- Always backup before migrations
- Monitor performance of analytical views
- Consider read replicas for heavy analytics

## Post-Migration Verification

### 1. Data Sync Test
```bash
# Test data synchronization after migration
node scripts/manual-sync.js --entity=supporters --limit=10
```

### 2. View Performance Test
```sql
-- Test analytical view performance
SELECT COUNT(*) FROM supporter_summary;
SELECT COUNT(*) FROM donor_value_distribution;
SELECT COUNT(*) FROM donor_engagement_distribution;
SELECT COUNT(*) FROM campaign_performance;
```

### 3. Application Health Check
```bash
# Start application and test
node daemon.js &
sleep 5
curl http://localhost:3000/health
```

## Success Criteria

✅ All required tables and views exist  
✅ Migration status shows all applied  
✅ Foreign key relationships intact  
✅ Analytical views return data  
✅ Application starts without errors  
✅ Sync processes work correctly  

## Support

If migrations fail or data integrity issues occur:

1. **Stop all sync processes**: `pm2 stop ecosystem.config.js`
2. **Restore from backup**: `mysql -u $DB_USER -p$DB_PASSWORD $DB_NAME < backup_file.sql`
3. **Contact support** with:
   - Migration status output
   - Error logs from `logs/sync.log`
   - Database schema comparison
   - Environment configuration (without credentials)