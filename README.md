# GoFundMe Pro Data Synchronization System

A comprehensive data synchronization system that maintains a local shadow copy of donation data from GoFundMe Pro (formerly Classy) for advanced reporting, analytics, and integration with third-party services like MailChimp.

## 🌟 Features

- **Complete Data Synchronization** - Supporters, transactions, recurring plans, campaigns
- **Flexible Donor Segmentation** - Configurable tiers and behavioral analysis
- **MailChimp Integration** - Automatic sync with intelligent tagging
- **Incremental & Full Sync** - Efficient data updates with fallback options
- **Production Ready** - Robust error handling, logging, and monitoring
- **Universal Database Support** - SQLite, MySQL, PostgreSQL with seamless switching

## 🏗️ Architecture

### Core Components

- **Sync Engine** (`src/core/sync-engine.js`) - Main orchestrator for data synchronization
- **Database Layer** (`src/core/knex-database.js`) - Universal database abstraction with Knex.js
- **API Client** (`src/classy/api-client.js`) - GoFundMe Pro API wrapper
- **Entity Sync** (`src/classy/entities/`) - Specialized sync logic for each data type
- **Plugin System** (`src/plugins/`) - Extensible integrations (MailChimp, reporting)

### Data Flow

```
GoFundMe Pro API → Local Database → Analytics Views → External Integrations
                                      ↓
                              Donor Segmentation → MailChimp Tags
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ (LTS recommended)
- GoFundMe Pro API credentials
- Database: SQLite (dev), MySQL (prod), or PostgreSQL
- Redis (optional, for job queues)

### Installation

1. **Clone the repository**
   ```bash
   git clone git@github.com:WeMakeGood/gofundmepro-sync.git
   cd gofundmepro-sync
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.template .env
   # Edit .env with your API credentials and database settings
   ```

4. **Initialize database**
   ```bash
   # Complete setup (recommended for new installations)
   npm run db:setup
   
   # Or step by step
   npm run db:init    # Run migrations
   npm run db:seed    # Add initial data
   npm run db:validate # Verify setup
   ```

5. **Run initial sync**
   ```bash
   # Start with a small test
   npm run initial-sync -- --limit=100
   
   # Full sync when ready
   npm run initial-sync
   ```

## 📊 Data Synchronization

### Supported Entities

| Entity | Endpoint | Fields | Relationships |
|--------|----------|--------|---------------|
| **Supporters** | `/2.0/supporters/{id}` | Contact info, lifetime metrics, preferences | → Transactions, Recurring Plans |
| **Transactions** | `/2.0/organizations/{id}/transactions` | Amounts, fees, payment details | → Supporters, Campaigns |
| **Recurring Plans** | `/2.0/organizations/{id}/recurring-donation-plans` | Subscription status, frequency | → Supporters, Campaigns |
| **Campaigns** | `/2.0/organizations/{id}/campaigns` | Goals, performance, metadata | → Transactions, Teams |

### Sync Modes

- **Incremental** - Only sync records updated since last run (with intelligent timeout handling)
- **Full** - Complete data refresh (use sparingly)
- **Manual** - Single entity or date range sync

```bash
# Incremental sync (recommended for regular use)
# Note: Supporters sync includes automatic timeout handling for slow API responses
node scripts/manual-sync.js supporters incremental

# Full sync for specific entity
node scripts/manual-sync.js transactions full

