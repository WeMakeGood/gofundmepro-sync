const logger = require('../../utils/logger');

class CampaignSync {
  static async incrementalSync(api, db, params = {}) {
    const stats = { totalRecords: 0, successfulRecords: 0, failedRecords: 0 };
    
    try {
      const updatedSince = params.updated_since;
      const batchSize = params.batch_size || 100;
      const organizationId = params.organization_id;
      const classyOrganizationId = params.classy_organization_id;
      
      logger.info('Starting incremental campaign sync', { updatedSince, batchSize, organizationId, classyOrganizationId });
      
      // Get campaigns - fallback to client-side filtering due to API limitations
      const allCampaigns = await api.getCampaigns({
        per_page: Math.min(batchSize, 100),
        sort: 'updated_at:desc'
      }, classyOrganizationId);
      
      // Filter client-side for campaigns updated since last sync
      const campaigns = allCampaigns.filter(campaign => {
        return new Date(campaign.updated_at) > updatedSince;
      });
      
      stats.totalRecords = campaigns.length;
      
      logger.info(`Found ${campaigns.length} campaigns updated since ${updatedSince} (client-side filtered from ${allCampaigns.length} total)`);
      
      for (const campaign of campaigns) {
        try {
          await this.upsertCampaign(db, campaign, organizationId);
          stats.successfulRecords++;
        } catch (error) {
          stats.failedRecords++;
          logger.error('Failed to sync campaign:', {
            campaignId: campaign.id,
            error: error.message
          });
        }
      }
      
      return stats;
    } catch (error) {
      logger.error('Incremental campaign sync failed:', error);
      throw error;
    }
  }

  static async fullSync(api, db, params = {}) {
    const stats = { totalRecords: 0, successfulRecords: 0, failedRecords: 0 };
    
    try {
      const batchSize = params.batch_size || 100;
      const organizationId = params.organization_id;
      const classyOrganizationId = params.classy_organization_id;
      
      logger.info('Starting full campaign sync', { batchSize, organizationId, classyOrganizationId });
      
      // Get all campaigns
      const campaigns = await api.getCampaigns({
        per_page: batchSize
      }, classyOrganizationId);
      
      stats.totalRecords = campaigns.length;
      
      for (const campaign of campaigns) {
        try {
          await this.upsertCampaign(db, campaign, organizationId);
          stats.successfulRecords++;
        } catch (error) {
          stats.failedRecords++;
          logger.error('Failed to sync campaign:', {
            campaignId: campaign.id,
            error: error.message
          });
        }
      }
      
      return stats;
    } catch (error) {
      logger.error('Full campaign sync failed:', error);
      throw error;
    }
  }

  static async syncSingle(api, db, campaignId) {
    try {
      logger.info('Syncing single campaign', { campaignId });
      
      const campaign = await api.getCampaign(campaignId);
      await this.upsertCampaign(db, campaign);
      
      return { success: true, campaignId };
    } catch (error) {
      logger.error('Single campaign sync failed:', {
        campaignId,
        error: error.message
      });
      throw error;
    }
  }

  static async upsertCampaign(db, campaignData, organizationId) {
    const {
      id,
      organization_id: apiOrganizationId,
      name,
      status,
      goal,
      total_raised = null,
      donor_count = null,
      type, // API field name (was campaign_type in old schema)
      started_at, // API field name (was start_date in old schema)  
      ended_at, // API field name (was end_date in old schema)
      created_at,
      updated_at
    } = campaignData;

    // Use the organization_id from sync params (our local organization)
    const localOrganizationId = organizationId;

    const query = db.type === 'sqlite' ? `
      INSERT OR REPLACE INTO campaigns (
        classy_id, organization_id, name, status, goal, total_raised,
        donor_count, type, started_at, ended_at, custom_fields,
        created_at, updated_at, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ` : `
      INSERT INTO campaigns (
        classy_id, organization_id, name, status, goal, total_raised,
        donor_count, type, started_at, ended_at, custom_fields,
        created_at, updated_at, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        organization_id = VALUES(organization_id),
        name = VALUES(name),
        status = VALUES(status),
        goal = VALUES(goal),
        total_raised = VALUES(total_raised),
        donor_count = VALUES(donor_count),
        type = VALUES(type),
        started_at = VALUES(started_at),
        ended_at = VALUES(ended_at),
        custom_fields = VALUES(custom_fields),
        updated_at = VALUES(updated_at),
        last_sync_at = VALUES(last_sync_at)
    `;

    // Helper function to convert timestamp to MySQL format
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return null;
      // Convert "2020-01-09T18:13:11+0000" to "2020-01-09 18:13:11"
      return timestamp.replace(/T/, ' ').replace(/\+\d{4}$/, '').replace(/Z$/, '');
    };

