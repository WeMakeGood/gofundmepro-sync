/**
 * Base Entity Sync Class
 * 
 * Abstract base class for all entity sync implementations
 * Provides common patterns for incremental/full sync, error handling, and progress tracking
 */

const { getKnex } = require('../config/database');
const { ClassyAPIClient } = require('../classy/api-client');
const { organizationManager } = require('../services/organization-manager');
const { createLogger } = require('../utils/logger');

class BaseEntitySync {
  constructor(entityName) {
    this.entityName = entityName;
    this.logger = createLogger(`sync:${entityName}`);
    this.apiClient = new ClassyAPIClient();
  }

  /**
   * Get database instance
   * @returns {Object} Knex instance
   */
  getDb() {
    return getKnex();
  }

  /**
   * Get table name for this entity (to be implemented by subclasses)
   * @returns {string} Database table name
   */
  getTableName() {
    throw new Error('getTableName() must be implemented by subclass');
  }

  /**
   * Get entity name for logging
   * @returns {string} Entity name
   */
  getEntityName() {
    return this.entityName;
  }

  /**
   * Fetch entities from Classy API (to be implemented by subclasses)
   * @param {number} classyOrgId - Classy organization ID
   * @param {Object} options - Sync options
   * @returns {Promise<Array>} Array of entity records
   */
  async fetchEntities(classyOrgId, options) {
    throw new Error('fetchEntities() must be implemented by subclass');
  }

  /**
   * Upsert entity into database (to be implemented by subclasses)
   * @param {Object} entity - Entity data from API
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Object>} Database operation result
   */
  async upsertEntity(entity, organizationId) {
    throw new Error('upsertEntity() must be implemented by subclass');
  }

  /**
   * Get last sync timestamp for incremental sync
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Date|null>} Last sync timestamp or null
   */
  async getLastSyncTime(organizationId) {
    try {
      const result = await this.getDb()(this.getTableName())
        .where('organization_id', organizationId)
        .max('last_sync_at as last_sync')
        .first();
        
      const lastSync = result?.last_sync;
      return lastSync ? new Date(lastSync) : null;
      
    } catch (error) {
      this.logger.warn('Failed to get last sync time', { organizationId, error: error.message });
      return null;
    }
  }

  /**
   * Update sync timestamp for processed entities
   * @param {Array} entityIds - Array of entity IDs that were processed
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<number>} Number of updated records
   */
  async updateSyncTimestamps(entityIds, organizationId) {
    if (entityIds.length === 0) return 0;

    try {
      const now = new Date();
      const updated = await this.getDb()(this.getTableName())
        .whereIn('id', entityIds)
        .andWhere('organization_id', organizationId)
        .update({ 
          last_sync_at: now
          // NOTE: updated_at should preserve Classy API timestamp, not sync time
        });
        
      this.logger.debug('Updated sync timestamps', { 
        organizationId, 
        entityCount: entityIds.length, 
        updatedCount: updated 
      });
      
      return updated;
      
    } catch (error) {
      this.logger.error('Failed to update sync timestamps', { 
        organizationId, 
        entityIds, 
        error: error.message 
      });
      return 0;
    }
  }

