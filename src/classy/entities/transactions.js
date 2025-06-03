/**
 * Transactions Entity Sync
 * 
 * Handles synchronization of transaction data from Classy API
 * Includes multi-currency support and validated field mapping
 */

const { BaseEntitySync } = require('../../core/base-entity-sync');

class TransactionsSync extends BaseEntitySync {
  constructor() {
    super('transactions');
  }

  /**
   * Get database table name
   * @returns {string} Table name
   */
  getTableName() {
    return 'transactions';
  }

  /**
   * Fetch transactions from Classy API
   * @param {number} classyOrgId - Classy organization ID
   * @param {Object} options - Fetch options
   * @returns {Promise<Array>} Transaction records
   */
  async fetchEntities(classyOrgId, options) {
    this.logger.debug('Fetching transactions from Classy API', { classyOrgId, options });
    
    return await this.apiClient.getTransactions(classyOrgId, options);
  }

  /**
   * Fetch a single page of transactions (for streaming sync)
   * @param {number} classyOrgId - Classy organization ID
   * @param {number} page - Page number to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Page result with transaction data
   */
  async fetchSinglePage(classyOrgId, page, options) {
    const { purchasedSince, updatedSince, filters = [] } = options;
    const endpoint = `/organizations/${classyOrgId}/transactions`;
    
    const params = {};
    
    // Add date filters if specified
    if (purchasedSince) {
      const dateFilter = this.apiClient.constructor.buildDateFilter('purchased_at', '>', purchasedSince);
      filters.push(dateFilter);
    }
    
    if (updatedSince) {
      const dateFilter = this.apiClient.constructor.buildDateFilter('updated_at', '>', updatedSince);
      filters.push(dateFilter);
    }
    
    // Add filters if any
    if (filters.length > 0) {
      params.filter = filters.join(',');
    }

    this.logger.debug('Fetching single page of transactions', { 
      classyOrgId, 
      page, 
      filters: filters.length 
    });
    
    return await this.apiClient.fetchSinglePage(endpoint, page, params);
  }