    const params = [
      id,
      localOrganizationId,
      name,
      status,
      goal,
      total_raised,
      donor_count,
      type, // API field (was campaign_type column)
      formatTimestamp(started_at), // API field (was start_date column)
      formatTimestamp(ended_at), // API field (was end_date column)
      JSON.stringify({}), // custom_fields - not available in basic API response
      formatTimestamp(created_at),
      formatTimestamp(updated_at),
      formatTimestamp(new Date().toISOString())
    ];

    await db.query(query, params);
    
    logger.debug('Campaign upserted', { campaignId: id });
  }

  static async getCampaignByClassyId(db, classyId) {
    const query = 'SELECT * FROM campaigns WHERE classy_id = ?';
    const result = await db.query(query, [classyId]);
    return result.length > 0 ? result[0] : null;
  }

  static async getActiveCampaigns(db) {
    const query = 'SELECT * FROM campaigns WHERE status = "active" ORDER BY created_at DESC';
    return await db.query(query);
  }

  static async getCampaignsByOrganization(db, organizationId) {
    const query = 'SELECT * FROM campaigns WHERE organization_id = ? ORDER BY created_at DESC';
    return await db.query(query, [organizationId]);
  }

  static async getCampaignPerformance(db, campaignId) {
    const performanceQuery = `
      SELECT 
        c.name,
        c.goal,
        c.total_raised,
        c.donor_count,
        COUNT(DISTINCT t.id) as transaction_count,
        SUM(CASE WHEN t.status = 'successful' THEN t.gross_amount ELSE 0 END) as calculated_total,
        COUNT(DISTINCT t.supporter_id) as unique_donors,
        AVG(CASE WHEN t.status = 'successful' THEN t.gross_amount ELSE NULL END) as avg_donation,
        COUNT(DISTINCT rp.id) as recurring_plans,
        SUM(CASE WHEN rp.status = 'active' THEN rp.amount ELSE 0 END) as monthly_recurring
      FROM campaigns c
      LEFT JOIN transactions t ON c.id = t.campaign_id
      LEFT JOIN recurring_plans rp ON c.id = rp.campaign_id
      WHERE c.id = ?
      GROUP BY c.id
    `;
    
    const result = await db.query(performanceQuery, [campaignId]);
    return result.length > 0 ? result[0] : null;
  }

  static async getCampaignDonationTrends(db, campaignId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const trendsQuery = `
      SELECT 
        DATE(t.purchased_at) as donation_date,
        COUNT(*) as transaction_count,
        SUM(CASE WHEN t.status = 'successful' THEN t.gross_amount ELSE 0 END) as daily_total,
        COUNT(DISTINCT t.supporter_id) as unique_donors
      FROM transactions t
      WHERE t.campaign_id = ?
      AND t.purchased_at >= ?
      AND t.status = 'successful'
      GROUP BY DATE(t.purchased_at)
      ORDER BY donation_date DESC
    `;
    
    return await db.query(trendsQuery, [campaignId, startDate.toISOString()]);
  }

  static async getTopCampaignsByRaised(db, limit = 10) {
    const query = `
      SELECT 
        c.*,
        COUNT(DISTINCT t.id) as transaction_count,
        COUNT(DISTINCT t.supporter_id) as unique_donors,
        COUNT(DISTINCT rp.id) as recurring_plans
      FROM campaigns c
      LEFT JOIN transactions t ON c.id = t.campaign_id AND t.status = 'successful'
      LEFT JOIN recurring_plans rp ON c.id = rp.campaign_id AND rp.status = 'active'
      GROUP BY c.id
      ORDER BY c.total_raised DESC
      LIMIT ?
    `;
    
    return await db.query(query, [limit]);
  }

  static async updateCampaignStats(db, campaignId) {
    try {
      // Calculate stats from transactions
      const statsQuery = `
        SELECT 
          COUNT(CASE WHEN status = 'successful' THEN 1 END) as successful_transactions,
          SUM(CASE WHEN status = 'successful' THEN gross_amount ELSE 0 END) as calculated_total,
          COUNT(DISTINCT CASE WHEN status = 'successful' THEN supporter_id END) as unique_donors
        FROM transactions 
        WHERE campaign_id = ?
      `;
      
      const result = await db.query(statsQuery, [campaignId]);
      
      if (result.length > 0) {
        const stats = result[0];
        
        const updateQuery = `
          UPDATE campaigns 
          SET total_raised = ?,
              donor_count = ?,
              updated_at = ?,
              last_sync_at = ?
          WHERE id = ?
        `;
        
        await db.query(updateQuery, [
          stats.calculated_total || 0,
          stats.unique_donors || 0,
          new Date().toISOString(),
          new Date().toISOString(),
          campaignId
        ]);
        
        logger.debug('Campaign stats updated', { campaignId });
      }
    } catch (error) {
      logger.warn('Failed to update campaign stats:', {
        campaignId,
        error: error.message
      });
    }
  }
}

module.exports = CampaignSync;