# Classy Sync - Clean Implementation Guide

## Project Overview

This is a complete rebuild of the Classy (GoFundMe Pro) data synchronization system. The previous implementation had multiple contradictory approaches, stacked migrations, and architectural issues. This rebuild creates a clean, unified system with:

- **Clean Architecture**: Single database abstraction, unified API client, consistent entity sync patterns
- **Classy IDs as Primary Keys**: Direct use of Classy entity IDs eliminates lookup queries and sync order dependencies  
- **Plugin Architecture**: Extensible system for third-party integrations (MailChimp, Salesforce, HubSpot)
- **Server-Side Filtering**: Proper use of Classy API filtering to minimize data transfer
- **Comprehensive Analytics**: Donor segmentation views for advanced reporting

## Previous Analysis (Reference Only)

The following reference documents contain important insights from analyzing the old codebase:

### Key Discovery Documents:
- `MAILCHIMP-INTEGRATION.md` - Working MailChimp integration patterns to preserve
- `data/apiv2-public.json` - Official Classy API specification (CRITICAL REFERENCE)
- `docs/API_DOCUMENTATION_INSIGHTS.md` - API usage patterns and limitations discovered

### Architecture Insights:
- **Problem**: Old system used auto-increment IDs with `classy_id` fields, causing complex lookups
- **Solution**: Use Classy IDs directly as primary keys for efficient relationships
- **Problem**: Multiple database abstraction layers (custom + Knex) created conflicts  
- **Solution**: Single Knex.js-based system for universal database support
- **Problem**: Client-side filtering downloaded entire datasets then filtered locally
- **Solution**: Server-side filtering using proper API filter parameters

## 🎉 Validation Status: PASSED

**Live API validation completed successfully!** Key findings:
- ✅ Authentication working perfectly
- ✅ **DateTime filtering SOLVED**: Full precision available (`YYYY-MM-DDTHH:MM:SS+0000`)
- ✅ Field names validated against live data (`total_gross_amount`, etc.)
- ✅ Rich data available (94 transaction fields, 103 campaign fields)
- ✅ Server-side filtering confirmed with proper encoding
- ✅ All assumptions validated and corrected

See `VALIDATION_FINDINGS.md` and `DATETIME_FILTERING_SOLUTION.md` for complete analysis.

## Implementation Requirements

### 1. Database Schema (Clean Implementation)

**Core Principles:**
- Classy IDs as primary keys (bigint) for all main entities
- Direct foreign key relationships using Classy IDs
- Multi-organization support with `organization_id` in all tables
- Comprehensive analytical views for donor segmentation

**Tables:**
```sql
-- Organizations (internal management only)
organizations: id (auto), classy_id (unique), name, status, created_at, updated_at

-- Main entities (Classy IDs as primary keys)
supporters: id (bigint, Classy ID), organization_id, email_address, first_name, last_name, 
           lifetime_donation_amount, lifetime_donation_count, monthly_recurring_amount, 
           email_opt_in, created_at, updated_at, last_sync_at

campaigns: id (bigint, Classy ID), organization_id, name, status, goal, total_raised,
          type, started_at, ended_at, donors_count, created_at, updated_at, last_sync_at

transactions: id (bigint, Classy ID), organization_id, supporter_id (-> supporters.id),
             campaign_id (-> campaigns.id), recurring_plan_id, total_gross_amount, 
             donation_gross_amount, fees_amount, donation_net_amount, currency,
             raw_currency_code, raw_total_gross_amount, charged_currency_code, 
             charged_total_gross_amount, billing_city, billing_state, billing_country,
             fundraising_page_id, fundraising_team_id, status, purchased_at, 
             created_at, updated_at, last_sync_at

recurring_plans: id (bigint, Classy ID), organization_id, supporter_id, campaign_id,
                status, amount, frequency, next_payment_date, created_at, updated_at, last_sync_at
```

**Views:**
- `supporter_summary` - Complete donor profiles with segmentation
- `campaign_performance` - Campaign metrics and ROI analysis  
- `donor_value_distribution` - Value tier analysis
- `donor_engagement_distribution` - Engagement status analysis

### 2. API Client (Unified Implementation)

**File:** `src/classy/api-client.js`

