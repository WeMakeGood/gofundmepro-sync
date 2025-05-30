const { getInstance: getDatabase } = require('./knex-database');
const ClassyAPIClient = require('../classy/api-client');
const logger = require('../utils/logger');

class SyncEngine {
  constructor(config = {}) {
    this.db = getDatabase();
    this.api = new ClassyAPIClient(config.classy);
    this.batchSize = process.env.SYNC_BATCH_SIZE || 100;
    this.entitySyncers = {};
    
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
    this.loadEntitySyncers();
    logger.info('Sync engine initialized');
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
        batch_size: this.batchSize
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
        batch_size: this.batchSize
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
      const query = `
        SELECT MAX(completed_at) as last_sync 
        FROM sync_jobs 
        WHERE entity_type = ? AND status = 'completed'
      `;
      
      const result = await this.db.query(query, [entityType]);
      
      if (result && result.length > 0 && result[0].last_sync) {
        return new Date(result[0].last_sync);
      }
      
      // Return a recent date for first sync (last 30 days)
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() - 30);
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
          records_processed, records_failed, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      const metadata = JSON.stringify({
        batchSize: this.batchSize,
        duration: this.syncStats.endTime - this.syncStats.startTime
      });
      
      await this.db.query(query, [
        'scheduled',
        entityType,
        'completed',
        this.syncStats.startTime,
        now,
        this.syncStats.successfulRecords,
        this.syncStats.failedRecords,
        metadata
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