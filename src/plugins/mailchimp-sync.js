/**
 * MailChimp Sync Plugin
 * 
 * Synchronizes supporter data from Classy to MailChimp with intelligent 
 * tagging based on donor behavior and segmentation
 */

const { BasePlugin } = require('./base-plugin');
const { MailChimpClient } = require('../integrations/mailchimp-client');
const { getKnex } = require('../config/database');

class MailChimpSyncPlugin extends BasePlugin {
  constructor(config = {}, dependencies = {}) {
    super('mailchimp', config, dependencies);
    this.mailchimpClient = null;
    this.db = dependencies.database || null;
    
    // Default configuration
    this.defaultConfig = {
      batchSize: 50,
      tagPrefix: 'Classy-',
      createMergeFields: false,
      waitForBatchCompletion: false,
      syncMode: 'incremental'
    };
    
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Get required configuration fields
   * @returns {Array<string>} Required field names
   */
  getRequiredConfigFields() {
    return ['apiKey', 'listId'];
  }

  /**
   * Plugin-specific setup
   * @returns {Promise<void>}
   */
  async setup() {
    // Initialize database connection if not provided
    if (!this.db) {
      this.db = getKnex();
    }
    
    // Initialize MailChimp client
    this.mailchimpClient = new MailChimpClient(this.config);
    
    // Test API connectivity
    const health = await this.mailchimpClient.healthCheck();
    if (health.status !== 'healthy') {
      throw new Error(`MailChimp API health check failed: ${health.error}`);
    }
    
    this.logger.info('MailChimp client setup successful', {
      listName: health.listName,
      memberCount: health.memberCount,
      datacenter: health.datacenter
    });
  }

  /**
   * Plugin-specific health check
   * @returns {Promise<Object>} Health data
   */
  async checkHealth() {
    if (!this.mailchimpClient) {
      return { mailchimp: { status: 'not_initialized' } };
    }
    
    const mailchimpHealth = await this.mailchimpClient.healthCheck();
    return { mailchimp: mailchimpHealth };
  }

  /**
   * Execute MailChimp sync processing
   * @param {Object} data - Data to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  async execute(data, options = {}) {
    const { type } = data;
    
    switch (type) {
      case 'supporters.sync':
        return await this.syncSupporters(data.supporters, options);
        
      case 'supporter.updated':
        return await this.syncSingleSupporter(data.supporter, options);
        
      case 'supporters.batch':
        return await this.syncSupportersBatch(data.supporters, options);
        
      case 'supporters.full':
        return await this.fullSync(options);
        
      default:
        throw new Error(`Unsupported data type: ${type}`);
    }
  }

  /**
   * Sync multiple supporters to MailChimp
   * @param {Array} supporters - Supporter records
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} Sync results
   */
  async syncSupporters(supporters, options = {}) {
    if (!supporters || supporters.length === 0) {
      return { processed: 0, errors: 0, skipped: 0 };
    }

    this.logger.info(`Starting MailChimp sync for ${supporters.length} supporters`);

    // Filter supporters with email addresses
    const supportersWithEmail = supporters.filter(supporter => 
      supporter.email_address && 
      supporter.email_address.trim().length > 0
    );

    if (supportersWithEmail.length === 0) {
      this.logger.warn('No supporters with email addresses found');
      return { processed: 0, errors: 0, skipped: supporters.length };
    }

    this.logger.info(`Processing ${supportersWithEmail.length} supporters with email addresses`);

    // Convert supporters to MailChimp format
    const members = await Promise.all(
      supportersWithEmail.map(supporter => this.convertSupporterToMember(supporter))
    );

    // Process in batches
    const results = await this.mailchimpClient.batchUpsertMembers(members, {
      waitForCompletion: options.waitForCompletion || this.config.waitForBatchCompletion
    });

    this.logger.info('MailChimp sync completed', {
      totalSupporters: supporters.length,
      supportersWithEmail: supportersWithEmail.length,
      processed: results.processed,
      errors: results.errors
    });

    return {
      totalSupporters: supporters.length,
      supportersWithEmail: supportersWithEmail.length,
      processed: results.processed,
      errors: results.errors,
      skipped: supporters.length - supportersWithEmail.length,
      batches: results.batches?.length || 0
    };
  }

  /**
   * Sync a single supporter to MailChimp
   * @param {Object} supporter - Supporter record
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} Sync result
   */
  async syncSingleSupporter(supporter, options = {}) {
    if (!supporter.email_address || supporter.email_address.trim().length === 0) {
      this.logger.warn('Supporter has no email address', {
        supporterId: supporter.id
      });
      return { processed: 0, errors: 0, skipped: 1 };
    }

    this.logger.debug('Syncing single supporter to MailChimp', {
      supporterId: supporter.id,
      email: supporter.email_address
    });

    try {
      const member = await this.convertSupporterToMember(supporter);
      const result = await this.mailchimpClient.upsertMember(member, options);

      return {
        processed: result.success ? 1 : 0,
        errors: result.success ? 0 : 1,
        skipped: 0,
        details: result
      };

    } catch (error) {
      this.logger.error('Failed to sync supporter to MailChimp', {
        supporterId: supporter.id,
        email: supporter.email_address,
        error: error.message
      });

      return {
        processed: 0,
        errors: 1,
        skipped: 0,
        error: error.message
      };
    }
  }

  /**
   * Sync batch of supporters (alias for syncSupporters)
   * @param {Array} supporters - Supporter records
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} Sync results
   */
  async syncSupportersBatch(supporters, options = {}) {
    return await this.syncSupporters(supporters, options);
  }

  /**
   * Perform full sync of all supporters from database
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} Sync results
   */
  async fullSync(options = {}) {
    const { organizationId, limit } = options;
    
    if (!organizationId) {
      throw new Error('Organization ID required for full sync');
    }

    this.logger.info('Starting full MailChimp sync', { organizationId, limit });

    // Get all supporters with email addresses
    let query = this.db('supporters')
      .where('organization_id', organizationId)
      .whereNotNull('email_address')
      .where('email_address', '!=', '');

    if (limit) {
      query = query.limit(limit);
    }

    const supporters = await query.select('*');
    
    this.logger.info(`Found ${supporters.length} supporters with email addresses`);

    if (supporters.length === 0) {
      return { processed: 0, errors: 0, skipped: 0 };
    }

    return await this.syncSupporters(supporters, options);
  }

  /**
   * Convert supporter record to MailChimp member format
   * @param {Object} supporter - Supporter record from database
   * @returns {Promise<Object>} MailChimp member data
   */
  async convertSupporterToMember(supporter) {
    // Generate donor segmentation
    const segments = await this.generateDonorSegments(supporter);
    
    // Build merge fields mapping
    const mergeFields = {
      FNAME: supporter.first_name || '',
      LNAME: supporter.last_name || '',
      TOTALAMT: parseFloat(supporter.lifetime_donation_amount || 0),
      DONCNT: parseInt(supporter.lifetime_donation_count || 0),
      RECAMT: parseFloat(supporter.monthly_recurring_amount || 0),
      ACTIVESUB: supporter.monthly_recurring_amount > 0 ? 'Yes' : 'No'
    };

    // Generate tags with prefix
    const tags = segments.map(segment => `${this.config.tagPrefix}${segment}`);

    this.logger.debug('Generated MailChimp member data', {
      supporterId: supporter.id,
      email: supporter.email_address,
      totalAmount: mergeFields.TOTALAMT,
      donationCount: mergeFields.DONCNT,
      recurringAmount: mergeFields.RECAMT,
      tagCount: tags.length
    });

    return {
      email: supporter.email_address,
      mergeFields,
      tags,
      interests: {} // Can be extended for specific interests
    };
  }

  /**
   * Generate donor segmentation tags based on giving history
   * @param {Object} supporter - Supporter record
   * @returns {Promise<Array<string>>} Array of segment tags
   */
  async generateDonorSegments(supporter) {
    const segments = [];
    const lifetimeAmount = parseFloat(supporter.lifetime_donation_amount || 0);
    const donationCount = parseInt(supporter.lifetime_donation_count || 0);
    const monthlyRecurring = parseFloat(supporter.monthly_recurring_amount || 0);

    // Donor Value Tiers
    if (lifetimeAmount >= 10000) {
      segments.push('Transformational');
    } else if (lifetimeAmount >= 5000) {
      segments.push('Principal Donor');
    } else if (lifetimeAmount >= 1000) {
      segments.push('Major Donor');
    } else if (lifetimeAmount >= 100) {
      segments.push('Regular Donor');
    } else if (lifetimeAmount >= 25) {
      segments.push('Small Donor');
    } else if (lifetimeAmount > 0) {
      segments.push('First-Time');
    }

    // Frequency Segments
    if (donationCount >= 26) {
      segments.push('Champion Donor');
    } else if (donationCount >= 11) {
      segments.push('Loyal Donor');
    } else if (donationCount >= 4) {
      segments.push('Regular Donor');
    } else if (donationCount >= 2) {
      segments.push('Repeat Donor');
    } else if (donationCount === 1) {
      segments.push('One-Time Donor');
    }

    // Recurring Donor Segments
    if (monthlyRecurring > 0) {
      segments.push('Monthly Recurring');
      
      if (monthlyRecurring >= 100) {
        segments.push('$100+ Monthly');
      }
    }

    // Special Value Tags
    if (lifetimeAmount >= 1000) {
      segments.push('$1K+ Lifetime');
    }
    
    if (lifetimeAmount >= 5000) {
      segments.push('$5K+ Lifetime');
    }

    // Get engagement status based on last donation
    const engagementStatus = await this.getEngagementStatus(supporter);
    if (engagementStatus) {
      segments.push(engagementStatus);
    }

    return segments;
  }

  /**
   * Get donor engagement status based on last donation date
   * @param {Object} supporter - Supporter record
   * @returns {Promise<string|null>} Engagement status
   */
  async getEngagementStatus(supporter) {
    try {
      // Get the most recent transaction for this supporter
      const lastTransaction = await this.db('transactions')
        .where('supporter_id', supporter.id)
        .where('organization_id', supporter.organization_id)
        .where('status', 'success')
        .orderBy('purchased_at', 'desc')
        .first();

      if (!lastTransaction) {
        return null; // No transactions found
      }

      const lastDonationDate = new Date(lastTransaction.purchased_at);
      const daysSinceLastDonation = Math.floor((Date.now() - lastDonationDate.getTime()) / (1000 * 60 * 60 * 24));

      // Engagement status based on days since last donation
      if (daysSinceLastDonation <= 30) {
        return 'Recent Donor';
      } else if (daysSinceLastDonation <= 90) {
        return 'Active Donor';
      } else if (daysSinceLastDonation <= 180) {
        return 'Warm Donor';
      } else if (daysSinceLastDonation <= 365) {
        return 'Cooling Donor';
      } else if (daysSinceLastDonation <= 730) {
        return 'Lapsed Donor';
      } else {
        return 'Dormant Donor';
      }

    } catch (error) {
      this.logger.warn('Failed to get engagement status', {
        supporterId: supporter.id,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get plugin configuration schema
   * @returns {Object} Configuration schema
   */
  getConfigSchema() {
    return {
      name: 'mailchimp',
      description: 'MailChimp integration for donor segmentation and email marketing',
      requiredFields: ['apiKey', 'listId'],
      optionalFields: [
        'batchSize',
        'tagPrefix', 
        'createMergeFields',
        'waitForBatchCompletion',
        'syncMode'
      ],
      supportedDataTypes: [
        'supporters.sync',
        'supporter.updated', 
        'supporters.batch',
        'supporters.full'
      ],
      supportedOptions: {
        organizationId: 'Internal organization ID for full sync',
        limit: 'Maximum number of supporters to sync',
        waitForCompletion: 'Wait for MailChimp batch processing to complete',
        dryRun: 'Show what would be synced without making changes'
      },
      mergeFields: {
        FNAME: 'First name',
        LNAME: 'Last name', 
        TOTALAMT: 'Total lifetime donations',
        DONCNT: 'Number of donations',
        RECAMT: 'Monthly recurring amount',
        ACTIVESUB: 'Has active recurring subscription'
      },
      segmentTags: {
        valueeTiers: [
          'Transformational (>= $10K)',
          'Principal Donor ($5K-$10K)',
          'Major Donor ($1K-$5K)',
          'Regular Donor ($100-$1K)',
          'Small Donor ($25-$100)',
          'First-Time (<$25)'
        ],
        engagement: [
          'Recent Donor (0-30 days)',
          'Active Donor (31-90 days)', 
          'Warm Donor (91-180 days)',
          'Cooling Donor (181-365 days)',
          'Lapsed Donor (1-2 years)',
          'Dormant Donor (2+ years)'
        ],
        frequency: [
          'Champion Donor (26+ donations)',
          'Loyal Donor (11-25 donations)',
          'Regular Donor (4-10 donations)',
          'Repeat Donor (2-3 donations)',
          'One-Time Donor (1 donation)'
        ],
        special: [
          'Monthly Recurring',
          '$1K+ Lifetime',
          '$5K+ Lifetime', 
          '$100+ Monthly'
        ]
      }
    };
  }

  /**
   * Plugin-specific cleanup
   * @returns {Promise<void>}
   */
  async cleanup() {
    // No specific cleanup needed for MailChimp client
    this.mailchimpClient = null;
  }
}

module.exports = {
  MailChimpSyncPlugin
};