**Key Features:**
```javascript
class ClassyAPIClient {
  // OAuth2 authentication with automatic token refresh
  async authenticate()
  
  // Unified pagination with server-side filtering
  async fetchAllPages(endpoint, baseParams, filter)
  
  // VALIDATED date filter building - datetime precision available
  static buildDateFilter(field, operator, date) {
    // Full datetime precision (RECOMMENDED)
    const datetimeString = date.toISOString().replace('Z', '+0000');
    return `${field}${operator}${datetimeString}`;  // Let axios handle encoding
  }
  
  // Clean entity methods with options
  async getSupporters(orgId, { updatedSince, limit })
  async getTransactions(orgId, { purchasedSince, updatedSince, limit })
  async getCampaigns(orgId, { updatedSince, limit })
  async getRecurringPlans(orgId, { updatedSince, limit })
}
```

**VALIDATED API Insights (from exhaustive testing):**
- Use `per_page=100` (maximum allowed) for efficiency
- **DateTime filters WORK**: `field>YYYY-MM-DDTHH:MM:SS+0000` format ✅ (when properly encoded)
- **Date filters WORK**: `field>YYYY-MM-DD` format ✅ (simpler, broader range)
- **Key insight**: Let axios handle URL encoding - never double-encode
- Server-side filtering with `filter` parameter prevents large downloads
- Most precise filtering: `purchased_at>2025-04-20T00:00:00+0000`

**VALIDATED Field Names (from live data analysis):**
- **Transactions**: Use `total_gross_amount` (not `gross_amount`), `donation_gross_amount`, `fees_amount`, `donation_net_amount`
- **Campaigns**: Confirmed `type` field exists ✅, plus rich data (103 fields total)
- **Multi-currency**: All fields available (`raw_currency_code`, `raw_total_gross_amount`, etc.) ✅
- **Billing data**: `billing_city`, `billing_state`, `billing_country` available for enhanced analytics
- **Relationships**: `fundraising_page_id`, `fundraising_team_id` confirmed ✅

### 3. Entity Sync Architecture (Base Class Pattern)

**File:** `src/core/base-entity-sync.js`

```javascript
class BaseEntitySync {
  async incrementalSync(orgId, classyOrgId, options)  // Only sync updated records
  async fullSync(orgId, classyOrgId, options)        // Sync all records
  async processEntities(entities, orgId)             // Batch processing with error handling
  
  // Abstract methods for child classes
  async fetchEntities(classyOrgId, options)          // API fetching
  async upsertEntity(entity, orgId)                  // Database operations
  getEntityName()                                    // For logging
  getTableName()                                     // Database table
}
```

**Entity Implementations:**
- `src/classy/entities/supporters.js` - Includes lifetime stats recalculation
- `src/classy/entities/transactions.js` - Multi-currency support with `total_gross_amount`
- `src/classy/entities/campaigns.js` - Performance metrics with validated field names
- `src/classy/entities/recurring-plans.js` - Subscription management

### 4. Plugin Architecture (Third-Party Integrations)

**File:** `src/core/base-plugin.js`

```javascript
class BasePlugin {
  async initialize()                    // Setup connections, validate config
  async process(data, options)          // Main processing logic
  async healthCheck()                   // Monitor plugin status
  async shutdown()                      // Cleanup resources
  
  // Abstract methods
  async setup()                         // Plugin-specific initialization
  async execute(data, options)          // Core plugin logic
}
```

**MailChimp Plugin:** `src/plugins/mailchimp-sync.js`
- Sync supporters to MailChimp lists
- Intelligent tagging based on donor segments (`Classy-Major Donor`, etc.)
- Field mapping: `lifetime_donation_amount` -> `TOTALAMT`, etc.
- Batch processing with error handling

### 5. Database Integration (Knex.js Only)

**File:** `src/core/database.js`

```javascript
// Single database abstraction using Knex.js
const knex = require('knex')(knexConfig);

// Universal database support (SQLite, MySQL, PostgreSQL)
// Migration management with knex migrate:latest
// Seed data management with knex seed:run
```

**Configuration:** `knexfile.js`
- Development: SQLite (`./data/dev_database.sqlite`)
- Production: MySQL/PostgreSQL with connection pooling

