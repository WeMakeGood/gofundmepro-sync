/**
 * Campaigns Entity Sync
 * 
 * Handles synchronization of campaign data from Classy API
 * Includes performance metrics and validated field mapping
 */

const { BaseEntitySync } = require('../../core/base-entity-sync');

class CampaignsSync extends BaseEntitySync {
  constructor() {
    super('campaigns');
  }

  /**
   * Get database table name
   * @returns {string} Table name
   */
  getTableName() {
    return 'campaigns';
  }

  /**
   * Fetch campaigns from Classy API
   * @param {number} classyOrgId - Classy organization ID
   * @param {Object} options - Fetch options
   * @returns {Promise<Array>} Campaign records
   */
  async fetchEntities(classyOrgId, options) {
    this.logger.debug('Fetching campaigns from Classy API', { classyOrgId, options });
    
    return await this.apiClient.getCampaigns(classyOrgId, options);
  }

  /**
   * Fetch a single page of campaigns (for streaming sync)
   * @param {number} classyOrgId - Classy organization ID
   * @param {number} page - Page number to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Page result with campaign data
   */
  async fetchSinglePage(classyOrgId, page, options) {
    const { updatedSince, filters = [] } = options;
    const endpoint = `/organizations/${classyOrgId}/campaigns`;
    
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

    this.logger.debug('Fetching single page of campaigns', { 
      classyOrgId, 
      page, 
      filters: filters.length 
    });
    
    return await this.apiClient.fetchSinglePage(endpoint, page, params);
  }