  /**
   * Upsert transaction into database with validated field mapping
   * @param {Object} transaction - Transaction data from Classy API
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Object>} Database result
   */
  async upsertEntity(transaction, organizationId) {
    const now = new Date();
    
    // Check if referenced supporter exists (if supporter_id is provided)
    if (transaction.supporter_id) {
      const supporterExists = await this.getDb()('supporters')
        .where('id', transaction.supporter_id)
        .andWhere('organization_id', organizationId)
        .first();
        
      if (!supporterExists) {
        this.logger.warn('Skipping transaction - supporter not found', {
          transactionId: transaction.id,
          supporterId: transaction.supporter_id,
          organizationId
        });
        return { skipped: true, reason: 'supporter_not_found' };
      }
    }
    
    // Check if referenced campaign exists (if campaign_id is provided)
    if (transaction.campaign_id) {
      const campaignExists = await this.getDb()('campaigns')
        .where('id', transaction.campaign_id)
        .andWhere('organization_id', organizationId)
        .first();
        
      if (!campaignExists) {
        this.logger.warn('Skipping transaction - campaign not found', {
          transactionId: transaction.id,
          campaignId: transaction.campaign_id,
          organizationId
        });
        return { skipped: true, reason: 'campaign_not_found' };
      }
    }
    
    // Map status values to our database enum (success, pending, failed, refunded)
    const mapStatus = (status) => {
      const statusMap = {
        'success': 'success',
        'successful': 'success',
        'completed': 'success',
        'processed': 'success',
        'paid': 'success',
        'pending': 'pending',
        'processing': 'pending',
        'failed': 'failed',
        'error': 'failed',
        'cancelled': 'failed', // Map cancelled to failed
        'canceled': 'failed',  // API uses US spelling
        'refunded': 'refunded',
        'reversed': 'refunded',
        'disputed': 'failed',
        'declined': 'failed'
      };
      return statusMap[status] || 'pending';
    };

    // Map Classy transaction fields to database schema (VALIDATED field names)
    const transactionData = {
      id: transaction.id, // Classy ID as primary key
      organization_id: organizationId,
      supporter_id: transaction.supporter_id || null, // FK to supporters.id (Classy ID)
      campaign_id: transaction.campaign_id || null, // FK to campaigns.id (Classy ID)
      recurring_plan_id: transaction.recurring_plan_id || null, // FK to recurring_plans.id
      
      // Core amounts (VALIDATED field names from live API testing)
      total_gross_amount: parseFloat(transaction.total_gross_amount || 0),
      donation_gross_amount: parseFloat(transaction.donation_gross_amount || 0),
      fees_amount: parseFloat(transaction.fees_amount || 0),
      donation_net_amount: parseFloat(transaction.donation_net_amount || 0),
      currency: transaction.currency || 'USD',
      
      // Multi-currency support (all fields available in API)
      raw_total_gross_amount: parseFloat(transaction.raw_total_gross_amount || 0),
      raw_currency_code: transaction.raw_currency_code || null,
      charged_total_gross_amount: parseFloat(transaction.charged_total_gross_amount || 0),
      charged_currency_code: transaction.charged_currency_code || null,
      
      // Billing information (available for enhanced analytics)
      billing_city: transaction.billing_city || null,
      billing_state: transaction.billing_state || null,
      billing_country: transaction.billing_country || null,
      billing_postal_code: transaction.billing_postal_code || null,
      
      // Relationship fields (VALIDATED)
      fundraising_page_id: transaction.fundraising_page_id || null,
      fundraising_team_id: transaction.fundraising_team_id || null,
      
      // Status and timing
      status: mapStatus(transaction.status),
      purchased_at: transaction.purchased_at ? new Date(transaction.purchased_at) : now,
      
      // Timestamps
      created_at: transaction.created_at ? new Date(transaction.created_at) : now,
      updated_at: now,
      last_sync_at: now
    };

    try {
      // Use ON DUPLICATE KEY UPDATE for MySQL compatibility
      const result = await this.getDb()(this.getTableName())
        .insert(transactionData)
        .onConflict('id')
        .merge({
          ...transactionData,
          created_at: this.getDb().raw('COALESCE(created_at, ?)', [transactionData.created_at])
        });

      this.logger.debug('Transaction upserted', {
        transactionId: transaction.id,
        organizationId,
        amount: transaction.total_gross_amount,
        currency: transaction.currency,
        supporterId: transaction.supporter_id,
        campaignId: transaction.campaign_id
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to upsert transaction', {
        transactionId: transaction.id,
        organizationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get transaction statistics for an organization
   * @param {number} organizationId - Internal organization ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Transaction statistics
   */
  async getTransactionStats(organizationId, options = {}) {
    const { fromDate, toDate, currency = null } = options;
    
    try {
      let query = this.getDb()('transactions')
        .where('organization_id', organizationId)
        .andWhere('status', 'success');
        
      // Add date filters if provided
      if (fromDate) {
        query = query.andWhere('purchased_at', '>=', fromDate);
      }
      if (toDate) {
        query = query.andWhere('purchased_at', '<=', toDate);
      }
      
      // Add currency filter if provided
      if (currency) {
        query = query.andWhere('currency', currency);
      }

      const stats = await query.select([
        this.getDb().raw('COUNT(*) as total_transactions'),
        this.getDb().raw('COUNT(DISTINCT supporter_id) as unique_supporters'),
        this.getDb().raw('COUNT(DISTINCT campaign_id) as unique_campaigns'),
        this.getDb().raw('SUM(total_gross_amount) as total_gross_revenue'),
        this.getDb().raw('SUM(donation_gross_amount) as total_donation_amount'),
        this.getDb().raw('SUM(fees_amount) as total_fees'),
        this.getDb().raw('SUM(donation_net_amount) as total_net_amount'),
        this.getDb().raw('AVG(total_gross_amount) as avg_transaction_amount'),
        this.getDb().raw('MIN(total_gross_amount) as min_transaction_amount'),
        this.getDb().raw('MAX(total_gross_amount) as max_transaction_amount'),
        this.getDb().raw('MIN(purchased_at) as earliest_transaction'),
        this.getDb().raw('MAX(purchased_at) as latest_transaction')
      ]).first();

      // Get currency breakdown
      const currencyBreakdown = await this.getDb()('transactions')
        .where('organization_id', organizationId)
        .andWhere('status', 'success')
        .modify(qb => {
          if (fromDate) qb.andWhere('purchased_at', '>=', fromDate);
          if (toDate) qb.andWhere('purchased_at', '<=', toDate);
        })
        .groupBy('currency')
        .select([
          'currency',
          this.getDb().raw('COUNT(*) as transaction_count'),
          this.getDb().raw('SUM(total_gross_amount) as total_amount')
        ])
        .orderBy('total_amount', 'desc');

      // Get top campaigns by revenue
      const topCampaigns = await this.getDb()('transactions')
        .leftJoin('campaigns', 'transactions.campaign_id', 'campaigns.id')
        .where('transactions.organization_id', organizationId)
        .andWhere('transactions.status', 'success')
        .modify(qb => {
          if (fromDate) qb.andWhere('transactions.purchased_at', '>=', fromDate);
          if (toDate) qb.andWhere('transactions.purchased_at', '<=', toDate);
        })
        .groupBy('transactions.campaign_id', 'campaigns.name')
        .select([
          'transactions.campaign_id',
          'campaigns.name as campaign_name',
          this.getDb().raw('COUNT(*) as transaction_count'),
          this.getDb().raw('SUM(transactions.total_gross_amount) as total_revenue')
        ])
        .orderBy('total_revenue', 'desc')
        .limit(10);

      return {
        summary: {
          totalTransactions: parseInt(stats.total_transactions),
          uniqueSupporters: parseInt(stats.unique_supporters),
          uniqueCampaigns: parseInt(stats.unique_campaigns),
          totalGrossRevenue: parseFloat(stats.total_gross_revenue || 0),
          totalDonationAmount: parseFloat(stats.total_donation_amount || 0),
          totalFees: parseFloat(stats.total_fees || 0),
          totalNetAmount: parseFloat(stats.total_net_amount || 0),
          avgTransactionAmount: parseFloat(stats.avg_transaction_amount || 0),
          minTransactionAmount: parseFloat(stats.min_transaction_amount || 0),
          maxTransactionAmount: parseFloat(stats.max_transaction_amount || 0),
          earliestTransaction: stats.earliest_transaction,
          latestTransaction: stats.latest_transaction
        },
        currencyBreakdown: currencyBreakdown.map(curr => ({
          currency: curr.currency,
          transactionCount: parseInt(curr.transaction_count),
          totalAmount: parseFloat(curr.total_amount)
        })),
        topCampaigns: topCampaigns.map(camp => ({
          campaignId: camp.campaign_id,
          campaignName: camp.campaign_name,
          transactionCount: parseInt(camp.transaction_count),
          totalRevenue: parseFloat(camp.total_revenue)
        })),
        filters: {
          organizationId,
          fromDate,
          toDate,
          currency
        },
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to get transaction statistics', {
        organizationId,
        options,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get transactions for a specific supporter
   * @param {number} organizationId - Internal organization ID
   * @param {number} supporterId - Supporter ID (Classy ID)
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Supporter transactions
   */
  async getSupporterTransactions(organizationId, supporterId, options = {}) {
    const { limit = 100, offset = 0, includeRecurring = true } = options;
    
    try {
      let query = this.getDb()('transactions')
        .where('organization_id', organizationId)
        .andWhere('supporter_id', supporterId)
        .orderBy('purchased_at', 'desc')
        .limit(limit)
        .offset(offset);

      if (!includeRecurring) {
        query = query.whereNull('recurring_plan_id');
      }

      const transactions = await query.select('*');

      // Get transaction summary for this supporter
      const summary = await this.getDb()('transactions')
        .where('organization_id', organizationId)
        .andWhere('supporter_id', supporterId)
        .andWhere('status', 'success')
        .select([
          this.getDb().raw('COUNT(*) as total_count'),
          this.getDb().raw('SUM(total_gross_amount) as total_amount'),
          this.getDb().raw('AVG(total_gross_amount) as avg_amount'),
          this.getDb().raw('MIN(purchased_at) as first_transaction'),
          this.getDb().raw('MAX(purchased_at) as last_transaction')
        ])
        .first();

      return {
        transactions: transactions.map(t => ({
          ...t,
          total_gross_amount: parseFloat(t.total_gross_amount),
          donation_gross_amount: parseFloat(t.donation_gross_amount),
          fees_amount: parseFloat(t.fees_amount),
          donation_net_amount: parseFloat(t.donation_net_amount)
        })),
        summary: {
          totalCount: parseInt(summary.total_count),
          totalAmount: parseFloat(summary.total_amount || 0),
          avgAmount: parseFloat(summary.avg_amount || 0),
          firstTransaction: summary.first_transaction,
          lastTransaction: summary.last_transaction
        },
        pagination: {
          limit,
          offset,
          hasMore: transactions.length === limit
        }
      };

    } catch (error) {
      this.logger.error('Failed to get supporter transactions', {
        organizationId,
        supporterId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Enhanced health check including transaction-specific metrics
   * @param {number} orgId - Internal organization ID
   * @returns {Promise<Object>} Enhanced health check result
   */
  async healthCheck(orgId) {
    const baseHealth = await super.healthCheck(orgId);

    try {
      // Add transaction-specific health metrics
      const transactionStats = await this.getTransactionStats(orgId);

      baseHealth.transactionMetrics = {
        ...transactionStats.summary,
        currencyCount: transactionStats.currencyBreakdown.length,
        primaryCurrency: transactionStats.currencyBreakdown[0]?.currency || null,
        activeCampaigns: transactionStats.topCampaigns.length
      };

      // Add data quality metrics
      const qualityStats = await this.getDb()('transactions')
        .where('organization_id', orgId)
        .select([
          this.getDb().raw('COUNT(*) as total_transactions'),
          this.getDb().raw('COUNT(CASE WHEN supporter_id IS NOT NULL THEN 1 END) as with_supporter'),
          this.getDb().raw('COUNT(CASE WHEN campaign_id IS NOT NULL THEN 1 END) as with_campaign'),
          this.getDb().raw('COUNT(CASE WHEN billing_city IS NOT NULL THEN 1 END) as with_billing_info'),
          this.getDb().raw('COUNT(CASE WHEN currency != ? THEN 1 END) as non_usd_transactions', ['USD'])
        ])
        .first();

      baseHealth.dataQuality = {
        supporterLinkage: qualityStats.total_transactions > 0 
          ? (qualityStats.with_supporter / qualityStats.total_transactions * 100).toFixed(1) + '%'
          : '0%',
        campaignLinkage: qualityStats.total_transactions > 0 
          ? (qualityStats.with_campaign / qualityStats.total_transactions * 100).toFixed(1) + '%'
          : '0%',
        billingDataCapture: qualityStats.total_transactions > 0 
          ? (qualityStats.with_billing_info / qualityStats.total_transactions * 100).toFixed(1) + '%'
          : '0%',
        multiCurrencyTransactions: parseInt(qualityStats.non_usd_transactions)
      };

    } catch (error) {
      baseHealth.transactionMetricsError = error.message;
    }

    return baseHealth;
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

    // Recalculate lifetime stats for affected supporters if requested
    if (recalculateStats && syncResults.successful > 0) {
      this.logger.info('Recalculating lifetime stats for supporters with new transactions');
      
      try {
        // Get unique supporter IDs from synced transactions
        const affectedSupporters = await this.getDb()('transactions')
          .whereIn('id', syncResults.processedIds)
          .distinct('supporter_id')
          .whereNotNull('supporter_id')
          .pluck('supporter_id');
        
        if (affectedSupporters.length > 0) {
          // Import supporters sync to access recalculation method
          const { supportersSync } = require('./supporters');
          
          const statsResults = await supportersSync.recalculateLifetimeStats(
            orgId, 
            affectedSupporters
          );
          
          syncResults.lifetimeStats = {
            ...statsResults,
            affectedSupporters: affectedSupporters.length
          };
          
          this.logger.info('Lifetime stats updated for supporters', {
            affectedSupporters: affectedSupporters.length,
            totalLifetimeAmount: statsResults.totalLifetimeAmount
          });
        }
        
      } catch (error) {
        this.logger.warn('Lifetime stats recalculation failed', { error: error.message });
        syncResults.lifetimeStatsError = error.message;
      }
    }

    return syncResults;
  }
}

// Export singleton instance
const transactionsSync = new TransactionsSync();

module.exports = {
  TransactionsSync,
  transactionsSync
};