/**
 * Recurring Plans Entity Sync
 * 
 * Handles synchronization of recurring donation plan data from Classy API
 * Includes subscription management and lifecycle tracking
 */

const { BaseEntitySync } = require('../../core/base-entity-sync');

class RecurringPlansSync extends BaseEntitySync {
  constructor() {
    super('recurring-plans');
  }

  /**
   * Get database table name
   * @returns {string} Table name
   */
  getTableName() {
    return 'recurring_plans';
  }

  /**
   * Fetch recurring plans from Classy API
   * @param {number} classyOrgId - Classy organization ID
   * @param {Object} options - Fetch options
   * @returns {Promise<Array>} Recurring plan records
   */
  async fetchEntities(classyOrgId, options) {
    this.logger.debug('Fetching recurring plans from Classy API', { classyOrgId, options });
    
    return await this.apiClient.getRecurringPlans(classyOrgId, options);
  }

  /**
   * Fetch a single page of recurring plans (for streaming sync)
   * @param {number} classyOrgId - Classy organization ID
   * @param {number} page - Page number to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Page result with recurring plan data
   */
  async fetchSinglePage(classyOrgId, page, options) {
    const { updatedSince, filters = [] } = options;
    const endpoint = `/organizations/${classyOrgId}/recurring-donation-plans`;
    
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

    this.logger.debug('Fetching single page of recurring plans', { 
      classyOrgId, 
      page, 
      filters: filters.length 
    });
    
    return await this.apiClient.fetchSinglePage(endpoint, page, params);
  }

