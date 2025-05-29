const logger = require('../../utils/logger');
const SupporterSync = require('./supporters');

class RecurringPlanSync {
  static async incrementalSync(api, db, params = {}) {
    const stats = { totalRecords: 0, successfulRecords: 0, failedRecords: 0 };
    
    try {
      const updatedSince = params.updated_since;
      const batchSize = params.batch_size || 100;
      const campaignIds = params.campaign_ids || await this.getAllCampaignIds(db);
      
      logger.info('Starting incremental recurring plan sync', { 
        updatedSince, 
        batchSize, 
        campaignCount: campaignIds.length 
      });
      
      for (const campaignId of campaignIds) {
        try {
          // Use filter parameter with encoded ISO8601 date format
          const encodedDate = encodeURIComponent(updatedSince.toISOString());
          const plans = await api.getCampaignRecurringPlans(campaignId, {
            filter: `updated_at>${encodedDate}`,
            per_page: batchSize
          });
          
          stats.totalRecords += plans.length;
          
          for (const plan of plans) {
            try {
              await this.upsertRecurringPlan(db, plan, campaignId);
              stats.successfulRecords++;
            } catch (error) {
              stats.failedRecords++;
              logger.error('Failed to sync recurring plan:', {
                planId: plan.id,
                campaignId,
                error: error.message
              });
            }
          }
        } catch (error) {
          logger.error('Failed to sync recurring plans for campaign:', {
            campaignId,
            error: error.message
          });
        }
      }
      
      return stats;
    } catch (error) {
      logger.error('Incremental recurring plan sync failed:', error);
      throw error;
    }
  }

  static async fullSync(api, db, params = {}) {
    const stats = { totalRecords: 0, successfulRecords: 0, failedRecords: 0 };
    
    try {
      const batchSize = params.batch_size || 100;
      const organizationId = params.organization_id;
      
      logger.info('Starting full recurring plan sync', { 
        batchSize, 
        organizationId 
      });
      
      if (organizationId) {
        // Use organization-level endpoint for full sync
        const plans = await api.getRecurringPlans({
          per_page: batchSize
        }, organizationId);
        
        stats.totalRecords = plans.length;
        
        for (const plan of plans) {
          try {
            await this.upsertRecurringPlan(db, plan);
            stats.successfulRecords++;
          } catch (error) {
            stats.failedRecords++;
            logger.error('Failed to sync recurring plan:', {
              planId: plan.id,
              error: error.message
            });
          }
        }
      } else {
        // Fallback to campaign-based sync if no organization ID
        const campaignIds = params.campaign_ids || await this.getAllCampaignIds(db);
        
        logger.info('Using campaign-based fallback', { 
          campaignCount: campaignIds.length 
        });
        
        for (const campaignId of campaignIds) {
          try {
            const plans = await api.getCampaignRecurringPlans(campaignId, {
              per_page: batchSize
            });
            
            stats.totalRecords += plans.length;
            
            for (const plan of plans) {
              try {
                await this.upsertRecurringPlan(db, plan, campaignId);
                stats.successfulRecords++;
              } catch (error) {
                stats.failedRecords++;
                logger.error('Failed to sync recurring plan:', {
                  planId: plan.id,
                  campaignId,
                  error: error.message
                });
              }
            }
          } catch (error) {
            logger.error('Failed to sync recurring plans for campaign:', {
              campaignId,
              error: error.message
            });
          }
        }
      }
      
      return stats;
    } catch (error) {
      logger.error('Full recurring plan sync failed:', error);
      throw error;
    }
  }

  static async syncSingle(api, db, planId) {
    try {
      logger.info('Syncing single recurring plan', { planId });
      
      const plan = await api.getRecurringPlan(planId);
      await this.upsertRecurringPlan(db, plan);
      
      return { success: true, planId };
    } catch (error) {
      logger.error('Single recurring plan sync failed:', {
        planId,
        error: error.message
      });
      throw error;
    }
  }

