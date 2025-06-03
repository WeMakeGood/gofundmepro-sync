const logger = require('../utils/logger');

/**
 * Base class for all entity synchronization with unified patterns
 */
class BaseEntitySync {
  constructor(db, apiClient) {
    this.db = db;
    this.apiClient = apiClient;
  }

  /**
   * Perform incremental sync - only sync records updated since last sync
   */
  async incrementalSync(organizationId, classyOrganizationId, options = {}) {
    const { limit, dryRun = false } = options;
    
    try {
      // Get last sync timestamp for this entity type
      const lastSync = await this.getLastSyncTimestamp(organizationId);
      const updatedSince = lastSync || new Date('2020-01-01'); // Default fallback date
      
      logger.info(`Starting incremental ${this.getEntityName()} sync`, {
        organizationId,
        classyOrganizationId,
        updatedSince,
        limit
      });

      // Fetch updated entities from API
      const entities = await this.fetchEntities(classyOrganizationId, { updatedSince, limit });
      
      if (dryRun) {
        return this.createDryRunResult(entities, 'incremental');
      }

      // Process entities
      const result = await this.processEntities(entities, organizationId);
      
      // Update sync timestamp
      await this.updateSyncTimestamp(organizationId);
      
      logger.info(`Completed incremental ${this.getEntityName()} sync`, result);
      return result;
      
    } catch (error) {
      logger.error(`Failed incremental ${this.getEntityName()} sync:`, error);
      throw error;
    }
  }

  /**
   * Perform full sync - sync all records regardless of timestamps
   */
  async fullSync(organizationId, classyOrganizationId, options = {}) {
    const { limit, dryRun = false } = options;
    
    try {
      logger.info(`Starting full ${this.getEntityName()} sync`, {
        organizationId,
        classyOrganizationId,
        limit
      });

      // Fetch all entities from API
      const entities = await this.fetchEntities(classyOrganizationId, { limit });
      
      if (dryRun) {
        return this.createDryRunResult(entities, 'full');
      }

      // Process entities
      const result = await this.processEntities(entities, organizationId);
      
      // Run post-sync tasks if needed
      await this.postSyncTasks(organizationId, options);
      
      // Update sync timestamp
      await this.updateSyncTimestamp(organizationId);
      
      logger.info(`Completed full ${this.getEntityName()} sync`, result);
      return result;
      
    } catch (error) {
      logger.error(`Failed full ${this.getEntityName()} sync:`, error);
      throw error;
    }
  }

  /**
   * Process a batch of entities and track success/failure
   */
  async processEntities(entities, organizationId) {
    const stats = {
      totalRecords: entities.length,
      successfulRecords: 0,
      failedRecords: 0,
      errors: []
    };

    for (const entity of entities) {
      try {
        await this.upsertEntity(entity, organizationId);
        stats.successfulRecords++;
      } catch (error) {
        stats.failedRecords++;
        stats.errors.push({
          entityId: entity.id,
          error: error.message
        });
        
        logger.error(`Failed to sync ${this.getEntityName()}:`, {
          entityId: entity.id,
          error: error.message
        });
      }
    }

    return stats;
  }

  /**
   * Create a dry run result without actually syncing
   */
  createDryRunResult(entities, syncType) {
    return {
      totalRecords: entities.length,
      successfulRecords: 0,
      failedRecords: 0,
      dryRun: true,
      message: `Would ${syncType} sync ${entities.length} ${this.getEntityName()} records`
    };
  }

  /**
   * Get the last sync timestamp for this entity type
   */
  async getLastSyncTimestamp(organizationId) {
    const result = await this.db.raw(`
      SELECT MAX(last_sync_at) as last_sync
      FROM ${this.getTableName()}
      WHERE organization_id = ?
    `, [organizationId]);
    
    const lastSync = result[0]?.last_sync;
    return lastSync ? new Date(lastSync) : null;
  }

  /**
   * Update the sync timestamp for processed records
   */
  async updateSyncTimestamp(organizationId) {
    const now = new Date();
    await this.db(this.getTableName())
      .where('organization_id', organizationId)
      .update({
        last_sync_at: now
      });
  }

  // Abstract methods that must be implemented by child classes

  /**
   * Fetch entities from the Classy API
   * @param {string} classyOrganizationId 
   * @param {object} options 
   * @returns {Array} entities
   */
  async fetchEntities(classyOrganizationId, options) {
    throw new Error('fetchEntities must be implemented by child class');
  }

  /**
   * Upsert a single entity to the database
   * @param {object} entity 
   * @param {number} organizationId 
   */
  async upsertEntity(entity, organizationId) {
    throw new Error('upsertEntity must be implemented by child class');
  }

  /**
   * Get the entity name for logging
   * @returns {string}
   */
  getEntityName() {
    throw new Error('getEntityName must be implemented by child class');
  }

  /**
   * Get the database table name
   * @returns {string}
   */
  getTableName() {
    throw new Error('getTableName must be implemented by child class');
  }

  /**
   * Run any post-sync tasks (optional)
   * @param {number} organizationId 
   * @param {object} options 
   */
  async postSyncTasks(organizationId, options) {
    // Optional - override if needed
  }
}

module.exports = BaseEntitySync;