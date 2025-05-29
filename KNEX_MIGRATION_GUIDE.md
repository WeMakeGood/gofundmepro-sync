# Migration Guide: Legacy to Knex.js

## Overview
This guide helps you migrate from the legacy database system to the new **Knex.js-based universal database layer**.

---

## 🎯 **Benefits of Migration**

### **Before (Legacy System)**
- ❌ **14 separate migration files** (7 SQLite + 7 MySQL)
- ❌ **Manual syntax conversion** between databases
- ❌ **Database-specific code** scattered throughout
- ❌ **Complex maintenance** and error-prone deployments
- ❌ **Limited database support** (SQLite + MySQL only)

### **After (Knex.js System)**
- ✅ **4 universal migration files** work everywhere
- ✅ **Automatic syntax translation** by Knex
- ✅ **Single codebase** for all databases
- ✅ **Professional migration management**
- ✅ **Support for SQLite, MySQL, PostgreSQL** + more

---

## 🚀 **Migration Steps**

### **Step 1: Backup Current Data**
```bash
# For MySQL
mysqldump -u classy_sync -p classy_sync > backup_before_knex_$(date +%Y%m%d).sql

# For SQLite
cp data/classy.db data/backup_before_knex_$(date +%Y%m%d).db
```

### **Step 2: Install Knex Dependencies**
```bash
# Dependencies already installed if you pulled latest code
npm install

# Verify Knex is available
npx knex --version
```

### **Step 3: Reset Database with Knex**
```bash
# IMPORTANT: This will delete all data and rebuild with Knex
CONFIRM_RESET=yes npm run db:setup
```

### **Step 4: Validate New Schema**
```bash
# Verify all tables and views are created correctly
npm run db:validate

# Test database operations
npm run db:test
```

### **Step 5: Re-sync Data**
```bash
# Start with a small test
npm run initial-sync -- --limit=100

# Full sync when verified working
npm run initial-sync
```

### **Step 6: Update Deployment Scripts**
Replace any references to old migration system:

**Old:**
```bash
node scripts/init-db.js
node scripts/migrate.js up
```

**New:**
```bash
npm run db:setup     # Complete setup
npm run db:init      # Just run migrations
npm run db:validate  # Verify setup
```

---

## 📋 **Migration Checklist**

### **Pre-Migration**
- [ ] **Data backed up** (MySQL dump or SQLite copy)
- [ ] **Dependencies installed** (`npm install` completed)
- [ ] **Environment variables** configured correctly
- [ ] **Database credentials** tested and working

### **During Migration**
- [ ] **Old database reset** with confirmation
- [ ] **Knex migrations applied** successfully
- [ ] **Database validation** passes all checks
- [ ] **Views created** and returning correct data

### **Post-Migration**
- [ ] **Data re-synced** from Classy API
- [ ] **MailChimp integration** tested (if used)
- [ ] **Deployment scripts** updated
- [ ] **Team notified** of new commands

---

## 🔧 **Updated Commands Reference**

### **Database Management**
| Task | Old Command | New Command |
|------|-------------|-------------|
| **Initialize DB** | `node scripts/init-db.js init` | `npm run db:init` |
| **Reset DB** | `CONFIRM_RESET=yes node scripts/init-db.js reset` | `npm run db:reset` |
| **Complete Setup** | Multiple commands | `npm run db:setup` |
| **Check Status** | `node scripts/migrate.js status` | `npm run db:status` |
| **Validate Schema** | Manual queries | `npm run db:validate` |

### **Development Workflow**
| Task | Old Approach | New Approach |
|------|--------------|--------------|
| **Switch DB Type** | Edit code + migrations | Change `DB_TYPE` env var |
| **Add Migration** | Create 2 files (SQLite + MySQL) | Create 1 Knex migration |
| **Test Locally** | SQLite-specific setup | `npm run db:test` |
| **Deploy Production** | MySQL-specific process | Same commands, any DB |

---

## 🔍 **Verification Steps**

### **1. Schema Validation**
```bash
npm run db:validate
# Should show all green checkmarks ✅
```