# Date-based sync
node scripts/manual-sync.js supporters incremental --since=2024-01-01
```

### Sync Performance & Reliability

**Recent Improvements:**
- Fixed sync timestamp tracking to use actual data timestamps instead of job timestamps
- Added URL encoding for all API date filters (required by GoFundMe Pro API)
- Implemented organization-wide transaction syncing for better reliability
- Added graceful timeout handling for slow supporters API (60-second timeout)
- Client-side filtering fallback for API endpoints with filtering limitations

**Performance Notes:**
- **Transactions**: Fast, reliable syncing using organization-wide endpoints
- **Campaigns**: Uses client-side filtering due to API limitations
- **Supporters**: Includes timeout protection due to slow API responses
- **Recurring Plans**: Standard incremental sync performance

## 🎯 Donor Segmentation

### Flexible Configuration

The system provides configurable donor segmentation with separate evaluation criteria:

#### Value Tiers (Lifetime Giving)
- **Transformational** - $10K+ lifetime
- **Principal Donor** - $5K-$10K lifetime  
- **Major Donor** - $1K-$5K lifetime
- **Regular Donor** - $100-$1K lifetime
- **Small Donor** - $25-$100 lifetime
- **First-Time** - <$25 lifetime

#### Engagement Status (Recency)
- **Recent** - 0-30 days since last gift
- **Active** - 31-90 days since last gift
- **Warm** - 91-180 days since last gift
- **Cooling** - 181-365 days since last gift
- **Lapsed** - 1-2 years since last gift
- **Dormant** - 2+ years since last gift

#### Frequency Segments
- **Champion** - 26+ donations
- **Loyal** - 11-25 donations
- **Regular** - 4-10 donations
- **Repeat** - 2-3 donations
- **One-Time** - 1 donation

### Analytics Views

```sql
-- Top donor analysis
SELECT * FROM donor_value_distribution;

-- Engagement analysis  
SELECT * FROM donor_engagement_distribution;

-- Comprehensive supporter summary
SELECT * FROM supporter_summary WHERE donor_value_tier = 'Major Donor';
```

## 📧 MailChimp Integration

### Automatic Sync

The MailChimp integration automatically syncs supporter data with intelligent field mapping and tagging:

```bash
# Test with dry run
node scripts/mailchimp-full-sync.js --dry-run

# Sync top donors (testing)
node scripts/mailchimp-full-sync.js --limit=100

# Full sync
node scripts/mailchimp-full-sync.js
```

### Field Mapping

| Database Field | MailChimp Field | Description |
|----------------|-----------------|-------------|
| `first_name` | `FNAME` | First name |
| `last_name` | `LNAME` | Last name |
| `lifetime_donation_amount` | `TOTALAMT` | Lifetime giving total |
| `lifetime_donation_count` | `DONCNT` | Number of donations |
| `monthly_recurring_amount` | `RECAMT` | Monthly recurring amount |
| `active_recurring_plans > 0` | `ACTIVESUB` | "Yes"/"No" active subscription |

### Intelligent Tagging

Tags are automatically applied with the `Classy-` prefix:

- **Value**: `Classy-Major Donor`, `Classy-Regular Donor`
- **Engagement**: `Classy-Recent Donor`, `Classy-Active Donor`
- **Behavior**: `Classy-Monthly Recurring`, `Classy-$1K+ Lifetime`

## 🔧 Configuration

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `CLASSY_CLIENT_ID` | ✅ | GoFundMe Pro API client ID | - |
| `CLASSY_CLIENT_SECRET` | ✅ | GoFundMe Pro API client secret | - |
| `MAILCHIMP_API_KEY` | ⚠️ | MailChimp API key (for integration) | - |
| `MAILCHIMP_LIST_ID` | ⚠️ | Target MailChimp list ID | - |
| `DB_TYPE` | ⚠️ | Database type | `sqlite` |
| `DB_PATH` | ⚠️ | SQLite database path | `./data/classy.db` |
| `SYNC_BATCH_SIZE` | ⚠️ | Records per batch | `100` |
| `LOG_LEVEL` | ⚠️ | Logging level | `info` |

### Database Configuration

The system uses **Knex.js** for universal database compatibility. Configure your target database:

#### SQLite (Development)
```bash
DB_TYPE=sqlite
# SQLite file will be created automatically at ./data/dev_database.sqlite
```

#### MySQL (Production)
```bash
DB_TYPE=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=classy_sync
DB_USER=sync_user
DB_PASSWORD=secure_password
```

#### PostgreSQL (Alternative Production)
```bash
DB_TYPE=pg
DB_HOST=localhost
DB_PORT=5432
DB_NAME=classy_sync
DB_USER=sync_user
DB_PASSWORD=secure_password
```

### Database Management

```bash
# Check migration status
npm run db:status

