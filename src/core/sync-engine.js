const { getInstance: getDatabase } = require('./knex-database');
const ClassyAPIClient = require('../classy/api-client');
const logger = require('../utils/logger');

class SyncEngine {
  constructor(config = {}) {
    this.db = getDatabase();
    this.batchSize = process.env.SYNC_BATCH_SIZE || 100;
    this.entitySyncers = {};
    this.organizationId = config.organizationId || process.env.SYNC_ORGANIZATION_ID || null;
    
    // API client will be initialized in initialize() method with organization-specific credentials
    this.api = null;
    
    this.syncStats = {
      totalRecords: 0,
      successfulRecords: 0,
      failedRecords: 0,
      startTime: null,
      endTime: null
    };
  }

  async initialize() {
    await this.db.connect();
    
    // Initialize organization-specific API client
    if (this.organizationId) {
      this.api = await ClassyAPIClient.createFromDatabase(this.organizationId, this.db);
      
      // Get the organization details to find the Classy organization ID
      const org = await this.db.client('organizations')
        .where({ id: this.organizationId })
        .first();
      
      if (!org) {
        throw new Error(`Organization ${this.organizationId} not found`);
      }
      
      this.classyOrganizationId = org.classy_id;
      
      logger.info('Sync engine initialized with organization-specific API client', { 
        organizationId: this.organizationId,
        classyOrganizationId: this.classyOrganizationId
      });
    } else {
      // Fallback to environment credentials (for backward compatibility)
      this.api = new ClassyAPIClient();
      this.classyOrganizationId = process.env.CLASSY_ORGANIZATION_ID;
      logger.warn('Sync engine initialized without organization ID - using environment credentials');
    }
    
    this.loadEntitySyncers();
  }

  loadEntitySyncers() {
    // Dynamically load entity syncers
    try {
      this.entitySyncers = {
        supporters: require('../classy/entities/supporters'),
        transactions: require('../classy/entities/transactions'),
        recurring_plans: require('../classy/entities/recurring'),
        campaigns: require('../classy/entities/campaigns')
      };
    } catch (error) {
      logger.warn('Some entity syncers not yet implemented:', error.message);
      this.entitySyncers = {};
    }
  }

  async syncAll(params = {}) {
    const syncType = params.syncType || 'incremental';
    logger.info(`Starting ${syncType} sync for all entities`, { organizationId: this.organizationId });
    
    const entityTypes = ['campaigns', 'supporters', 'transactions', 'recurring_plans'];
    const results = {};
    
    for (const entityType of entityTypes) {
      try {
        logger.info(`Starting ${syncType} sync for ${entityType}`);
        
        if (syncType === 'full') {
          results[entityType] = await this.runFullSync(entityType, params);
        } else {
          results[entityType] = await this.runIncrementalSync(entityType, params);
        }
        
        logger.info(`Completed ${syncType} sync for ${entityType}`, { stats: results[entityType] });
      } catch (error) {
        logger.error(`Failed to sync ${entityType}:`, error);
        results[entityType] = { error: error.message };
      }
    }
    
    return results;
  }

  async runIncrementalSync(entityType, params = {}) {
    this.resetStats();
    this.syncStats.startTime = new Date();
    
    logger.syncEvent('incremental_sync_started', { entityType, params });

    try {
      const syncer = this.entitySyncers[entityType];
      if (!syncer) {
        throw new Error(`No syncer found for entity type: ${entityType}`);
      }

      // Get last sync timestamp for incremental sync
      const lastSyncTime = await this.getLastSyncTime(entityType);
      const syncParams = {
        ...params,
        updated_since: lastSyncTime,
        batch_size: this.batchSize,
        organization_id: this.organizationId,
        classy_organization_id: this.classyOrganizationId
      };

      const result = await syncer.incrementalSync(this.api, this.db, syncParams);
      
      this.syncStats.totalRecords = result.totalRecords || 0;
      this.syncStats.successfulRecords = result.successfulRecords || 0;
      this.syncStats.failedRecords = result.failedRecords || 0;
      
      // Update sync timestamp
      await this.updateSyncTimestamp(entityType);
      
      this.syncStats.endTime = new Date();
      
      logger.syncEvent('incremental_sync_completed', {
        entityType,
        stats: this.syncStats,
        duration: this.syncStats.endTime - this.syncStats.startTime
      });

      return this.syncStats;
    } catch (error) {
      this.syncStats.endTime = new Date();
      
      logger.error('Incremental sync failed:', {
        entityType,
        error: error.message,
        stats: this.syncStats
      });
      
      throw error;
    }
  }

