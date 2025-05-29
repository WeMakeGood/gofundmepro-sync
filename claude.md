# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Classy/GoFundMe Pro Data Synchronization System

## Project Overview

This project creates a read-only data synchronization system that maintains a local shadow copy of donation data from Classy (now GoFundMe Pro). The system treats Classy as the canonical data source and focuses on comprehensive data extraction for reporting, analytics, and integration with third-party services like MailChimp.

## Core Requirements

### Technology Stack
- **Runtime**: Node.js (latest LTS version)
- **Language**: JavaScript (ES6+) - no TypeScript to avoid complexity
- **Database**: 
  - SQLite for development/small deployments
  - MySQL for production environments
- **Queue Management**: Redis with BullMQ for job processing
- **Process Management**: PM2 for daemon deployment
- **HTTP Client**: Axios for API requests with built-in retry logic

### Architecture Principles
- **Read-only synchronization** - Classy remains the single source of truth
- **Modular plugin system** for extensibility
- **Comprehensive data collection** for complete transaction history
- **Incremental sync** with full sync fallback
- **Robust error handling** with automatic recovery

## Data Collection Scope

### Primary Entities to Synchronize

1. **Supporters** (`/2.0/supporters/{id}`)
   - Contact information (name, email, phone, address)
   - Lifetime giving metrics
   - Custom fields and tags
   - Communication preferences
   - First/last donation dates

2. **Transactions** (`/2.0/campaigns/{id}/transactions`)
   - One-time donations
   - Recurring donation payments
   - Payment method details (tokenized)
   - Fee breakdowns
   - Refund status
   - Custom questions/responses

3. **Recurring Donation Plans** (`/2.0/campaigns/{id}/recurring-donation-plans`)
   - Subscription status (active, paused, cancelled)
   - Frequency and amount
   - Next payment date
   - Payment history
   - Lifetime value
   - Cancellation reasons

4. **Campaigns** (`/2.0/campaigns/{id}`)
   - Campaign details and goals
   - Performance metrics
   - Custom fields
   - Team fundraising relationships

5. **Organizations** (`/2.0/organizations/{id}`)
   - Organization settings
   - Global custom fields
   - Fee structures

6. **Fundraising Teams** (`/2.0/campaigns/{id}/fundraising-teams`)
   - Team hierarchies
   - Team member relationships
   - Collective goals and progress

7. **Fundraising Pages** (`/2.0/campaigns/{id}/fundraising-pages`)
   - Individual fundraiser pages
   - Personal goals
   - Supporter relationships

## Database Schema Design

### Core Tables

```sql
-- Supporters (Donors)
CREATE TABLE supporters (
    id INTEGER PRIMARY KEY,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    email_address VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    postal_code VARCHAR(20),
    country VARCHAR(2),
    lifetime_donation_amount DECIMAL(10,2),
    lifetime_donation_count INTEGER,
    first_donation_date DATETIME,
    last_donation_date DATETIME,
    custom_fields JSON,
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    sync_status VARCHAR(50),
    INDEX idx_email (email_address),
    INDEX idx_classy_id (classy_id),
    INDEX idx_sync_status (sync_status, last_sync_at)
);

-- Transactions
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    supporter_id INTEGER,
    campaign_id INTEGER,
    recurring_plan_id INTEGER,
    transaction_type VARCHAR(50), -- donation, refund, adjustment
    status VARCHAR(50),
    payment_method VARCHAR(50),
    gross_amount DECIMAL(10,2),
    fee_amount DECIMAL(10,2),
    net_amount DECIMAL(10,2),
    currency VARCHAR(3),
    purchased_at DATETIME,
    refunded_at DATETIME,
    custom_fields JSON,
    question_responses JSON,
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    FOREIGN KEY (supporter_id) REFERENCES supporters(id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY (recurring_plan_id) REFERENCES recurring_plans(id),
    INDEX idx_classy_id (classy_id),
    INDEX idx_supporter (supporter_id),
    INDEX idx_campaign (campaign_id),
    INDEX idx_purchased_at (purchased_at)
);

-- Recurring Donation Plans
CREATE TABLE recurring_plans (
    id INTEGER PRIMARY KEY,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    supporter_id INTEGER,
    campaign_id INTEGER,
    status VARCHAR(50), -- active, paused, cancelled
    frequency VARCHAR(50), -- monthly, quarterly, annually
    amount DECIMAL(10,2),
    currency VARCHAR(3),
    next_payment_date DATE,
    cancellation_date DATETIME,
    cancellation_reason TEXT,
    lifetime_value DECIMAL(10,2),
    payment_count INTEGER,
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    FOREIGN KEY (supporter_id) REFERENCES supporters(id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    INDEX idx_classy_id (classy_id),
    INDEX idx_status (status),
    INDEX idx_next_payment (next_payment_date)
);

-- Campaigns
CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    organization_id INTEGER,
    name VARCHAR(255),
    status VARCHAR(50),
    goal DECIMAL(10,2),
    total_raised DECIMAL(10,2),
    donor_count INTEGER,
    campaign_type VARCHAR(50),
    start_date DATETIME,
    end_date DATETIME,
    custom_fields JSON,
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    INDEX idx_classy_id (classy_id),
    INDEX idx_status (status)
);

-- Sync Status Tracking
CREATE TABLE sync_jobs (
    id INTEGER PRIMARY KEY,
    job_type VARCHAR(50),
    entity_type VARCHAR(50),
    status VARCHAR(50),
    started_at DATETIME,
    completed_at DATETIME,
    records_processed INTEGER,
    records_failed INTEGER,
    error_message TEXT,
    metadata JSON,
    INDEX idx_status (status, started_at)
);
```