### 6. CLI Interface (Management Scripts)

**File:** `src/cli.js`

```bash
# Sync operations
npm run sync supporters incremental
npm run sync transactions full -- --limit=1000

# Organization management  
npm run org:add
npm run org:list
npm run org:sync <org-id>

# Plugin operations
npm run mailchimp:sync -- --dry-run
npm run mailchimp:sync -- --limit=100

# Database management
npm run db:migrate
npm run db:seed
npm run db:reset
```

## Implementation Order

### Phase 1: Core Infrastructure (VALIDATED - Ready to Start)
1. **Package.json** - Clean dependencies (Knex, axios, winston, yargs)
2. **Database Schema** - Single migration with Classy ID schema and validated field names
3. **Knex Configuration** - Universal database support
4. **Logger Setup** - Structured logging with Winston

### Phase 2: API & Sync Engine (VALIDATED Requirements)
1. **API Client** - Clean unified implementation with solved datetime filtering
2. **Base Entity Sync** - Abstract class with common patterns
3. **Entity Implementations** - Supporters, transactions, campaigns, recurring plans with correct field names
4. **Database Integration** - Single Knex-based abstraction

### Phase 3: Plugin System
1. **Base Plugin Class** - Abstract plugin architecture
2. **MailChimp Plugin** - First third-party integration
3. **Plugin Manager** - Load and coordinate plugins

### Phase 4: CLI & Management
1. **CLI Interface** - Unified command interface
2. **Organization Management** - Multi-org credential handling
3. **Health Monitoring** - Status checks and reporting

### Phase 5: Testing & Documentation
1. **Unit Tests** - Core functionality testing
2. **Integration Tests** - End-to-end sync testing  
3. **Documentation** - Usage guides and API docs

## Critical Success Factors

### 1. Classy ID Primary Keys (VALIDATED)
- **NO auto-increment IDs** for main entities (supporters, campaigns, transactions, recurring_plans)
- **Direct foreign key references** using Classy IDs (transactions.supporter_id -> supporters.id)
- **Eliminates lookup queries** and sync order dependencies

### 2. Server-Side API Filtering (VALIDATED & SOLVED)
- **Use filter parameter** for date-based incremental sync
- **DateTime precision available**: `YYYY-MM-DDTHH:MM:SS+0000` format
- **Key insight**: Let axios handle URL encoding - never double-encode
- **Fetch only needed data** instead of downloading everything

### 3. Plugin Architecture  
- **Extensible design** for future integrations (Salesforce, HubSpot)
- **Standardized interfaces** for consistent plugin development
- **Error isolation** - plugin failures don't break core sync
- **Configuration management** - per-plugin settings

### 4. Single Source of Truth
- **One database abstraction** (Knex.js only)
- **One API client implementation** with consistent patterns
- **One entity sync pattern** across all entity types
- **One configuration system** for all components

## Environment Variables

```bash
# Core Classy API credentials
CLASSY_CLIENT_ID=your_client_id
CLASSY_CLIENT_SECRET=your_client_secret

# Database configuration
DB_TYPE=sqlite|mysql|postgresql
DB_HOST=localhost (for MySQL/PostgreSQL)
DB_PORT=3306|5432
DB_NAME=classy_sync
DB_USER=username
DB_PASSWORD=password

# MailChimp integration
MAILCHIMP_API_KEY=your_api_key
MAILCHIMP_LIST_ID=your_list_id

# Logging and monitoring
LOG_LEVEL=info|debug|error
NODE_ENV=development|production
```

## Reference Files

- `data/apiv2-public.json` - Official Classy API specification (CRITICAL)
- `MAILCHIMP-INTEGRATION.md` - Working integration patterns to preserve
- Previous .md files - Analysis and learnings from old implementation

## Success Criteria

1. **Clean Architecture** - Single implementation of each component, no contradictions
2. **Efficient Sync** - Server-side filtering, proper pagination, no timeouts
3. **Extensible Plugins** - MailChimp working, ready for Salesforce/HubSpot
4. **Production Ready** - Error handling, logging, monitoring, configuration management
5. **Developer Friendly** - Clear CLI, good documentation, comprehensive tests

This implementation will be a complete replacement of the previous system with no cruft, contradictions, or legacy technical debt.