  /**
   * Upsert campaign into database with validated field mapping
   * @param {Object} campaign - Campaign data from Classy API
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Object>} Database result
   */
  async upsertEntity(campaign, organizationId) {
    const now = new Date();
    
    // Map status values to our database enum
    const mapStatus = (status) => {
      const statusMap = {
        'active': 'active',
        'inactive': 'inactive', 
        'completed': 'completed',
        'draft': 'draft',
        'unpublished': 'draft',
        'deactivated': 'inactive',
        'cancelled': 'inactive',
        'paused': 'inactive'
      };
      return statusMap[status] || 'active';
    };

    // Map Classy campaign fields to database schema (VALIDATED field names)
    const campaignData = {
      id: campaign.id, // Classy ID as primary key
      organization_id: organizationId,
      name: campaign.name || 'Unnamed Campaign',
      status: mapStatus(campaign.status),
      type: campaign.type || null, // VALIDATED: 'type' field exists
      goal: parseFloat(campaign.goal || 0),
      total_raised: parseFloat(campaign.total_raised || 0),
      donors_count: parseInt(campaign.donors_count || 0), // VALIDATED: 'donors_count' field name
      
      // Date fields (VALIDATED field names)
      started_at: campaign.started_at ? new Date(campaign.started_at) : null,
      ended_at: campaign.ended_at ? new Date(campaign.ended_at) : null,
      
      // Description and additional info
      description: campaign.description || null,
      
      // Timestamps - PRESERVE Classy API timestamps for change detection
      created_at: campaign.created_at ? new Date(campaign.created_at) : now,
      updated_at: campaign.updated_at ? new Date(campaign.updated_at) : now,
      last_sync_at: now
    };

    try {
      // Use ON DUPLICATE KEY UPDATE for MySQL compatibility
      const result = await this.getDb()(this.getTableName())
        .insert(campaignData)
        .onConflict('id')
        .merge({
          ...campaignData,
          created_at: this.getDb().raw('COALESCE(created_at, ?)', [campaignData.created_at])
        });

      this.logger.debug('Campaign upserted', {
        campaignId: campaign.id,
        organizationId,
        name: campaign.name,
        type: campaign.type,
        goal: campaign.goal,
        totalRaised: campaign.total_raised
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to upsert campaign', {
        campaignId: campaign.id,
        organizationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get campaign performance metrics
   * @param {number} organizationId - Internal organization ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Campaign performance data
   */
  async getCampaignPerformance(organizationId, options = {}) {
    const { campaignId = null, includeInactive = false } = options;
    
    try {
      let query = this.getDb()('campaigns')
        .where('organization_id', organizationId);
        
      if (campaignId) {
        query = query.andWhere('id', campaignId);
      }
      
      if (!includeInactive) {
        query = query.andWhere('status', 'active');
      }

      const campaigns = await query.select('*');
      
      // Enhance with calculated metrics and transaction data
      const enhancedCampaigns = await Promise.all(
        campaigns.map(async (campaign) => {
          // Get transaction-based metrics
          const transactionStats = await this.getDb()('transactions')
            .where('organization_id', organizationId)
            .andWhere('campaign_id', campaign.id)
            .andWhere('status', 'success')
            .select([
              this.getDb().raw('COUNT(*) as actual_transaction_count'),
              this.getDb().raw('SUM(total_gross_amount) as actual_total_raised'),
              this.getDb().raw('COUNT(DISTINCT supporter_id) as actual_unique_donors'),
              this.getDb().raw('AVG(total_gross_amount) as avg_donation_amount'),
              this.getDb().raw('MIN(purchased_at) as first_donation'),
              this.getDb().raw('MAX(purchased_at) as last_donation')
            ])
            .first();

          // Calculate performance metrics
          const goalPercentage = campaign.goal > 0 
            ? (campaign.total_raised / campaign.goal * 100) 
            : null;
            
          const durationDays = campaign.started_at && campaign.ended_at
            ? Math.ceil((new Date(campaign.ended_at) - new Date(campaign.started_at)) / (1000 * 60 * 60 * 24))
            : null;
            
          const avgDonation = campaign.donors_count > 0 
            ? (campaign.total_raised / campaign.donors_count) 
            : 0;

          // Calculate daily metrics if campaign has duration
          let dailyMetrics = null;
          if (durationDays && durationDays > 0) {
            dailyMetrics = {
              avgDailyRaise: campaign.total_raised / durationDays,
              avgDailyDonors: campaign.donors_count / durationDays,
              daysRemaining: campaign.ended_at 
                ? Math.max(0, Math.ceil((new Date(campaign.ended_at) - new Date()) / (1000 * 60 * 60 * 24)))
                : null
            };
          }

          return {
            ...campaign,
            // Convert numeric fields
            goal: parseFloat(campaign.goal),
            total_raised: parseFloat(campaign.total_raised),
            donors_count: parseInt(campaign.donors_count),
            
            // Performance metrics
            performance: {
              goalPercentage: goalPercentage ? parseFloat(goalPercentage.toFixed(2)) : null,
              avgDonation: parseFloat(avgDonation.toFixed(2)),
              durationDays,
              dailyMetrics,
              
              // Transaction-based validation
              actualTransactionCount: parseInt(transactionStats.actual_transaction_count),
              actualTotalRaised: parseFloat(transactionStats.actual_total_raised || 0),
              actualUniqueDonors: parseInt(transactionStats.actual_unique_donors),
              actualAvgDonation: parseFloat(transactionStats.avg_donation_amount || 0),
              
              // Data consistency check
              dataConsistency: {
                raisedAmountMatch: Math.abs(campaign.total_raised - (transactionStats.actual_total_raised || 0)) < 0.01,
                donorCountMatch: campaign.donors_count === parseInt(transactionStats.actual_unique_donors),
              },
              
              // Activity timeline
              firstDonation: transactionStats.first_donation,
              lastDonation: transactionStats.last_donation
            }
          };
        })
      );

      // Calculate organization-level campaign metrics
      const orgMetrics = {
        totalCampaigns: campaigns.length,
        activeCampaigns: campaigns.filter(c => c.status === 'active').length,
        totalGoal: campaigns.reduce((sum, c) => sum + parseFloat(c.goal || 0), 0),
        totalRaised: campaigns.reduce((sum, c) => sum + parseFloat(c.total_raised || 0), 0),
        totalDonors: campaigns.reduce((sum, c) => sum + parseInt(c.donors_count || 0), 0),
        avgGoalCompletion: campaigns.length > 0
          ? campaigns
              .filter(c => c.goal > 0)
              .reduce((sum, c) => sum + (c.total_raised / c.goal * 100), 0) / campaigns.filter(c => c.goal > 0).length
          : 0
      };

      return {
        campaigns: enhancedCampaigns,
        organizationMetrics: {
          ...orgMetrics,
          avgGoalCompletion: parseFloat(orgMetrics.avgGoalCompletion.toFixed(2))
        },
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to get campaign performance', {
        organizationId,
        campaignId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get top performing campaigns
   * @param {number} organizationId - Internal organization ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Top campaigns by various metrics
   */
  async getTopCampaigns(organizationId, options = {}) {
    const { limit = 10, metric = 'total_raised', includeInactive = false } = options;
    
    const allowedMetrics = ['total_raised', 'donors_count', 'goal_percentage'];
    const sortMetric = allowedMetrics.includes(metric) ? metric : 'total_raised';
    
    try {
      let query = this.getDb()('campaigns')
        .where('organization_id', organizationId);
        
      if (!includeInactive) {
        query = query.andWhere('status', 'active');
      }

      if (sortMetric === 'goal_percentage') {
        // Sort by goal completion percentage
        query = query
          .where('goal', '>', 0)
          .orderByRaw('(total_raised / goal) DESC')
          .select('*', this.getDb().raw('(total_raised / goal * 100) as goal_percentage'));
      } else {
        query = query.orderBy(sortMetric, 'desc');
      }

      const topCampaigns = await query.limit(limit);

      return topCampaigns.map(campaign => ({
        ...campaign,
        goal: parseFloat(campaign.goal),
        total_raised: parseFloat(campaign.total_raised),
        donors_count: parseInt(campaign.donors_count),
        goal_percentage: campaign.goal_percentage ? parseFloat(campaign.goal_percentage.toFixed(2)) : null
      }));

    } catch (error) {
      this.logger.error('Failed to get top campaigns', {
        organizationId,
        metric: sortMetric,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Enhanced health check including campaign-specific metrics
   * @param {number} orgId - Internal organization ID
   * @returns {Promise<Object>} Enhanced health check result
   */
  async healthCheck(orgId) {
    const baseHealth = await super.healthCheck(orgId);

    try {
      // Add campaign-specific health metrics
      const campaignStats = await this.getDb()('campaigns')
        .where('organization_id', orgId)
        .select([
          this.getDb().raw('COUNT(*) as total_campaigns'),
          this.getDb().raw('COUNT(CASE WHEN status = ? THEN 1 END) as active_campaigns', ['active']),
          this.getDb().raw('COUNT(CASE WHEN goal > 0 THEN 1 END) as campaigns_with_goals'),
          this.getDb().raw('COUNT(CASE WHEN total_raised > 0 THEN 1 END) as campaigns_with_donations'),
          this.getDb().raw('SUM(goal) as total_goals'),
          this.getDb().raw('SUM(total_raised) as total_raised'),
          this.getDb().raw('SUM(donors_count) as total_donors'),
          this.getDb().raw('AVG(CASE WHEN goal > 0 THEN (total_raised / goal * 100) END) as avg_goal_completion')
        ])
        .first();

      baseHealth.campaignMetrics = {
        totalCampaigns: parseInt(campaignStats.total_campaigns),
        activeCampaigns: parseInt(campaignStats.active_campaigns),
        campaignsWithGoals: parseInt(campaignStats.campaigns_with_goals),
        campaignsWithDonations: parseInt(campaignStats.campaigns_with_donations),
        totalGoals: parseFloat(campaignStats.total_goals || 0),
        totalRaised: parseFloat(campaignStats.total_raised || 0),
        totalDonors: parseInt(campaignStats.total_donors || 0),
        avgGoalCompletion: parseFloat(campaignStats.avg_goal_completion || 0),
        campaignSuccessRate: campaignStats.total_campaigns > 0 
          ? (campaignStats.campaigns_with_donations / campaignStats.total_campaigns * 100).toFixed(1) + '%'
          : '0%'
      };

      // Add campaign type breakdown
      const typeBreakdown = await this.getDb()('campaigns')
        .where('organization_id', orgId)
        .groupBy('type')
        .select([
          'type',
          this.getDb().raw('COUNT(*) as count'),
          this.getDb().raw('SUM(total_raised) as total_raised')
        ])
        .orderBy('total_raised', 'desc');

      baseHealth.campaignTypes = typeBreakdown.map(type => ({
        type: type.type || 'unknown',
        count: parseInt(type.count),
        totalRaised: parseFloat(type.total_raised || 0)
      }));

    } catch (error) {
      baseHealth.campaignMetricsError = error.message;
    }

    return baseHealth;
  }
}

// Export singleton instance
const campaignsSync = new CampaignsSync();

module.exports = {
  CampaignsSync,
  campaignsSync
};