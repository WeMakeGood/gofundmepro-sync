# Database Migration Analysis & Validation

## Migration Order and Dependencies

### Correct Execution Order:
1. **001_create_initial_tables** - Creates all base tables and structure
2. **002_add_consent_fields** - Adds consent fields to supporters table (depends on 001)
3. **003_enhance_performance_and_relationships** - Creates views and organization data (depends on 001)
4. **004_flexible_donor_segmentation** - Creates segmentation config table (depends on 001)
5. **005_improved_donor_segmentation** - Creates advanced views with segmentation (depends on 004)
6. **006_fix_engagement_segmentation** - Fixes engagement logic in views (depends on 005)
7. **007_fix_date_calculations** - Fixes date parsing for MySQL (depends on 005/006)

### Current Status (Production Database):
- ✅ **001**: Applied (2025-05-29 16:35:51)
- ❌ **002**: Missing - consent fields not applied
- ✅ **003**: Applied (2025-05-29 21:23:16) - manually via tmp files
- ❌ **004**: Missing - segmentation config table not created
- ✅ **005**: Applied manually via tmp files - views created
- ❌ **006**: Not needed (logic already corrected in 005)
- ❌ **007**: Not needed (MySQL compatibility already handled)

## MySQL Compatibility Issues Found

### 1. Primary Key Auto-Increment
- **SQLite**: `INTEGER PRIMARY KEY AUTOINCREMENT`
- **MySQL**: `INT AUTO_INCREMENT PRIMARY KEY`

### 2. Insert Syntax
- **SQLite**: `INSERT OR IGNORE INTO`
- **MySQL**: `INSERT IGNORE INTO`

### 3. Date/Time Functions
- **SQLite**: `julianday()`, `DATETIME DEFAULT CURRENT_TIMESTAMP`
- **MySQL**: `DATEDIFF()`, `NOW()`, `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`

### 4. Boolean Fields
- **SQLite**: `BOOLEAN DEFAULT NULL`
- **MySQL**: `BOOLEAN DEFAULT NULL` (compatible)

### 5. TIMESTAMP NULL Handling
- **SQLite**: `DATETIME` allows NULL implicitly
- **MySQL**: Requires explicit `TIMESTAMP NULL DEFAULT NULL`

## Created MySQL-Compatible Files

1. **001_create_initial_tables_mysql.sql** - Complete base schema
2. **002_add_consent_fields_mysql.sql** - Consent field additions
3. **004_flexible_donor_segmentation_mysql.sql** - Segmentation config table

## Recommendations for Future Deployments

### 1. Use MySQL-Compatible Migrations
Replace original SQLite migrations with MySQL versions in production environments.

### 2. Migration Strategy
- Apply missing migration 002 (consent fields)
- Skip 004-007 as views are already manually created and working
- Use consolidated approach for new deployments

### 3. Database-Specific Migration Files
Maintain separate migration sets:
- `migrations/sqlite/` - For development
- `migrations/mysql/` - For production

### 4. Enhanced Migration Runner
The current migration runner already handles database type detection and uses appropriate syntax.