  static async upsertRecurringPlan(db, planData, campaignId = null) {
    const {
      id,
      supporter_id,
      campaign_id,
      status,
      frequency,
      donation_amount,
      currency_code,
      next_processing_date,
      canceled_at,
      cancel_reason_text,
      // Note: These fields don't appear to be available in the API response
      // lifetime_value,
      // payment_count,
      created_at,
      updated_at
    } = planData;

    // Get local supporter ID if exists
    let localSupporterId = null;
    if (supporter_id) {
      const supporterQuery = 'SELECT id FROM supporters WHERE classy_id = ?';
      const supporterResult = await db.query(supporterQuery, [supporter_id]);
      localSupporterId = supporterResult.length > 0 ? supporterResult[0].id : null;
    }

    // Get local campaign ID - use from params or from the plan data
    let localCampaignId = campaignId || campaign_id;
    if (localCampaignId) {
      const campaignQuery = 'SELECT id FROM campaigns WHERE classy_id = ?';
      const campaignResult = await db.query(campaignQuery, [localCampaignId]);
      localCampaignId = campaignResult.length > 0 ? campaignResult[0].id : null;
    }

    const query = `
      INSERT INTO recurring_plans (
        classy_id, supporter_id, campaign_id, status, frequency,
        amount, currency, next_payment_date, cancellation_date,
        cancellation_reason, lifetime_value, payment_count,
        created_at, updated_at, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${db.type === 'sqlite' ? 
        'ON CONFLICT(classy_id) DO UPDATE SET' : 
        'ON DUPLICATE KEY UPDATE'
      }
        supporter_id = ${db.type === 'sqlite' ? 'excluded.supporter_id' : 'VALUES(supporter_id)'},
        campaign_id = ${db.type === 'sqlite' ? 'excluded.campaign_id' : 'VALUES(campaign_id)'},
        status = ${db.type === 'sqlite' ? 'excluded.status' : 'VALUES(status)'},
        frequency = ${db.type === 'sqlite' ? 'excluded.frequency' : 'VALUES(frequency)'},
        amount = ${db.type === 'sqlite' ? 'excluded.amount' : 'VALUES(amount)'},
        currency = ${db.type === 'sqlite' ? 'excluded.currency' : 'VALUES(currency)'},
        next_payment_date = ${db.type === 'sqlite' ? 'excluded.next_payment_date' : 'VALUES(next_payment_date)'},
        cancellation_date = ${db.type === 'sqlite' ? 'excluded.cancellation_date' : 'VALUES(cancellation_date)'},
        cancellation_reason = ${db.type === 'sqlite' ? 'excluded.cancellation_reason' : 'VALUES(cancellation_reason)'},
        lifetime_value = ${db.type === 'sqlite' ? 'excluded.lifetime_value' : 'VALUES(lifetime_value)'},
        payment_count = ${db.type === 'sqlite' ? 'excluded.payment_count' : 'VALUES(payment_count)'},
        updated_at = ${db.type === 'sqlite' ? 'excluded.updated_at' : 'VALUES(updated_at)'},
        last_sync_at = ${db.type === 'sqlite' ? 'excluded.last_sync_at' : 'VALUES(last_sync_at)'}
    `;

    const params = [
      id,
      localSupporterId,
      localCampaignId,
      status,
      frequency,
      donation_amount,
      currency_code,
      next_processing_date,
      canceled_at,
      cancel_reason_text,
      null, // lifetime_value - not available in API
      null, // payment_count - not available in API
      created_at,
      updated_at,
      new Date().toISOString()
    ];

    await db.query(query, params);
    
    logger.debug('Recurring plan upserted', { planId: id });
  }

  static async getAllCampaignIds(db) {
    try {
      const query = 'SELECT classy_id FROM campaigns WHERE status = "active"';
      const result = await db.query(query);
      return result.map(row => row.classy_id);
    } catch (error) {
      logger.warn('Failed to get campaign IDs, using empty list:', error);
      return [];
    }
  }

  static async getActivePlans(db, campaignId = null) {
    let query = 'SELECT * FROM recurring_plans WHERE status = "active"';
    const params = [];
    
    if (campaignId) {
      query += ' AND campaign_id = ?';
      params.push(campaignId);
    }
    
    query += ' ORDER BY next_payment_date ASC';
    
    return await db.query(query, params);
  }

  static async getPlansNearingExpiry(db, daysAhead = 30) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    
    const query = `
      SELECT rp.*, s.email_address, s.first_name, s.last_name, c.name as campaign_name
      FROM recurring_plans rp
      LEFT JOIN supporters s ON rp.supporter_id = s.id
      LEFT JOIN campaigns c ON rp.campaign_id = c.id
      WHERE rp.status = 'active' 
      AND rp.next_payment_date <= ?
      ORDER BY rp.next_payment_date ASC
    `;
    
    return await db.query(query, [futureDate.toISOString().split('T')[0]]);
  }

  static async getPlansBySupporter(db, supporterId) {
    const query = `
      SELECT rp.*, c.name as campaign_name
      FROM recurring_plans rp
      LEFT JOIN campaigns c ON rp.campaign_id = c.id
      WHERE rp.supporter_id = ?
      ORDER BY rp.created_at DESC
    `;
    
    return await db.query(query, [supporterId]);
  }

  static async getCancelledPlans(db, startDate, endDate = null) {
    let query = `
      SELECT rp.*, s.email_address, s.first_name, s.last_name, c.name as campaign_name
      FROM recurring_plans rp
      LEFT JOIN supporters s ON rp.supporter_id = s.id
      LEFT JOIN campaigns c ON rp.campaign_id = c.id
      WHERE rp.status = 'cancelled' 
      AND rp.cancellation_date >= ?
    `;
    
    const params = [startDate];
    
    if (endDate) {
      query += ' AND rp.cancellation_date <= ?';
      params.push(endDate);
    }
    
    query += ' ORDER BY rp.cancellation_date DESC';
    
    return await db.query(query, params);
  }

  static async getRecurringPlanStats(db, campaignId = null) {
    let query = `
      SELECT 
        COUNT(*) as total_plans,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_plans,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_plans,
        COUNT(CASE WHEN status = 'paused' THEN 1 END) as paused_plans,
        SUM(CASE WHEN status = 'active' THEN amount ELSE 0 END) as monthly_recurring_amount,
        AVG(CASE WHEN status = 'active' THEN amount ELSE NULL END) as avg_active_amount,
        SUM(lifetime_value) as total_lifetime_value
      FROM recurring_plans
    `;
    
    const params = [];
    
    if (campaignId) {
      query += ' WHERE campaign_id = ?';
      params.push(campaignId);
    }
    
    const result = await db.query(query, params);
    return result.length > 0 ? result[0] : null;
  }
}

module.exports = RecurringPlanSync;