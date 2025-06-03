# Classy Sync - Clean Implementation

A unified Classy (GoFundMe Pro) data synchronization system with plugin architecture for third-party integrations.

## 🎯 Project Status

**Current Status**: ✅ **Validation Complete - Ready for Implementation**
**Branch**: `clean-rebuild`  
**Validation**: All API assumptions validated against live data
**Next Phase**: Core infrastructure implementation

## 🏗️ Architecture Principles

### Clean Implementation Goals
- **Single Source of Truth**: One database abstraction, one API client, one sync pattern
- **Classy IDs as Primary Keys**: Direct use of Classy entity IDs eliminates lookup queries
- **Server-Side Filtering**: Proper API usage minimizes data transfer and eliminates timeouts
- **Plugin Architecture**: Extensible system for MailChimp, Salesforce, HubSpot integrations
- **Production Ready**: Comprehensive error handling, logging, and monitoring

### Database Design
```sql
-- Use Classy IDs directly as primary keys
supporters: id (bigint, Classy ID), organization_id, email_address, ...
transactions: id (bigint, Classy ID), supporter_id (-> supporters.id), ...
campaigns: id (bigint, Classy ID), organization_id, name, status, ...
recurring_plans: id (bigint, Classy ID), supporter_id, campaign_id, ...
```

### API Client Features
- OAuth2 authentication with automatic token refresh
- Server-side filtering using proper `filter` parameters
- Unified pagination with `per_page=100` (maximum efficiency)
- DateTime filtering with precision: `YYYY-MM-DDTHH:MM:SS+0000` format
- Smart URL encoding (let axios handle encoding automatically)

## 📁 Project Structure

```
src/
├── core/
│   ├── database.js          # Single Knex.js database abstraction
│   ├── base-entity-sync.js  # Common sync patterns
│   └── base-plugin.js       # Plugin architecture
├── classy/
│   ├── api-client.js        # Unified Classy API client
│   └── entities/            # Entity-specific sync logic
├── plugins/
│   └── mailchimp-sync.js    # MailChimp integration plugin
└── cli.js                   # Management interface

migrations/                  # Clean Knex.js migrations
tests/                      # Comprehensive test suite
```

## 🔌 Plugin System

### MailChimp Integration
- **Field Mapping**: `lifetime_donation_amount` → `TOTALAMT`, etc.
- **Smart Tagging**: `Classy-Major Donor`, `Classy-Recent Donor`, etc.
- **Batch Processing**: Efficient bulk operations with error handling
- **Dry Run Support**: Test syncs without making changes

### Future Integrations
- **Salesforce**: CRM integration with donation tracking
- **HubSpot**: Marketing automation with donor segmentation
- **Custom APIs**: Extensible plugin architecture

## 📋 Development Status

See `CLAUDE.md` for complete implementation guide.

**✅ Validation Complete**: All API assumptions validated against live data
- Authentication working perfectly
- DateTime filtering solved (full precision available)
- Field names validated (total_gross_amount, etc.)
- Rich data structure discovered (94 transaction fields)

**Next: Phase 1** - Core Infrastructure (Ready to Start)
- Package.json and dependencies
- Clean database schema with Classy IDs
- Knex.js configuration
- Unified API client with validated filtering

**Phase 2**: Entity Sync Implementation
- Base entity sync architecture  
- Entity implementations with validated field names
- Database integration

**Phase 3**: Plugin System
- Base plugin class
- MailChimp plugin (patterns preserved from validation)
- Plugin manager

**Phase 4**: CLI & Management
- Command interface
- Organization management
- Health monitoring

## 📚 Reference Documents

- **`CLAUDE.md`** - Complete implementation guide (validated)
- **`VALIDATION_FINDINGS.md`** - Live API test results and corrections
- **`DATETIME_FILTERING_SOLUTION.md`** - Complete datetime filtering solution
- **`MAILCHIMP-INTEGRATION.md`** - Working integration patterns
- **`docs/API_DOCUMENTATION_INSIGHTS.md`** - Critical API analysis
- **`data/apiv2-public.json`** - Official Classy API specification

## 🔄 Previous Work

All analysis and partial implementations from the previous approach are preserved in git history. Key learnings have been incorporated into this clean rebuild:

- ✅ Validated API filtering with live data testing
- ✅ Solved datetime filtering with precision formatting
- ✅ Confirmed field names against live API responses  
- ✅ Analyzed MailChimp integration patterns
- ✅ Documented validated database schema requirements

## 🚀 Quick Start (When Complete)

```bash
# Setup
npm install
npm run db:migrate
npm run db:seed

# Sync operations
npm run sync supporters incremental
npm run org:sync <organization-id>

# MailChimp integration
npm run mailchimp:sync -- --dry-run
```

---

**Built for impactful fundraising organizations**