  /**
   * Perform incremental sync (only updated records since last sync)
   * @param {number} orgId - Internal organization ID
   * @param {number} classyOrgId - Classy organization ID
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} Sync results
   */
  async incrementalSync(orgId, classyOrgId, options = {}) {
    const startTime = Date.now();
    const entityName = this.getEntityName();
    
    this.logger.info(`Starting incremental ${entityName} sync`, { 
      organizationId: orgId, 
      classyOrgId 
    });

    try {
      // Get last sync time
      const lastSyncTime = await this.getLastSyncTime(orgId);
      
      if (!lastSyncTime) {
        this.logger.info(`No previous sync found, performing full sync instead`);
        return await this.fullSync(orgId, classyOrgId, options);
      }

      this.logger.info(`Syncing ${entityName} updated since`, { 
        lastSyncTime: lastSyncTime.toISOString() 
      });

      // Set up API client with credentials
      const credentials = await organizationManager.getClassyCredentials(orgId);
      this.apiClient.setCredentials(credentials);

      // Use streaming sync for incremental sync too
      const syncOptions = {
        ...options,
        updatedSince: lastSyncTime
      };
      
      const results = await this.streamingSync(orgId, classyOrgId, syncOptions);
      
      if (results.totalProcessed === 0) {
        this.logger.info(`No updated ${entityName} found`);
      }
      
      const duration = Date.now() - startTime;
      this.logger.performance(`${entityName}-incremental-sync`, duration, {
        organizationId: orgId,
        totalProcessed: results.totalProcessed,
        successful: results.successful,
        errors: results.errors
      });

      return {
        type: 'incremental',
        lastSyncTime,
        ...results,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Incremental ${entityName} sync failed`, {
        organizationId: orgId,
        error: error.message,
        duration
      });
      throw error;
    }
  }

  /**
   * Perform full sync (all records) with streaming pagination
   * @param {number} orgId - Internal organization ID  
   * @param {number} classyOrgId - Classy organization ID
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} Sync results
   */
  async fullSync(orgId, classyOrgId, options = {}) {
    const startTime = Date.now();
    const entityName = this.getEntityName();
    
    this.logger.info(`Starting full ${entityName} sync with streaming pagination`, { 
      organizationId: orgId, 
      classyOrgId 
    });

    try {
      // Set up API client with credentials
      const credentials = await organizationManager.getClassyCredentials(orgId);
      this.apiClient.setCredentials(credentials);

      // Use streaming pagination instead of loading all pages
      const results = await this.streamingSync(orgId, classyOrgId, options);
      
      const duration = Date.now() - startTime;
      this.logger.performance(`${entityName}-full-sync`, duration, {
        organizationId: orgId,
        totalProcessed: results.totalProcessed,
        successful: results.successful,
        errors: results.errors
      });

      return {
        type: 'full',
        ...results,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Full ${entityName} sync failed`, {
        organizationId: orgId,
        error: error.message,
        duration
      });
      throw error;
    }
  }