# Apply pending migrations
npm run db:init

# Reset and rebuild database
npm run db:setup

# Validate schema integrity
npm run db:validate

# Test database flexibility
npm run db:test

# Fix supporter lifetime statistics (if needed)
npm run fix:supporter-stats
```

## 📈 Monitoring & Logging

### Health Check
```bash
# Check sync status
node scripts/health-check.js

# Validate supporter statistics accuracy
node scripts/recalculate-supporter-stats.js validate

# Recalculate supporter lifetime statistics (if needed)
npm run fix:supporter-stats
```

### Sync Troubleshooting

**Common Issues & Solutions:**

1. **Supporters sync timeouts** - This is expected and handled gracefully
   ```bash
   # Check logs for timeout messages (this is normal)
   tail -f logs/combined.log | grep "timeout"
   ```

2. **Missing recent transactions** - Verify sync timestamps
   ```bash
   # Check last sync times for each entity
   node scripts/manual-sync.js transactions incremental --dry-run
   ```

3. **API rate limiting** - The system automatically handles retries
   ```bash
   # Monitor API response times
   tail -f logs/combined.log | grep "API"
   ```

### Logs
- **Application logs** - `./logs/sync.log`
- **Error tracking** - Structured JSON logging
- **Performance metrics** - API response times, batch processing

### Key Metrics
- Sync job success/failure rates
- API response times and rate limits
- Database query performance
- Memory and CPU usage

## 🚀 Deployment

### Development
```bash
npm run dev
```

### Production with PM2
```bash
# Install PM2 globally
npm install -g pm2

# Start application
pm2 start ecosystem.config.js

# Monitor
pm2 status
pm2 logs
```

### Docker (Coming Soon)
```bash
docker-compose up -d
```

## 🛠️ Development

### Project Structure
```
src/
├── core/           # Core system components
│   ├── knex-database.js    # Universal database abstraction
│   ├── sync-engine.js      # Main synchronization orchestrator
│   └── scheduler.js        # Job scheduling and management
├── classy/         # GoFundMe Pro API integration
├── integrations/   # Third-party service clients
├── plugins/        # Extensible plugin system
├── utils/          # Shared utilities
└── config/         # Configuration management

scripts/            # Utility and management scripts
├── knex-init.js            # Modern database management
└── test-knex-flexibility.js # Database compatibility testing

knex_migrations/    # Universal database migrations (Knex.js)
knex_seeds/        # Database seed files
migrations/        # Legacy migrations (deprecated)
tests/             # Test suites
knexfile.js        # Database configuration
```

### Running Tests
```bash
npm test
```

### Adding New Integrations
1. Create plugin in `src/plugins/`
2. Extend `BasePlugin` class
3. Implement `initialize()` and `process()` methods
4. Add configuration to plugin loader

## 📊 Current Statistics

Based on recent sync:
- **Total Supporters**: 9,474
- **Email Coverage**: 100% (9,474 with emails)
- **Active Donors**: 8,894
- **Lifetime Value**: $5,489,571
- **Recurring Donors**: 680
- **Monthly Recurring**: $26,910

## 🔒 Security

- Environment variables for all sensitive data
- API credentials never logged or committed
- Database encryption support
- Field-level PII protection
- Audit logging for data access

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is proprietary software owned by We Make Good LLC.

## 🆘 Support

For questions or issues:
- Create GitHub issue for bugs/features
- Contact technical team for deployment support
- Review logs for troubleshooting information

---

**Built with ❤️ for impactful fundraising organizations**