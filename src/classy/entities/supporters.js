/**
 * Supporters Entity Sync
 * 
 * Handles synchronization of supporter data from Classy API
 * Includes lifetime donation stats recalculation and validated field mapping
 */

const { BaseEntitySync } = require('../../core/base-entity-sync');

class SupportersSync extends BaseEntitySync {
  constructor() {
    super('supporters');
  }

  /**
   * Get database table name
   * @returns {string} Table name
   */
  getTableName() {
    return 'supporters';
  }

  /**
   * Fetch supporters from Classy API
   * @param {number} classyOrgId - Classy organization ID
   * @param {Object} options - Fetch options
   * @returns {Promise<Array>} Supporter records
   */
  async fetchEntities(classyOrgId, options) {
    this.logger.debug('Fetching supporters from Classy API', { classyOrgId, options });
    
    return await this.apiClient.getSupporters(classyOrgId, options);
  }

  /**
   * Fetch a single page of supporters (for streaming sync)
   * @param {number} classyOrgId - Classy organization ID
   * @param {number} page - Page number to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Page result with supporter data
   */
  async fetchSinglePage(classyOrgId, page, options) {
    const { updatedSince, filters = [] } = options;
    const endpoint = `/organizations/${classyOrgId}/supporters`;
    
    const params = {};
    
    // Add date filter if specified
    if (updatedSince) {
      const dateFilter = this.apiClient.constructor.buildDateFilter('updated_at', '>', updatedSince);
      filters.push(dateFilter);
    }
    
    // Add filters if any
    if (filters.length > 0) {
      params.filter = filters.join(',');
    }

    this.logger.debug('Fetching single page of supporters', { 
      classyOrgId, 
      page, 
      filters: filters.length 
    });
    
    return await this.apiClient.fetchSinglePage(endpoint, page, params);
  }

