# Classy Sync Architecture Documentation

## Overview

Classy Sync is a production-ready data synchronization system that maintains clean, automated data flow between Classy (GoFundMe Pro) and third-party services like MailChimp.

## Core Architecture Principles

### 1. Clean Database Design
- **Classy IDs as Primary Keys**: Uses Classy entity IDs directly as database primary keys (bigint)
- **Single Database Abstraction**: Knex.js only - no competing abstractions
- **Multi-Organization Support**: All tables include `organization_id` for tenant isolation
- **Direct Foreign Key Relationships**: Efficient joins without lookup tables

### 2. Plugin Architecture
- **Base Plugin Pattern**: `src/core/base-plugin.js` provides standardized lifecycle
- **Extension Points**: Easy to add new third-party integrations
- **Error Isolation**: Plugin failures don't affect core sync operations
- **Conservative Data Handling**: Preserves existing data and relationships

### 3. Automated Sync Orchestration
- **Dependency Management**: Ensures proper sync order (supporters → campaigns → transactions)
- **Intelligent Scheduling**: Configurable intervals for different entity types
- **Failure Recovery**: Exponential backoff with automatic retry
- **Performance Tracking**: Comprehensive metrics for optimization

## Core Components

### API Client (`src/classy/api-client.js`)
- **OAuth2 Authentication**: Automatic token refresh
- **Validated Filtering**: Server-side filtering with datetime precision
- **Unified Pagination**: Memory-efficient streaming for large datasets
- **Error Handling**: Comprehensive retry logic with circuit breaker patterns

### Entity Sync Engine (`src/core/base-entity-sync.js`)
- **Abstract Base Class**: Common patterns for all entity types
- **Incremental Sync**: Only processes changed records for efficiency
- **Batch Processing**: Handles large datasets without memory issues
- **Progress Tracking**: Detailed logging and performance metrics

### Health Monitoring (`src/core/health-monitor.js`)
- **Component Registration**: Standardized health check patterns
- **Real-time Monitoring**: Continuous system status assessment
- **Alert Management**: Proactive issue notification
- **Performance Baseline**: Historical tracking for capacity planning

### Sync Orchestrator (`src/core/sync-orchestrator.js`)
- **Automated Scheduling**: Manages all sync operations
- **Conflict Prevention**: Ensures no overlapping operations
- **Multi-Organization**: Parallel processing with credential isolation
- **Graceful Recovery**: Handles failures without data corruption

## Database Schema

### Core Tables
```sql
-- Organizations (internal management)
organizations: id (auto), classy_id (unique), name, status, credentials_encrypted

-- Main entities (Classy IDs as PKs)
supporters: id (bigint, Classy ID), organization_id, email_address, 
           lifetime_donation_amount, email_opt_in, last_sync_at

transactions: id (bigint, Classy ID), supporter_id (FK), campaign_id (FK),
             total_gross_amount, donation_net_amount, purchased_at

campaigns: id (bigint, Classy ID), organization_id, name, status,
          goal, total_raised, started_at, ended_at

recurring_plans: id (bigint, Classy ID), supporter_id (FK), 
                amount, frequency, status, next_payment_date
```

### Analytical Views
- **supporter_summary**: Complete donor profiles with segmentation
- **campaign_performance**: ROI analysis and metrics
- **donor_value_distribution**: Value tier analysis
- **donor_engagement_distribution**: Engagement status tracking

## Plugin System

### Base Plugin Lifecycle
1. **Initialize**: Validate configuration and establish connections
2. **Setup**: Plugin-specific initialization
3. **Process**: Execute core plugin logic
4. **Health Check**: Monitor plugin status
5. **Shutdown**: Clean resource cleanup

### MailChimp Integration
- **Intelligent Tagging**: Automatic donor segmentation
- **Field Mapping**: Maps supporter data to MailChimp merge fields
- **Consent Compliance**: Only syncs supporters with `email_opt_in = true`
- **Batch Processing**: Efficient bulk operations with rate limiting

## Security & Compliance

### Data Protection
- **Encrypted Credentials**: Organization credentials encrypted at rest
- **Consent Tracking**: Respects email opt-in preferences
- **Audit Trails**: Complete operation logging for compliance
- **Conservative Updates**: Never deletes existing data

### Access Control
- **Organization Isolation**: Multi-tenant with secure separation
- **Credential Management**: Per-organization encrypted storage
- **Operation Logging**: Comprehensive audit capabilities

## Performance Characteristics

### Baseline Metrics
- **Sync Rate**: 4.5 supporters/second with tagging
- **Memory Efficiency**: Streaming pagination prevents OOM
- **Success Rate**: 100% with proper error handling
- **Health Checks**: Sub-5-second response times

### Scalability Features
- **Multi-Organization**: Parallel processing
- **Plugin Extensibility**: Unlimited third-party integrations
- **Database Optimization**: Efficient queries with proper indexing
- **Connection Pooling**: Resource management for high load

## Operational Features

### Daemon Management
- **24/7 Operation**: Continuous automated sync
- **PID Management**: Prevents multiple instances
- **Graceful Shutdown**: Proper cleanup on system signals
- **Auto-Recovery**: Restarts on crashes with backoff

### CLI Interface
- **Interactive Organization Management**: User-friendly setup
- **Health Monitoring**: Real-time system diagnostics
- **Manual Sync Operations**: Override automation when needed
- **Maintenance Tools**: Database and performance management

## Extension Points

### Adding New Plugins
1. Extend `BasePlugin` class
2. Implement required lifecycle methods
3. Register with `PluginManager`
4. Add configuration validation

### Adding New Entity Types
1. Extend `BaseEntitySync` class
2. Implement entity-specific methods
3. Add database migration
4. Register with sync orchestrator

### Custom Health Checks
1. Implement health check function
2. Register with `HealthMonitor`
3. Configure alerts and thresholds
4. Add to monitoring dashboard

## Deployment Architecture

### Development
- **SQLite Database**: Local file-based storage
- **Memory Logging**: Console and file output
- **Mock Integrations**: Safe testing environment

### Production
- **MySQL/PostgreSQL**: Scalable database with replication
- **Structured Logging**: JSON output for log aggregation
- **Real Integrations**: Live MailChimp and other services
- **Health Monitoring**: Automated alerts and dashboards

This architecture ensures reliable, scalable, and maintainable data synchronization while preserving data integrity and enabling future growth.