  async runFullSync(entityType, params = {}) {
    this.resetStats();
    this.syncStats.startTime = new Date();
    
    logger.syncEvent('full_sync_started', { entityType, params });

    try {
      const syncer = this.entitySyncers[entityType];
      if (!syncer) {
        throw new Error(`No syncer found for entity type: ${entityType}`);
      }

      const syncParams = {
        ...params,
        batch_size: this.batchSize,
        organization_id: this.organizationId,
        classy_organization_id: this.classyOrganizationId
      };

      const result = await syncer.fullSync(this.api, this.db, syncParams);
      
      this.syncStats.totalRecords = result.totalRecords || 0;
      this.syncStats.successfulRecords = result.successfulRecords || 0;
      this.syncStats.failedRecords = result.failedRecords || 0;
      
      // Update sync timestamp
      await this.updateSyncTimestamp(entityType);
      
      this.syncStats.endTime = new Date();
      
      logger.syncEvent('full_sync_completed', {
        entityType,
        stats: this.syncStats,
        duration: this.syncStats.endTime - this.syncStats.startTime
      });

      return this.syncStats;
    } catch (error) {
      this.syncStats.endTime = new Date();
      
      logger.error('Full sync failed:', {
        entityType,
        error: error.message,
        stats: this.syncStats
      });
      
      throw error;
    }
  }

  async syncSingleEntity(entityType, entityId) {
    logger.syncEvent('single_entity_sync_started', { entityType, entityId });

    try {
      const syncer = this.entitySyncers[entityType];
      if (!syncer) {
        throw new Error(`No syncer found for entity type: ${entityType}`);
      }

      const result = await syncer.syncSingle(this.api, this.db, entityId);
      
      logger.syncEvent('single_entity_sync_completed', {
        entityType,
        entityId,
        result
      });

      return result;
    } catch (error) {
      logger.error('Single entity sync failed:', {
        entityType,
        entityId,
        error: error.message
      });
      
      throw error;
    }
  }

  async getLastSyncTime(entityType) {
    try {
      // Use the actual last_sync_at timestamp from the target table (more reliable)
      // rather than sync job completion time (less reliable)
      const tableName = entityType;
      const query = `
        SELECT MAX(last_sync_at) as last_sync 
        FROM ${tableName}
        WHERE last_sync_at IS NOT NULL
      `;
      
      const result = await this.db.query(query);
      
      if (result && result.length > 0 && result[0].last_sync) {
        logger.info(`Using actual data timestamp for ${entityType} incremental sync`, {
          lastSyncTime: result[0].last_sync
        });
        return new Date(result[0].last_sync);
      }
      
      // Fallback to sync_jobs table if no data timestamps available
      const fallbackQuery = `
        SELECT MAX(completed_at) as last_sync 
        FROM sync_jobs 
        WHERE entity_type = ? AND status = 'completed'
      `;
      
      const fallbackResult = await this.db.query(fallbackQuery, [entityType]);
      
      if (fallbackResult && fallbackResult.length > 0 && fallbackResult[0].last_sync) {
        logger.warn(`Using sync job timestamp as fallback for ${entityType}`, {
          lastSyncTime: fallbackResult[0].last_sync
        });
        return new Date(fallbackResult[0].last_sync);
      }
      
      // Return a recent date for first sync (last 30 days)
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() - 30);
      logger.info(`Using default 30-day lookback for ${entityType} first sync`);
      return defaultDate;
    } catch (error) {
      logger.warn('Failed to get last sync time:', error);
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() - 30);
      return defaultDate;
    }
  }

  async updateSyncTimestamp(entityType) {
    const now = new Date();
    
    try {
      const query = `
        INSERT INTO sync_jobs (
          job_type, entity_type, status, started_at, completed_at,
          records_processed, records_failed, metadata, organization_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const metadata = JSON.stringify({
        batchSize: this.batchSize,
        duration: this.syncStats.endTime - this.syncStats.startTime,
        organizationId: this.organizationId
      });
      
      await this.db.query(query, [
        'scheduled',
        entityType,
        'completed',
        this.syncStats.startTime,
        now,
        this.syncStats.successfulRecords,
        this.syncStats.failedRecords,
        metadata,
        this.organizationId
      ]);
    } catch (error) {
      logger.warn('Failed to update sync timestamp:', error);
    }
  }

  resetStats() {
    this.syncStats = {
      totalRecords: 0,
      successfulRecords: 0,
      failedRecords: 0,
      startTime: null,
      endTime: null
    };
  }

  async healthCheck() {
    const checks = {
      database: await this.db.healthCheck(),
      api: await this.api.healthCheck()
    };
    
    const healthy = Object.values(checks).every(check => check.status === 'ok');
    
    return {
      status: healthy ? 'ok' : 'error',
      checks,
      timestamp: new Date().toISOString()
    };
  }

  async shutdown() {
    logger.info('Shutting down sync engine...');
    await this.db.close();
    logger.info('Sync engine shutdown complete');
  }
}

module.exports = SyncEngine;