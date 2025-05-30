const BasePlugin = require('./base-plugin');
const MailChimpClient = require('../integrations/mailchimp-client');
const logger = require('../utils/logger');

class MailChimpSyncPlugin extends BasePlugin {
  constructor(config, dependencies) {
    super(config, dependencies);
    
    this.apiKey = config.apiKey || process.env.MAILCHIMP_API_KEY;
    this.listId = config.listId || process.env.MAILCHIMP_LIST_ID || '06411e98fe'; // Default to Unified Audience
    this.syncMode = config.syncMode || 'incremental'; // 'incremental' or 'full'
    this.batchSize = config.batchSize || 100;
    this.tagPrefix = config.tagPrefix || ''; // Optional prefix for all tags
    
    this.client = null;
    this.fieldMapping = this.getFieldMapping();
    this.tagMapping = this.getTagMapping();
  }

  async initialize() {
    try {
      this.client = new MailChimpClient(this.apiKey, this.listId);
      
      // Validate access
      const validation = await this.client.validateAccess();
      if (!validation.valid) {
        // Log the error but don't fail initialization - allows system to continue
        logger.warn('MailChimp access validation failed - plugin will be disabled', { 
          error: validation.error 
        });
        this.enabled = false;
        return;
      }

      logger.info('MailChimp sync plugin initialized', {
        account: validation.account.name,
        list: validation.list.name,
        memberCount: validation.list.memberCount,
        syncMode: this.syncMode
      });

      // Optionally create missing merge fields
      if (this.config.createMergeFields) {
        await this.ensureMergeFields();
      }

    } catch (error) {
      logger.warn('Failed to initialize MailChimp sync plugin - plugin will be disabled', { 
        error: error.message 
      });
      // Don't throw error - just disable the plugin so system continues
      this.enabled = false;
    }
  }

  /**
   * Define mapping between supporter_summary fields and MailChimp merge fields
   */
  getFieldMapping() {
    return {
      // Basic info (existing fields)
      first_name: 'FNAME',
      last_name: 'LNAME',
      lifetime_donation_amount: 'TOTALAMT',
      lifetime_donation_count: 'DONCNT',
      monthly_recurring_amount: 'RECAMT',
      
      // Active subscription status
      active_recurring_plans: (supporter) => {
        return supporter.active_recurring_plans > 0 ? 'Yes' : 'No';
      },
      
      // Additional fields that could be added as custom merge fields
      last_donation_date: 'LASTGIFT', // Would need to be created
      first_donation_date: 'FIRSTGIFT', // Would need to be created
      donor_value_tier: 'DONORLEVEL', // Would need to be created
      engagement_status: 'ENGAGEMENT', // Would need to be created
      frequency_segment: 'FREQUENCY', // Would need to be created
      days_since_last_donation: 'DAYSLAST', // Would need to be created
      annual_giving_rate: 'ANNUALRATE' // Would need to be created
    };
  }

  /**
   * Define mapping between supporter data and MailChimp tags
   */
  getTagMapping() {
    return {
      // Donor value tier tags
      donor_value_tier: (tier) => `${this.tagPrefix}${tier}`,
      
      // Engagement status tags  
      engagement_status: (status) => `${this.tagPrefix}${status} Donor`,
      
      // Frequency segment tags
      frequency_segment: (frequency) => `${this.tagPrefix}${frequency} Donor`,
      
      // Recurring donor tags
      has_recurring: (supporter) => {
        return supporter.active_recurring_plans > 0 ? [`${this.tagPrefix}Monthly Recurring`] : [];
      },
      
      // Geographic tags (if address data available)
      // country: (country) => `${this.tagPrefix}${country}`,
      
      // Giving level tags
      giving_level: (supporter) => {
        const tags = [];
        if (supporter.lifetime_donation_amount >= 1000) {
          tags.push(`${this.tagPrefix}$1K+ Lifetime`);
        }
        if (supporter.lifetime_donation_amount >= 5000) {
          tags.push(`${this.tagPrefix}$5K+ Lifetime`);
        }
        if (supporter.monthly_recurring_amount >= 100) {
          tags.push(`${this.tagPrefix}$100+ Monthly`);
        }
        return tags;
      }
    };
  }