  /**
   * Upsert supporter into database with validated field mapping
   * @param {Object} supporter - Supporter data from Classy API
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Object>} Database result
   */
  async upsertEntity(supporter, organizationId) {
    const now = new Date();
    
    // Map Classy supporter fields to database schema
    const supporterData = {
      id: supporter.id, // Classy ID as primary key
      organization_id: organizationId,
      email_address: supporter.email_address || null,
      first_name: supporter.first_name || null,
      last_name: supporter.last_name || null,
      
      // Initialize lifetime stats (will be recalculated)
      lifetime_donation_amount: 0,
      lifetime_donation_count: 0,
      monthly_recurring_amount: 0,
      
      // Contact preferences and info
      email_opt_in: supporter.opt_in || false, // CORRECTED: API field is 'opt_in', not 'email_opt_in'
      phone: supporter.phone || null,
      
      // Address information
      city: supporter.city || null,
      state: supporter.state || null,
      country: supporter.country || null,
      postal_code: supporter.postal_code || null,
      
      // Timestamps
      created_at: supporter.created_at ? new Date(supporter.created_at) : now,
      updated_at: now,
      last_sync_at: now
    };

    try {
      // Use ON DUPLICATE KEY UPDATE for MySQL compatibility
      const result = await this.getDb()(this.getTableName())
        .insert(supporterData)
        .onConflict('id')
        .merge({
          ...supporterData,
          created_at: this.getDb().raw('COALESCE(created_at, ?)', [supporterData.created_at])
        });

      this.logger.debug('Supporter upserted', {
        supporterId: supporter.id,
        organizationId,
        email: supporter.email_address
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to upsert supporter', {
        supporterId: supporter.id,
        organizationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Recalculate lifetime donation statistics for supporters
   * @param {number} organizationId - Internal organization ID
   * @param {Array} supporterIds - Specific supporter IDs to recalculate (optional)
   * @returns {Promise<Object>} Recalculation results
   */
  async recalculateLifetimeStats(organizationId, supporterIds = null) {
    this.logger.info('Recalculating supporter lifetime statistics', { 
      organizationId, 
      specificSupporters: supporterIds?.length || 'all' 
    });

    try {
      // Build WHERE clause components
      let transactionWhereClause = 'transactions.organization_id = ? AND transactions.status = ?';
      let baseTransactionParams = [organizationId, 'success'];

      if (supporterIds && supporterIds.length > 0) {
        transactionWhereClause += ` AND transactions.supporter_id IN (${supporterIds.map(() => '?').join(',')})`;
      }

      // Calculate lifetime donation amounts and counts
      const lifetimeStatsQuery = `
        UPDATE supporters SET
          lifetime_donation_amount = COALESCE((
            SELECT SUM(total_gross_amount)
            FROM transactions 
            WHERE ${transactionWhereClause}
              AND transactions.supporter_id = supporters.id
          ), 0),
          lifetime_donation_count = COALESCE((
            SELECT COUNT(*)
            FROM transactions 
            WHERE ${transactionWhereClause}
              AND transactions.supporter_id = supporters.id
          ), 0),
          updated_at = ?
        WHERE supporters.organization_id = ?
        ${supporterIds ? `AND supporters.id IN (${supporterIds.map(() => '?').join(',')})` : ''}
      `;

      // Build parameters: transaction params for first subquery, same for second subquery, update time, org ID, then supporter IDs if specified
      let statsParams = [];
      statsParams = statsParams.concat(baseTransactionParams); // First subquery params
      if (supporterIds && supporterIds.length > 0) {
        statsParams = statsParams.concat(supporterIds); // First subquery supporter IDs
      }
      statsParams = statsParams.concat(baseTransactionParams); // Second subquery params  
      if (supporterIds && supporterIds.length > 0) {
        statsParams = statsParams.concat(supporterIds); // Second subquery supporter IDs
      }
      statsParams.push(new Date()); // updated_at
      statsParams.push(organizationId); // WHERE supporters.organization_id
      if (supporterIds && supporterIds.length > 0) {
        statsParams = statsParams.concat(supporterIds); // Main WHERE supporter IDs
      }

      const lifetimeResult = await this.getDb().raw(lifetimeStatsQuery, statsParams);

      // Calculate monthly recurring amounts
      const recurringStatsQuery = `
        UPDATE supporters SET
          monthly_recurring_amount = COALESCE((
            SELECT SUM(amount)
            FROM recurring_plans 
            WHERE recurring_plans.organization_id = ? 
              AND recurring_plans.status = 'active'
              AND recurring_plans.frequency = 'monthly'
              AND recurring_plans.supporter_id = supporters.id
          ), 0),
          updated_at = ?
        WHERE supporters.organization_id = ?
        ${supporterIds ? `AND supporters.id IN (${supporterIds.map(() => '?').join(',')})` : ''}
      `;

      let recurringParams = [organizationId, new Date(), organizationId];
      if (supporterIds && supporterIds.length > 0) {
        recurringParams = recurringParams.concat(supporterIds);
      }

      const recurringResult = await this.getDb().raw(recurringStatsQuery, recurringParams);

      // Get updated statistics
      const statsQuery = await this.getDb()('supporters')
        .where('organization_id', organizationId)
        .modify(qb => {
          if (supporterIds && supporterIds.length > 0) {
            qb.whereIn('id', supporterIds);
          }
        })
        .select([
          this.getDb().raw('COUNT(*) as total_supporters'),
          this.getDb().raw('SUM(lifetime_donation_amount) as total_lifetime_amount'),
          this.getDb().raw('SUM(lifetime_donation_count) as total_lifetime_count'),
          this.getDb().raw('SUM(monthly_recurring_amount) as total_monthly_recurring'),
          this.getDb().raw('AVG(lifetime_donation_amount) as avg_lifetime_amount')
        ])
        .first();

      this.logger.info('Lifetime statistics recalculated', {
        organizationId,
        supportersUpdated: supporterIds?.length || 'all',
        totalSupporters: parseInt(statsQuery.total_supporters),
        totalLifetimeAmount: parseFloat(statsQuery.total_lifetime_amount || 0),
        totalMonthlyRecurring: parseFloat(statsQuery.total_monthly_recurring || 0),
        avgLifetimeAmount: parseFloat(statsQuery.avg_lifetime_amount || 0)
      });

      return {
        supportersUpdated: supporterIds?.length || parseInt(statsQuery.total_supporters),
        totalLifetimeAmount: parseFloat(statsQuery.total_lifetime_amount || 0),
        totalLifetimeCount: parseInt(statsQuery.total_lifetime_count || 0),
        totalMonthlyRecurring: parseFloat(statsQuery.total_monthly_recurring || 0),
        avgLifetimeAmount: parseFloat(statsQuery.avg_lifetime_amount || 0)
      };

    } catch (error) {
      this.logger.error('Failed to recalculate lifetime statistics', {
        organizationId,
        supporterIds,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Perform sync with automatic lifetime stats recalculation
   * @param {number} orgId - Internal organization ID
   * @param {number} classyOrgId - Classy organization ID
   * @param {Object} options - Sync options
   * @returns {Promise<Object>} Enhanced sync results
   */
  async sync(orgId, classyOrgId, options = {}) {
    const { syncType = 'incremental', recalculateStats = true } = options;
    
    // Perform the sync
    let syncResults;
    if (syncType === 'full') {
      syncResults = await this.fullSync(orgId, classyOrgId, options);
    } else {
      syncResults = await this.incrementalSync(orgId, classyOrgId, options);
    }

    // Recalculate lifetime stats if requested
    if (recalculateStats && syncResults.successful > 0) {
      this.logger.info('Recalculating lifetime stats for synced supporters');
      
      try {
        const statsResults = await this.recalculateLifetimeStats(
          orgId, 
          syncResults.processedIds
        );
        
        syncResults.lifetimeStats = statsResults;
        
      } catch (error) {
        this.logger.warn('Lifetime stats recalculation failed', { error: error.message });
        syncResults.lifetimeStatsError = error.message;
      }
    }

    return syncResults;
  }

  /**
   * Enhanced health check including lifetime stats validation
   * @param {number} orgId - Internal organization ID
   * @returns {Promise<Object>} Enhanced health check result
   */
  async healthCheck(orgId) {
    const baseHealth = await super.healthCheck(orgId);

    try {
      // Add supporter-specific health metrics
      const supporterStats = await this.getDb()('supporters')
        .where('organization_id', orgId)
        .select([
          this.getDb().raw('COUNT(*) as total_supporters'),
          this.getDb().raw('COUNT(CASE WHEN email_address IS NOT NULL THEN 1 END) as supporters_with_email'),
          this.getDb().raw('COUNT(CASE WHEN lifetime_donation_amount > 0 THEN 1 END) as supporters_with_donations'),
          this.getDb().raw('COUNT(CASE WHEN monthly_recurring_amount > 0 THEN 1 END) as recurring_supporters'),
          this.getDb().raw('SUM(lifetime_donation_amount) as total_lifetime_value'),
          this.getDb().raw('SUM(monthly_recurring_amount) as total_monthly_recurring')
        ])
        .first();

      baseHealth.supporterMetrics = {
        totalSupporters: parseInt(supporterStats.total_supporters),
        supportersWithEmail: parseInt(supporterStats.supporters_with_email),
        supportersWithDonations: parseInt(supporterStats.supporters_with_donations),
        recurringSupporters: parseInt(supporterStats.recurring_supporters),
        totalLifetimeValue: parseFloat(supporterStats.total_lifetime_value || 0),
        totalMonthlyRecurring: parseFloat(supporterStats.total_monthly_recurring || 0),
        emailCaptureRate: supporterStats.total_supporters > 0 
          ? (supporterStats.supporters_with_email / supporterStats.total_supporters * 100).toFixed(1) + '%'
          : '0%'
      };

    } catch (error) {
      baseHealth.supporterMetricsError = error.message;
    }

    return baseHealth;
  }
}

// Export singleton instance
const supportersSync = new SupportersSync();

module.exports = {
  SupportersSync,
  supportersSync
};