### **2. Data Integrity**
```bash
# Check table counts
mysql -u classy_sync -p classy_sync -e "
SELECT 
  'organizations' as table_name, COUNT(*) as count FROM organizations
UNION ALL SELECT 'campaigns', COUNT(*) FROM campaigns  
UNION ALL SELECT 'supporters', COUNT(*) FROM supporters
UNION ALL SELECT 'transactions', COUNT(*) FROM transactions;"
```

### **3. View Performance**
```bash
# Test analytical views
mysql -u classy_sync -p classy_sync -e "
SELECT 'supporter_summary' as view_name, COUNT(*) as count FROM supporter_summary
UNION ALL SELECT 'donor_value_distribution', COUNT(*) FROM donor_value_distribution
UNION ALL SELECT 'donor_engagement_distribution', COUNT(*) FROM donor_engagement_distribution
UNION ALL SELECT 'campaign_performance', COUNT(*) FROM campaign_performance;"
```

### **4. Cross-Database Compatibility**
```bash
# Test database flexibility
npm run db:test
# Should show successful operations across different DB types
```

---

## 🐛 **Troubleshooting**

### **Common Issues**

#### **1. Migration Files Not Found**
```bash
# Error: No migration files found
# Solution: Verify knex_migrations/ directory exists
ls -la knex_migrations/
```

#### **2. Database Connection Failed**
```bash
# Error: Database connection failed
# Solution: Check .env configuration
npm run db:test
```

#### **3. Views Not Created**
```bash
# Error: Views missing from validation
# Solution: Re-run migration 004
npx knex migrate:up 20241201000004_create_analytical_views.js
```

#### **4. Permission Denied**
```bash
# Error: Permission denied for database operations
# Solution: Verify database user permissions
GRANT ALL PRIVILEGES ON classy_sync.* TO 'sync_user'@'localhost';
```

### **Recovery Procedures**

#### **If Migration Fails Halfway**
```bash
# Reset and start over
npm run db:reset
npm run db:init
npm run db:seed
npm run db:validate
```

#### **If Data Corruption Occurs**
```bash
# Restore from backup
mysql -u classy_sync -p classy_sync < backup_before_knex_YYYYMMDD.sql

# Or for SQLite
cp data/backup_before_knex_YYYYMMDD.db data/dev_database.sqlite
```

#### **If Views Are Broken**
```bash
# Re-create views only
npx knex migrate:down 20241201000004_create_analytical_views.js
npx knex migrate:up 20241201000004_create_analytical_views.js
```

---

## 📈 **Post-Migration Benefits**

### **Immediate Benefits**
- ✅ **Single migration system** across all environments
- ✅ **Professional database management** with proper versioning
- ✅ **Automatic syntax handling** for different databases
- ✅ **Comprehensive validation** and testing tools

### **Long-term Benefits**
- ✅ **Easy database switching** (SQLite ↔ MySQL ↔ PostgreSQL)
- ✅ **Simplified maintenance** (71% fewer migration files)
- ✅ **Future-proof architecture** (supports additional databases)
- ✅ **Enhanced developer experience** (type-safe queries)

### **Operational Benefits**
- ✅ **Faster deployments** (consistent commands)
- ✅ **Reduced errors** (no syntax conflicts)
- ✅ **Better testing** (database flexibility)
- ✅ **Scalable foundation** (professional ORM)

---

## 🎯 **Success Criteria**

Your migration is successful when:

1. **✅ Database Validation Passes**
   ```bash
   npm run db:validate
   # Shows all green checkmarks for tables and views
   ```

2. **✅ Data Sync Works**
   ```bash
   npm run initial-sync -- --limit=10
   # Successfully syncs and stores data
   ```

3. **✅ Views Return Data**
   ```sql
   SELECT COUNT(*) FROM supporter_summary;
   SELECT COUNT(*) FROM donor_value_distribution;
   # Both return reasonable counts (not zero)
   ```

4. **✅ Flexibility Test Passes**
   ```bash
   npm run db:test
   # Shows successful cross-database operations
   ```

---

## 🆘 **Support**

If you encounter issues during migration:

1. **Check logs** in `./logs/sync.log`
2. **Verify environment** with `npm run db:test`
3. **Restore from backup** if needed
4. **Contact team** with specific error messages

The Knex migration provides a **solid foundation** for future development and eliminates the database compatibility headaches permanently!