  /**
   * Upsert recurring plan into database with validated field mapping
   * @param {Object} recurringPlan - Recurring plan data from Classy API
   * @param {number} organizationId - Internal organization ID
   * @returns {Promise<Object>} Database result
   */
  async upsertEntity(recurringPlan, organizationId) {
    const now = new Date();
    
    // Check if referenced supporter exists (if supporter_id is provided)
    if (recurringPlan.supporter_id) {
      const supporterExists = await this.getDb()('supporters')
        .where('id', recurringPlan.supporter_id)
        .andWhere('organization_id', organizationId)
        .first();
        
      if (!supporterExists) {
        this.logger.warn('Skipping recurring plan - supporter not found', {
          recurringPlanId: recurringPlan.id,
          supporterId: recurringPlan.supporter_id,
          organizationId
        });
        return { skipped: true, reason: 'supporter_not_found' };
      }
    }
    
    // Check if referenced campaign exists (if campaign_id is provided)
    if (recurringPlan.campaign_id) {
      const campaignExists = await this.getDb()('campaigns')
        .where('id', recurringPlan.campaign_id)
        .andWhere('organization_id', organizationId)
        .first();
        
      if (!campaignExists) {
        this.logger.warn('Skipping recurring plan - campaign not found', {
          recurringPlanId: recurringPlan.id,
          campaignId: recurringPlan.campaign_id,
          organizationId
        });
        return { skipped: true, reason: 'campaign_not_found' };
      }
    }
    
    // Map status values to our database enum
    const mapStatus = (status) => {
      const statusMap = {
        'active': 'active',
        'cancelled': 'cancelled',
        'canceled': 'cancelled', // API uses US spelling
        'paused': 'paused',
        'completed': 'completed',
        'ended': 'completed',
        'draft': 'paused', // Draft plans are not yet active
        'failing': 'paused', // Failing plans should be paused
        'inactive': 'cancelled',
        'suspended': 'paused'
      };
      return statusMap[status] || 'active';
    };
    
    // Map Classy recurring plan fields to database schema
    const recurringPlanData = {
      id: recurringPlan.id, // Classy ID as primary key
      organization_id: organizationId,
      supporter_id: recurringPlan.supporter_id || null, // FK to supporters.id (Classy ID)
      campaign_id: recurringPlan.campaign_id || null, // FK to campaigns.id (Classy ID)
      
      // Plan details (CORRECTED field names from API validation)
      status: mapStatus(recurringPlan.status),
      amount: parseFloat(recurringPlan.donation_amount || 0), // API field: donation_amount
      frequency: recurringPlan.frequency || 'monthly',
      
      // Payment scheduling (CORRECTED field name from API validation)
      next_payment_date: recurringPlan.next_processing_date 
        ? new Date(recurringPlan.next_processing_date) 
        : null, // API field: next_processing_date
      
      // Timestamps
      created_at: recurringPlan.created_at ? new Date(recurringPlan.created_at) : now,
      updated_at: now,
      last_sync_at: now
    };

    try {
      // Use ON DUPLICATE KEY UPDATE for MySQL compatibility
      const result = await this.getDb()(this.getTableName())
        .insert(recurringPlanData)
        .onConflict('id')
        .merge({
          ...recurringPlanData,
          created_at: this.getDb().raw('COALESCE(created_at, ?)', [recurringPlanData.created_at])
        });

      this.logger.debug('Recurring plan upserted', {
        recurringPlanId: recurringPlan.id,
        organizationId,
        supporterId: recurringPlan.supporter_id,
        campaignId: recurringPlan.campaign_id,
        amount: recurringPlan.amount,
        frequency: recurringPlan.frequency,
        status: recurringPlan.status,
        mappedStatus: recurringPlanData.status
      });

      return result;

    } catch (error) {
      this.logger.error('Failed to upsert recurring plan', {
        recurringPlanId: recurringPlan.id,
        organizationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get recurring donation statistics
   * @param {number} organizationId - Internal organization ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Recurring donation statistics
   */
  async getRecurringStats(organizationId, options = {}) {
    const { includeInactive = false } = options;
    
    try {
      let query = this.getDb()('recurring_plans')
        .where('organization_id', organizationId);
        
      if (!includeInactive) {
        query = query.andWhere('status', 'active');
      }

      const stats = await query.select([
        this.getDb().raw('COUNT(*) as total_plans'),
        this.getDb().raw('COUNT(CASE WHEN status = ? THEN 1 END) as active_plans', ['active']),
        this.getDb().raw('COUNT(CASE WHEN status = ? THEN 1 END) as cancelled_plans', ['cancelled']),
        this.getDb().raw('COUNT(CASE WHEN status = ? THEN 1 END) as paused_plans', ['paused']),
        this.getDb().raw('COUNT(CASE WHEN status = ? THEN 1 END) as completed_plans', ['completed']),
        this.getDb().raw('COUNT(DISTINCT supporter_id) as unique_supporters'),
        this.getDb().raw('COUNT(DISTINCT campaign_id) as unique_campaigns'),
        this.getDb().raw('SUM(CASE WHEN status = ? THEN amount ELSE 0 END) as total_monthly_amount', ['active']),
        this.getDb().raw('AVG(CASE WHEN status = ? THEN amount END) as avg_monthly_amount', ['active']),
        this.getDb().raw('MIN(amount) as min_amount'),
        this.getDb().raw('MAX(amount) as max_amount')
      ]).first();

      // Get frequency breakdown
      const frequencyBreakdown = await this.getDb()('recurring_plans')
        .where('organization_id', organizationId)
        .modify(qb => {
          if (!includeInactive) {
            qb.andWhere('status', 'active');
          }
        })
        .groupBy('frequency')
        .select([
          'frequency',
          this.getDb().raw('COUNT(*) as plan_count'),
          this.getDb().raw('SUM(amount) as total_amount')
        ])
        .orderBy('total_amount', 'desc');

      // Get campaign breakdown
      const campaignBreakdown = await this.getDb()('recurring_plans')
        .leftJoin('campaigns', 'recurring_plans.campaign_id', 'campaigns.id')
        .where('recurring_plans.organization_id', organizationId)
        .modify(qb => {
          if (!includeInactive) {
            qb.andWhere('recurring_plans.status', 'active');
          }
        })
        .groupBy('recurring_plans.campaign_id', 'campaigns.name')
        .select([
          'recurring_plans.campaign_id',
          'campaigns.name as campaign_name',
          this.getDb().raw('COUNT(*) as plan_count'),
          this.getDb().raw('SUM(recurring_plans.amount) as total_amount')
        ])
        .orderBy('total_amount', 'desc')
        .limit(10);

      // Get upcoming payments (next 30 days)
      const upcomingPayments = await this.getDb()('recurring_plans')
        .where('organization_id', organizationId)
        .andWhere('status', 'active')
        .andWhere('next_payment_date', '>=', new Date())
        .andWhere('next_payment_date', '<=', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
        .select([
          this.getDb().raw('COUNT(*) as upcoming_payment_count'),
          this.getDb().raw('SUM(amount) as upcoming_payment_amount')
        ])
        .first();

      // Calculate projected annual revenue
      const projectedAnnualRevenue = frequencyBreakdown.reduce((total, freq) => {
        const multiplier = freq.frequency === 'monthly' ? 12 : 
                          freq.frequency === 'quarterly' ? 4 : 
                          freq.frequency === 'yearly' ? 1 : 0;
        return total + (parseFloat(freq.total_amount) * multiplier);
      }, 0);

      return {
        summary: {
          totalPlans: parseInt(stats.total_plans),
          activePlans: parseInt(stats.active_plans),
          cancelledPlans: parseInt(stats.cancelled_plans),
          pausedPlans: parseInt(stats.paused_plans),
          completedPlans: parseInt(stats.completed_plans),
          uniqueSupporters: parseInt(stats.unique_supporters),
          uniqueCampaigns: parseInt(stats.unique_campaigns),
          totalMonthlyAmount: parseFloat(stats.total_monthly_amount || 0),
          avgMonthlyAmount: parseFloat(stats.avg_monthly_amount || 0),
          minAmount: parseFloat(stats.min_amount || 0),
          maxAmount: parseFloat(stats.max_amount || 0),
          projectedAnnualRevenue: parseFloat(projectedAnnualRevenue.toFixed(2)),
          
          // Retention metrics
          retentionRate: stats.total_plans > 0 
            ? (stats.active_plans / stats.total_plans * 100).toFixed(1) + '%'
            : '0%',
          churnRate: stats.total_plans > 0 
            ? (stats.cancelled_plans / stats.total_plans * 100).toFixed(1) + '%'
            : '0%'
        },
        frequencyBreakdown: frequencyBreakdown.map(freq => ({
          frequency: freq.frequency,
          planCount: parseInt(freq.plan_count),
          totalAmount: parseFloat(freq.total_amount),
          projectedAnnual: freq.frequency === 'monthly' ? parseFloat(freq.total_amount) * 12 :
                          freq.frequency === 'quarterly' ? parseFloat(freq.total_amount) * 4 :
                          freq.frequency === 'yearly' ? parseFloat(freq.total_amount) : 0
        })),
        campaignBreakdown: campaignBreakdown.map(camp => ({
          campaignId: camp.campaign_id,
          campaignName: camp.campaign_name,
          planCount: parseInt(camp.plan_count),
          totalAmount: parseFloat(camp.total_amount)
        })),
        upcomingPayments: {
          count: parseInt(upcomingPayments.upcoming_payment_count || 0),
          amount: parseFloat(upcomingPayments.upcoming_payment_amount || 0),
          period: 'next 30 days'
        },
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to get recurring donation statistics', {
        organizationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get recurring plans for a specific supporter
   * @param {number} organizationId - Internal organization ID
   * @param {number} supporterId - Supporter ID (Classy ID)
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Supporter's recurring plans
   */
  async getSupporterRecurringPlans(organizationId, supporterId, options = {}) {
    const { includeInactive = false } = options;
    
    try {
      let query = this.getDb()('recurring_plans')
        .leftJoin('campaigns', 'recurring_plans.campaign_id', 'campaigns.id')
        .where('recurring_plans.organization_id', organizationId)
        .andWhere('recurring_plans.supporter_id', supporterId);
        
      if (!includeInactive) {
        query = query.andWhere('recurring_plans.status', 'active');
      }

      const plans = await query
        .select(
          'recurring_plans.*',
          'campaigns.name as campaign_name',
          'campaigns.type as campaign_type'
        )
        .orderBy('recurring_plans.created_at', 'desc');

      // Calculate supporter recurring totals
      const totals = plans.reduce((acc, plan) => {
        if (plan.status === 'active') {
          const amount = parseFloat(plan.amount);
          if (plan.frequency === 'monthly') {
            acc.totalMonthly += amount;
            acc.projectedAnnual += amount * 12;
          } else if (plan.frequency === 'quarterly') {
            acc.totalQuarterly += amount;
            acc.projectedAnnual += amount * 4;
          } else if (plan.frequency === 'yearly') {
            acc.totalYearly += amount;
            acc.projectedAnnual += amount;
          }
        }
        return acc;
      }, {
        totalMonthly: 0,
        totalQuarterly: 0,
        totalYearly: 0,
        projectedAnnual: 0
      });

      return {
        plans: plans.map(plan => ({
          ...plan,
          amount: parseFloat(plan.amount)
        })),
        summary: {
          totalPlans: plans.length,
          activePlans: plans.filter(p => p.status === 'active').length,
          totalMonthly: parseFloat(totals.totalMonthly.toFixed(2)),
          totalQuarterly: parseFloat(totals.totalQuarterly.toFixed(2)),
          totalYearly: parseFloat(totals.totalYearly.toFixed(2)),
          projectedAnnual: parseFloat(totals.projectedAnnual.toFixed(2))
        }
      };

    } catch (error) {
      this.logger.error('Failed to get supporter recurring plans', {
        organizationId,
        supporterId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Enhanced health check including recurring plan metrics
   * @param {number} orgId - Internal organization ID
   * @returns {Promise<Object>} Enhanced health check result
   */
  async healthCheck(orgId) {
    const baseHealth = await super.healthCheck(orgId);

    try {
      // Add recurring plan specific health metrics
      const recurringStats = await this.getRecurringStats(orgId);

      baseHealth.recurringMetrics = {
        ...recurringStats.summary,
        primaryFrequency: recurringStats.frequencyBreakdown[0]?.frequency || null,
        activeRecurringRate: baseHealth.database?.recordCount > 0 
          ? (recurringStats.summary.activePlans / baseHealth.database.recordCount * 100).toFixed(1) + '%'
          : '0%'
      };

      // Add plan lifecycle health
      const lifecycleHealth = await this.getDb()('recurring_plans')
        .where('organization_id', orgId)
        .select([
          this.getDb().raw('COUNT(*) as total'),
          this.getDb().raw('COUNT(CASE WHEN next_payment_date < ? THEN 1 END) as overdue', [new Date()]),
          this.getDb().raw('COUNT(CASE WHEN next_payment_date BETWEEN ? AND ? THEN 1 END) as due_soon', [
            new Date(), 
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          ])
        ])
        .first();

      baseHealth.planHealth = {
        totalPlans: parseInt(lifecycleHealth.total),
        overduePlans: parseInt(lifecycleHealth.overdue),
        dueSoonPlans: parseInt(lifecycleHealth.due_soon),
        healthyPlans: parseInt(lifecycleHealth.total) - parseInt(lifecycleHealth.overdue)
      };

    } catch (error) {
      baseHealth.recurringMetricsError = error.message;
    }

    return baseHealth;
  }

  /**
   * Perform sync with automatic supporter stats recalculation
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

    // Recalculate monthly recurring amounts for affected supporters if requested
    if (recalculateStats && syncResults.successful > 0) {
      this.logger.info('Recalculating monthly recurring amounts for supporters with plan changes');
      
      try {
        // Get unique supporter IDs from synced recurring plans
        const affectedSupporters = await this.getDb()('recurring_plans')
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
          
          syncResults.recurringStats = {
            ...statsResults,
            affectedSupporters: affectedSupporters.length
          };
          
          this.logger.info('Monthly recurring amounts updated for supporters', {
            affectedSupporters: affectedSupporters.length,
            totalMonthlyRecurring: statsResults.totalMonthlyRecurring || 'unknown'
          });
        }
        
      } catch (error) {
        this.logger.warn('Recurring stats recalculation failed', { error: error.message });
        syncResults.recurringStatsError = error.message;
      }
    }

    return syncResults;
  }
}

// Export singleton instance
const recurringPlansSync = new RecurringPlansSync();

module.exports = {
  RecurringPlansSync,
  recurringPlansSync
};