  /**
   * Process supporter data for sync
   */
  async process(data) {
    if (!this.enabled) {
      logger.debug('MailChimp plugin is disabled, skipping sync');
      return;
    }

    try {
      if (data.type === 'supporter.updated') {
        await this.syncSingleSupporter(data.supporter);
      } else if (data.type === 'supporters.batch') {
        await this.syncSupporterBatch(data.supporters);
      } else if (data.type === 'sync.supporters_completed') {
        // Trigger MailChimp sync when supporter sync completes
        await this.handleSupporterSyncCompleted(data);
      } else if (data.type === 'sync.full' || data.type === 'sync.completed') {
        // Handle full sync completion
        if (data.entityType === 'supporters' || data.type === 'sync.full') {
          await this.handleSupporterSyncCompleted(data);
        }
      }
    } catch (error) {
      logger.error('MailChimp sync processing failed', {
        dataType: data.type,
        error: error.message
      });
      // Don't re-throw error to avoid disrupting other plugins
      logger.warn('MailChimp sync error - plugin will continue but may need attention');
    }
  }

  /**
   * Sync a single supporter to MailChimp
   */
  async syncSingleSupporter(supporter) {
    if (!supporter.email_address) {
      logger.warn('Skipping supporter without email', { supporterId: supporter.id });
      return;
    }

    try {
      const memberData = this.mapSupporterToMember(supporter);
      const result = await this.client.upsertMember(memberData);
      
      logger.debug('Supporter synced to MailChimp', {
        email: supporter.email_address,
        supporterId: supporter.id,
        status: result.status
      });

    } catch (error) {
      logger.error('Failed to sync supporter to MailChimp', {
        email: supporter.email_address,
        supporterId: supporter.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Sync multiple supporters in batch
   */
  async syncSupporterBatch(supporters) {
    const validSupporters = supporters.filter(s => s.email_address);
    
    if (validSupporters.length === 0) {
      logger.warn('No supporters with email addresses to sync');
      return;
    }

    const batches = this.chunkArray(validSupporters, this.batchSize);
    
    for (const batch of batches) {
      try {
        const memberDataArray = batch.map(supporter => this.mapSupporterToMember(supporter));
        const batchResult = await this.client.batchUpsertMembers(memberDataArray);
        
        logger.info('Supporter batch synced to MailChimp', {
          batchSize: batch.length,
          batchId: batchResult.id,
          status: batchResult.status
        });

        // Optionally wait for batch completion
        if (this.config.waitForBatchCompletion) {
          await this.waitForBatchCompletion(batchResult.id);
        }

      } catch (error) {
        logger.error('Batch sync to MailChimp failed', {
          batchSize: batch.length,
          error: error.message
        });
        throw error;
      }
    }
  }

  /**
   * Map supporter data to MailChimp member format
   */
  mapSupporterToMember(supporter) {
    const mergeFields = {};
    const tags = [];

    // Map merge fields
    Object.entries(this.fieldMapping).forEach(([supporterField, mailchimpField]) => {
      if (typeof mailchimpField === 'function') {
        mergeFields.ACTIVESUB = mailchimpField(supporter);
      } else if (supporter[supporterField] !== null && supporter[supporterField] !== undefined) {
        mergeFields[mailchimpField] = supporter[supporterField];
      }
    });

    // Map tags using specific logic for each type
    if (supporter.donor_value_tier) {
      tags.push(`${this.tagPrefix}${supporter.donor_value_tier}`);
    }
    
    if (supporter.engagement_status && supporter.engagement_status !== 'Never Donated') {
      tags.push(`${this.tagPrefix}${supporter.engagement_status} Donor`);
    }
    
    if (supporter.frequency_segment && supporter.frequency_segment !== 'No Donations') {
      tags.push(`${this.tagPrefix}${supporter.frequency_segment} Donor`);
    }
    
    // Recurring donor tags
    if (supporter.active_recurring_plans > 0) {
      tags.push(`${this.tagPrefix}Monthly Recurring`);
    }
    
    // Giving level tags
    if (supporter.lifetime_donation_amount >= 1000) {
      tags.push(`${this.tagPrefix}$1K+ Lifetime`);
    }
    if (supporter.lifetime_donation_amount >= 5000) {
      tags.push(`${this.tagPrefix}$5K+ Lifetime`);
    }
    if (supporter.monthly_recurring_amount >= 100) {
      tags.push(`${this.tagPrefix}$100+ Monthly`);
    }

    // Clean up merge fields (remove null/undefined)
    Object.keys(mergeFields).forEach(key => {
      if (mergeFields[key] === null || mergeFields[key] === undefined || mergeFields[key] === '') {
        delete mergeFields[key];
      }
    });

    return {
      email_address: supporter.email_address,
      status_if_new: 'subscribed',
      merge_fields: mergeFields,
      tags: tags.filter(tag => tag && tag.trim())
    };
  }

  /**
   * Handle supporter sync completion events
   */
  async handleSupporterSyncCompleted(data) {
    const { syncType, result, params } = data;
    
    logger.info('Handling supporter sync completion for MailChimp', {
      syncType,
      recordsProcessed: result?.successfulRecords || 0
    });

    try {
      if (syncType === 'full') {
        // For full syncs, sync all email-consented supporters
        await this.performFullSync();
      } else if (syncType === 'incremental') {
        // For incremental syncs, sync recently updated supporters
        await this.performIncrementalSync(params?.updated_since);
      }
    } catch (error) {
      logger.error('Failed to handle supporter sync completion', { error: error.message });
      throw error;
    }
  }

  /**
   * Perform full sync of all supporters
   */
  async performFullSync() {
    logger.info('Starting full MailChimp sync');

    try {
      // Get all supporters with email addresses who have consented to email contact
      const query = `
        SELECT * FROM supporter_summary 
        WHERE email_address IS NOT NULL 
        AND email_address != ''
        AND email_opt_in = 1
        ORDER BY lifetime_donation_amount DESC
      `;
      
      const supporters = await this.db.query(query);
      
      logger.info('Full sync: processing supporters', {
        totalSupporters: supporters.length,
        batchSize: this.batchSize
      });

      await this.syncSupporterBatch(supporters);
      
      logger.info('Full MailChimp sync completed', {
        supporterCount: supporters.length
      });

    } catch (error) {
      logger.error('Full MailChimp sync failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Sync supporters with recent changes
   */
  async performIncrementalSync(since) {
    if (!since) {
      logger.info('No since date provided for incremental sync, skipping MailChimp update');
      return;
    }

    logger.info('Starting incremental MailChimp sync', { since });

    try {
      // Convert since date to MySQL format if needed
      const sinceDate = since instanceof Date ? since : new Date(since);
      const mysqlDatetime = sinceDate.toISOString().replace('T', ' ').replace(/\\.\\d{3}Z$/, '');
      
      const query = `
        SELECT * FROM supporter_summary 
        WHERE email_address IS NOT NULL 
        AND email_address != ''
        AND email_opt_in = 1
        AND last_sync_at >= ?
        ORDER BY last_sync_at DESC
      `;
      
      const supporters = await this.db.query(query, [mysqlDatetime]);
      
      if (supporters.length === 0) {
        logger.info('No supporters to sync in incremental update', { since: mysqlDatetime });
        return;
      }

      logger.info('Incremental sync: processing supporters', {
        supporterCount: supporters.length,
        since: mysqlDatetime
      });

      await this.syncSupporterBatch(supporters);
      
      logger.info('Incremental MailChimp sync completed', {
        supporterCount: supporters.length
      });

    } catch (error) {
      logger.error('Incremental MailChimp sync failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Ensure required merge fields exist
   */
  async ensureMergeFields() {
    const requiredFields = [
      { tag: 'LASTGIFT', name: 'Last Gift Date', type: 'date' },
      { tag: 'FIRSTGIFT', name: 'First Gift Date', type: 'date' },
      { tag: 'DONORLEVEL', name: 'Donor Level', type: 'text' },
      { tag: 'ENGAGEMENT', name: 'Engagement Status', type: 'text' },
      { tag: 'FREQUENCY', name: 'Gift Frequency', type: 'text' },
      { tag: 'DAYSLAST', name: 'Days Since Last Gift', type: 'number' },
      { tag: 'ANNUALRATE', name: 'Annual Giving Rate', type: 'number' }
    ];

    const existingFields = await this.client.getMergeFields();
    const existingTags = existingFields.map(f => f.tag);

    for (const field of requiredFields) {
      if (!existingTags.includes(field.tag)) {
        try {
          await this.client.createMergeField(field);
          logger.info('Created merge field', { tag: field.tag, name: field.name });
        } catch (error) {
          logger.warn('Failed to create merge field', {
            tag: field.tag,
            error: error.message
          });
        }
      }
    }
  }

  /**
   * Wait for batch operation completion
   */
  async waitForBatchCompletion(batchId, maxWait = 300000) { // 5 minutes max
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      try {
        const status = await this.client.getBatchStatus(batchId);
        
        if (status.status === 'finished') {
          logger.info('Batch operation completed', {
            batchId,
            finished_operations: status.finished_operations,
            errored_operations: status.errored_operations
          });
          return status;
        }
        
        // Wait 5 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 5000));
        
      } catch (error) {
        logger.warn('Error checking batch status', { batchId, error: error.message });
        break;
      }
    }
    
    logger.warn('Batch operation timeout', { batchId });
    return null;
  }

  /**
   * Utility function to chunk array into smaller arrays
   */
  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async shutdown() {
    logger.info('MailChimp sync plugin shutting down');
  }
}

module.exports = MailChimpSyncPlugin;