## API Integration Details

### Authentication Flow
```javascript
class ClassyAuth {
    constructor(clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.baseURL = 'https://api.classy.org';
        this.token = null;
        this.tokenExpiry = null;
    }

    async getToken() {
        if (this.token && this.tokenExpiry > Date.now()) {
            return this.token;
        }
        
        const response = await axios.post(`${this.baseURL}/oauth2/auth`, {
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret
        });
        
        this.token = response.data.access_token;
        this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // Refresh 1 min early
        return this.token;
    }
}
```

### Pagination Handler
```javascript
class ClassyPaginator {
    async *fetchAllPages(endpoint, params = {}) {
        let nextUrl = endpoint;
        
        while (nextUrl) {
            const response = await this.makeRequest(nextUrl, params);
            yield response.data;
            
            nextUrl = response.next_page_url;
            params = {}; // Clear params after first request
        }
    }
    
    async fetchAll(endpoint, params = {}) {
        const results = [];
        for await (const page of this.fetchAllPages(endpoint, params)) {
            results.push(...page.data);
        }
        return results;
    }
}
```

## Synchronization Strategy

### Incremental Sync Logic
1. **Transaction Sync**
   - Query transactions with `updated_at > last_sync_timestamp`
   - Process in batches of 100 records
   - Update supporter records based on transaction data
   - Maintain transaction-supporter relationships

2. **Recurring Plan Sync**
   - Fetch all active and recently modified plans
   - Update lifetime values and payment schedules
   - Flag plans approaching expiration for follow-up

3. **Supporter Enrichment**
   - After transaction sync, fetch full supporter profiles
   - Only fetch if supporter data is older than 24 hours
   - Merge custom fields and communication preferences

### Full Sync Schedule
- **Daily**: New transactions and recurring plan updates
- **Weekly**: Full supporter profile refresh
- **Monthly**: Campaign and organization metadata
- **On-demand**: Manual trigger for specific entities

## Module Architecture

### Directory Structure
```
project-root/
├── src/
│   ├── core/
│   │   ├── database.js          # Database connection management
│   │   ├── sync-engine.js       # Main synchronization orchestrator
│   │   ├── scheduler.js         # Cron job management
│   │   └── plugin-loader.js     # Dynamic plugin loading
│   ├── classy/
│   │   ├── api-client.js        # Classy API wrapper
│   │   ├── auth.js              # OAuth token management
│   │   ├── entities/
│   │   │   ├── supporters.js    # Supporter sync logic
│   │   │   ├── transactions.js  # Transaction sync logic
│   │   │   ├── recurring.js     # Recurring plan sync
│   │   │   └── campaigns.js     # Campaign sync logic
│   │   └── mappers/             # Data transformation
│   ├── plugins/
│   │   ├── base-plugin.js       # Abstract plugin class
│   │   ├── mailchimp/           # MailChimp integration
│   │   └── reporting/           # Custom reporting module
│   ├── utils/
│   │   ├── logger.js            # Structured logging
│   │   ├── retry.js             # Retry logic utilities
│   │   └── encryption.js        # Field-level encryption
│   └── config/
│       ├── database.js          # Database configurations
│       └── plugins.js           # Plugin configurations
├── migrations/                  # Database migrations
├── tests/                       # Test suites
├── scripts/                     # Utility scripts
│   ├── init-db.js              # Database initialization
│   └── manual-sync.js          # Manual sync trigger
└── daemon.js                   # Main daemon entry point
```

### Plugin System
```javascript
class BasePlugin {
    constructor(config, dependencies) {
        this.config = config;
        this.db = dependencies.db;
        this.logger = dependencies.logger;
        this.queue = dependencies.queue;
    }
    
    async initialize() {
        throw new Error('Plugin must implement initialize()');
    }
    
    async process(data) {
        throw new Error('Plugin must implement process()');
    }
    
    async shutdown() {
        // Optional cleanup
    }
}

// Example: MailChimp Plugin
class MailChimpPlugin extends BasePlugin {
    async initialize() {
        this.mailchimp = new MailChimpAPI(this.config.apiKey);
    }
    
    async process(data) {
        if (data.type === 'supporter.updated') {
            await this.syncSupporter(data.supporter);
        }
    }
    
    async syncSupporter(supporter) {
        const listId = this.config.listId;
        const mergeFields = {
            FNAME: supporter.first_name,
            LNAME: supporter.last_name,
            LIFETIME: supporter.lifetime_donation_amount,
            LASTGIFT: supporter.last_donation_date
        };
        
        await this.mailchimp.updateMember(listId, supporter.email_address, {
            merge_fields: mergeFields,
            tags: this.generateTags(supporter)
        });
    }
}
```