  /**
   * Streaming sync - process one page at a time instead of loading all into memory
   * @param {number} orgId - Internal organization ID
   * @param {number} classyOrgId - Classy organization ID
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} Processing results
   */
  async streamingSync(orgId, classyOrgId, options = {}) {
    const entityName = this.getEntityName();
    const { limit = 50000 } = options; // Overall record limit
    
    let totalProcessed = 0;
    let successful = 0;
    let skipped = 0;
    let errors = 0;
    const processedIds = [];
    
    let page = 1;
    let hasMore = true;
    let recordsFetched = 0;

    this.logger.info(`Starting streaming sync for ${entityName}`, {
      organizationId: orgId,
      maxRecords: limit
    });

    try {
      while (hasMore && recordsFetched < limit) {
        // Fetch single page
        const pageResult = await this.fetchSinglePage(classyOrgId, page, options);
        
        if (!pageResult.data || pageResult.data.length === 0) {
          this.logger.info(`No more ${entityName} data on page ${page}`);
          break;
        }

        const pageEntities = pageResult.data;
        recordsFetched += pageEntities.length;
        
        this.logger.info(`Processing page ${page}/${pageResult.totalPages || '?'}`, {
          pageRecords: pageEntities.length,
          totalFetched: recordsFetched,
          totalRecords: pageResult.total || 'unknown'
        });

        // Process this page immediately
        const pageResults = await this.processEntities(pageEntities, orgId);
        
        // Accumulate results
        totalProcessed += pageResults.totalProcessed;
        successful += pageResults.successful;
        skipped += pageResults.skipped;
        errors += pageResults.errors;
        processedIds.push(...pageResults.processedIds);

        // Progress update every 10 pages or major milestones
        if (page % 10 === 0 || successful % 1000 === 0) {
          this.logger.info(`Streaming sync progress for ${entityName}`, {
            page,
            totalProcessed,
            successful,
            errors,
            skipped,
            successRate: totalProcessed > 0 ? (successful / totalProcessed * 100).toFixed(1) + '%' : '0%'
          });
        }

        // Check if there are more pages
        hasMore = page < (pageResult.totalPages || 0);
        page++;

        // Rate limiting between pages
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Final summary
      this.logger.info(`Streaming sync completed for ${entityName}`, {
        organizationId: orgId,
        pagesProcessed: page - 1,
        totalProcessed,
        successful,
        skipped,
        errors,
        successRate: totalProcessed > 0 ? (successful / totalProcessed * 100).toFixed(1) + '%' : '0%'
      });

      return {
        totalProcessed,
        successful,
        skipped,
        errors,
        processedIds,
        pagesProcessed: page - 1
      };

    } catch (error) {
      this.logger.error(`Streaming sync failed for ${entityName}`, {
        organizationId: orgId,
        page,
        totalProcessed,
        successful,
        errors,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Fetch a single page from the API
   * @param {number} classyOrgId - Classy organization ID
   * @param {number} page - Page number to fetch
   * @param {Object} options - API options
   * @returns {Promise<Object>} Page result with data and metadata
   */
  async fetchSinglePage(classyOrgId, page, options) {
    throw new Error('fetchSinglePage() must be implemented by subclass');
  }

  /**
   * Process entities with batch operations and error handling
   * @param {Array} entities - Array of entity records from API
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Object>} Processing results
   */
  async processEntities(entities, organizationId) {
    const entityName = this.getEntityName();
    const batchSize = 50; // Process in batches for better memory usage
    let totalProcessed = 0;
    let successful = 0;
    let skipped = 0;
    let errors = 0;
    const processedIds = [];

    this.logger.info(`Processing ${entities.length} ${entityName} in batches of ${batchSize}`);

    // Process entities in batches
    for (let i = 0; i < entities.length; i += batchSize) {
      const batch = entities.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(entities.length / batchSize);

      this.logger.debug(`Processing batch ${batchNumber}/${totalBatches}`, {
        batchSize: batch.length,
        organizationId
      });

      // Process each entity in the batch
      for (const entity of batch) {
        try {
          const result = await this.upsertEntity(entity, organizationId);
          
          // Handle skipped records
          if (result && result.skipped) {
            skipped++;
            // Only log first few skipped records to avoid spam
            if (skipped <= 5) {
              this.logger.debug(`${entityName} skipped`, {
                entityId: entity.id,
                organizationId,
                reason: result.reason
              });
            } else if (skipped === 6) {
              this.logger.debug(`... and ${entities.length - i - 5} more ${entityName} records skipped (foreign key not found)`);
            }
          } else {
            successful++;
            processedIds.push(entity.id);
            
            // Only log database operations in debug mode
            this.logger.debug('Entity upserted successfully', {
              entityName,
              entityId: entity.id,
              organizationId
            });
          }
          
        } catch (error) {
          errors++;
          // Only log first few errors to avoid spam
          if (errors <= 5) {
            this.logger.error(`Failed to upsert ${entityName}`, {
              entityId: entity.id,
              organizationId,
              error: error.message
            });
          } else if (errors === 6) {
            this.logger.error(`... and more ${entityName} upsert errors (details in debug log)`);
          }
          
          // Always log to debug for troubleshooting
          this.logger.debug(`Failed to upsert ${entityName}`, {
            entityId: entity.id,
            organizationId,
            error: error.message,
            stack: error.stack
          });
        }
        
        totalProcessed++;
      }

      // Small delay between batches to avoid overwhelming the database
      if (i + batchSize < entities.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Update sync timestamps for successful entities
    if (processedIds.length > 0) {
      await this.updateSyncTimestamps(processedIds, organizationId);
    }

    this.logger.info(`${entityName} processing complete`, {
      organizationId,
      totalProcessed,
      successful,
      skipped,
      errors,
      successRate: totalProcessed > 0 ? (successful / totalProcessed * 100).toFixed(1) + '%' : '0%'
    });

    return {
      totalProcessed,
      successful,
      skipped,
      errors,
      processedIds
    };
  }

  /**
   * Health check for sync operations
   * @param {number} orgId - Internal organization ID
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck(orgId) {
    try {
      const entityName = this.getEntityName();
      
      // Check database connection
      const recordCount = await this.getDb()(this.getTableName())
        .where('organization_id', orgId)
        .count('* as count')
        .first();

      // Check API client
      const credentials = await organizationManager.getClassyCredentials(orgId);
      this.apiClient.setCredentials(credentials);
      const apiHealth = await this.apiClient.healthCheck();

      // Get last sync time
      const lastSyncTime = await this.getLastSyncTime(orgId);

      return {
        entity: entityName,
        status: 'healthy',
        database: {
          connected: true,
          recordCount: parseInt(recordCount.count)
        },
        api: apiHealth,
        lastSyncTime: lastSyncTime?.toISOString() || null,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        entity: this.getEntityName(),
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = {
  BaseEntitySync
};