## Error Handling and Recovery

### Retry Strategy
```javascript
const retryConfig = {
    retries: 3,
    retryDelay: (retryCount) => retryCount * 1000, // Exponential backoff
    retryCondition: (error) => {
        // Retry on network errors and 5xx responses
        return !error.response || error.response.status >= 500;
    },
    onRetry: (retryCount, error) => {
        logger.warn(`Retry attempt ${retryCount}`, {
            error: error.message,
            url: error.config?.url
        });
    }
};
```

### Circuit Breaker Pattern
- Track consecutive failures per endpoint
- Open circuit after 5 consecutive failures
- Half-open state after 5 minutes
- Full reset after successful request

## Deployment Configuration

### PM2 Ecosystem File
```javascript
module.exports = {
    apps: [{
        name: 'classy-sync',
        script: './daemon.js',
        instances: 1, // Single instance for SQLite
        exec_mode: 'fork',
        env: {
            NODE_ENV: 'production',
            DB_TYPE: 'sqlite',
            DB_PATH: './data/classy.db'
        },
        error_file: './logs/error.log',
        out_file: './logs/out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        max_memory_restart: '1G',
        cron_restart: '0 0 * * *', // Daily restart
        autorestart: true,
        watch: false
    }]
};
```

### Environment Variables
```bash
# Classy API
CLASSY_CLIENT_ID=your_client_id
CLASSY_CLIENT_SECRET=your_client_secret
CLASSY_API_BASE_URL=https://api.classy.org

# Database
DB_TYPE=sqlite # or mysql
DB_PATH=./data/classy.db # for sqlite
DB_HOST=localhost # for mysql
DB_PORT=3306
DB_NAME=classy_sync
DB_USER=sync_user
DB_PASSWORD=secure_password

# Redis Queue
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional_password

# Sync Settings
SYNC_BATCH_SIZE=100
SYNC_INTERVAL_MINUTES=15
FULL_SYNC_HOUR=2 # 2 AM daily

# Plugins
MAILCHIMP_API_KEY=your_mailchimp_key
MAILCHIMP_LIST_ID=your_list_id
```

## Testing Strategy

### Test Categories
1. **Unit Tests**: Individual sync functions and data mappers
2. **Integration Tests**: API client with mock responses
3. **End-to-End Tests**: Full sync cycle with test database
4. **Load Tests**: Performance under high data volume

### Mock Data Generator
```javascript
class ClassyMockData {
    generateSupporter(overrides = {}) {
        return {
            id: faker.random.uuid(),
            first_name: faker.name.firstName(),
            last_name: faker.name.lastName(),
            email_address: faker.internet.email(),
            lifetime_donation_amount: faker.finance.amount(10, 10000),
            created_at: faker.date.past(),
            ...overrides
        };
    }
    
    generateTransaction(supporterId, overrides = {}) {
        const amount = faker.finance.amount(10, 1000);
        return {
            id: faker.random.uuid(),
            supporter_id: supporterId,
            gross_amount: amount,
            fee_amount: amount * 0.029 + 0.30,
            net_amount: amount - (amount * 0.029 + 0.30),
            purchased_at: faker.date.recent(),
            ...overrides
        };
    }
}
```

## Monitoring and Alerting

### Key Metrics
- Sync job success/failure rates
- API response times and rate limit usage
- Queue depth and processing latency
- Database query performance
- Memory and CPU usage

### Health Check Endpoint
```javascript
app.get('/health', async (req, res) => {
    const checks = {
        database: await checkDatabase(),
        redis: await checkRedis(),
        classy_api: await checkClassyAPI(),
        last_sync: await getLastSyncTime()
    };
    
    const healthy = Object.values(checks).every(check => check.status === 'ok');
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'unhealthy',
        checks
    });
});
```

## Data Privacy and Security

### Field-Level Encryption
- Encrypt PII fields (SSN, full address) at rest
- Use AES-256-GCM encryption
- Rotate encryption keys quarterly
- Maintain audit log of all data access

### Access Controls
- Read-only database user for reporting
- Separate credentials per environment
- API keys stored in environment variables
- No sensitive data in logs

## Future Enhancements

1. **GraphQL API** for flexible data queries
2. **Real-time webhooks** when Classy adds support
3. **Machine learning** for donor segmentation
4. **Automated reconciliation** with accounting systems
5. **Multi-tenant support** for multiple organizations

This architecture provides a robust, maintainable system for synchronizing Classy data while remaining flexible enough to accommodate future requirements and integrations.