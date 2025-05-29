const logger = require('../../utils/logger');
const SupporterSync = require('./supporters');

class TransactionSync {
  static async incrementalSync(api, db, params = {}) {
    const stats = { totalRecords: 0, successfulRecords: 0, failedRecords: 0 };
    
    try {
      const updatedSince = params.updated_since;
      const batchSize = params.batch_size || 100;
      const campaignIds = params.campaign_ids || await this.getAllCampaignIds(db);
      
      logger.info('Starting incremental transaction sync', { 
        updatedSince, 
        batchSize, 
        campaignCount: campaignIds.length 
      });
      
      for (const campaignId of campaignIds) {
        try {
          // Use filter parameter with unencoded ISO8601 date format in +0000 timezone
          // Use purchased_at for transactions as it's more relevant for financial data
          const formattedDate = updatedSince.toISOString().replace(/\.\d{3}Z$/, '+0000');
          const transactions = await api.getCampaignTransactions(campaignId, {
            filter: `purchased_at>${formattedDate}`,
            with: 'items', // Include transaction items as per Classy example
            per_page: batchSize
          });
          
          stats.totalRecords += transactions.length;
          
          for (const transaction of transactions) {
            try {
              await this.upsertTransaction(db, transaction, campaignId);
              stats.successfulRecords++;
            } catch (error) {
              stats.failedRecords++;
              logger.error('Failed to sync transaction:', {
                transactionId: transaction.id,
                campaignId,
                error: error.message
              });
            }
          }
        } catch (error) {
          logger.error('Failed to sync transactions for campaign:', {
            campaignId,
            error: error.message
          });
        }
      }
      
      return stats;
    } catch (error) {
      logger.error('Incremental transaction sync failed:', error);
      throw error;
    }
  }

  static async fullSync(api, db, params = {}) {
    const stats = { totalRecords: 0, successfulRecords: 0, failedRecords: 0 };
    
    try {
      const batchSize = params.batch_size || 100;
      const organizationId = params.organization_id;
      
      logger.info('Starting full transaction sync', { 
        batchSize, 
        organizationId 
      });
      
      if (organizationId) {
        // Use organization-level endpoint for full sync
        const transactions = await api.getTransactions({
          per_page: batchSize,
          with: 'items'
        }, organizationId);
        
        stats.totalRecords = transactions.length;
        
        for (const transaction of transactions) {
          try {
            await this.upsertTransaction(db, transaction);
            stats.successfulRecords++;
          } catch (error) {
            stats.failedRecords++;
            logger.error('Failed to sync transaction:', {
              transactionId: transaction.id,
              error: error.message
            });
          }
        }
      } else {
        // Fallback to campaign-based sync if no organization ID
        const campaignIds = params.campaign_ids || await this.getAllCampaignIds(db);
        
        for (const campaignId of campaignIds) {
          try {
            const transactions = await api.getCampaignTransactions(campaignId, {
              per_page: batchSize
            });
            
            stats.totalRecords += transactions.length;
            
            for (const transaction of transactions) {
              try {
                await this.upsertTransaction(db, transaction, campaignId);
                stats.successfulRecords++;
              } catch (error) {
                stats.failedRecords++;
                logger.error('Failed to sync transaction:', {
                  transactionId: transaction.id,
                  campaignId,
                  error: error.message
                });
              }
            }
          } catch (error) {
            logger.error('Failed to sync transactions for campaign:', {
              campaignId,
              error: error.message
            });
          }
        }
      }
      
      return stats;
    } catch (error) {
      logger.error('Full transaction sync failed:', error);
      throw error;
    }
  }

  static async syncSingle(api, db, transactionId) {
    try {
      logger.info('Syncing single transaction', { transactionId });
      
      const transaction = await api.getTransaction(transactionId);
      await this.upsertTransaction(db, transaction);
      
      return { success: true, transactionId };
    } catch (error) {
      logger.error('Single transaction sync failed:', {
        transactionId,
        error: error.message
      });
      throw error;
    }
  }

  static async upsertTransaction(db, transactionData, campaignId = null) {
    const {
      id,
      supporter_id,
      campaign_id,
      recurring_donation_plan_id,
      status,
      payment_method,
      // Use the correct field names from Classy API
      total_gross_amount,
      donation_gross_amount,
      fees_amount,
      donation_net_amount,
      currency_code,
      purchased_at,
      refunded_at,
      created_at,
      updated_at
    } = transactionData;
    
    // Calculate amounts - prefer total_gross_amount, fallback to donation_gross_amount or items
    let grossAmount = total_gross_amount || donation_gross_amount;
    let feeAmount = fees_amount;
    let netAmount = donation_net_amount;
    
    // If amounts still missing, calculate from items
    if (!grossAmount && transactionData.items && transactionData.items.length > 0) {
      grossAmount = transactionData.items.reduce((sum, item) => sum + (item.donation_gross_amount || 0), 0);
      feeAmount = transactionData.items.reduce((sum, item) => sum + (item.fees_amount || 0), 0);
      netAmount = transactionData.items.reduce((sum, item) => sum + (item.donation_net_amount || 0), 0);
    }

    // Get supporter local ID if exists
    let localSupporterId = null;
    if (supporter_id) {
      const supporterQuery = 'SELECT id FROM supporters WHERE classy_id = ?';
      const supporterResult = await db.query(supporterQuery, [supporter_id]);
      localSupporterId = supporterResult.length > 0 ? supporterResult[0].id : null;
    }

    // Get local campaign ID - only use if it exists in our database
    let localCampaignId = campaignId || campaign_id;
    if (localCampaignId) {
      const campaignQuery = 'SELECT id FROM campaigns WHERE classy_id = ?';
      const campaignResult = await db.query(campaignQuery, [localCampaignId]);
      localCampaignId = campaignResult.length > 0 ? campaignResult[0].id : null;
    }
    
    // Get local recurring plan ID if exists
    let localRecurringPlanId = null;
    if (recurring_donation_plan_id) {
      const planQuery = 'SELECT id FROM recurring_plans WHERE classy_id = ?';
      const planResult = await db.query(planQuery, [recurring_donation_plan_id]);
      localRecurringPlanId = planResult.length > 0 ? planResult[0].id : null;
    }

    const query = `
      INSERT INTO transactions (
        classy_id, supporter_id, campaign_id, recurring_plan_id,
        transaction_type, status, payment_method,
        gross_amount, fee_amount, net_amount, currency,
        purchased_at, refunded_at, custom_fields, question_responses,
        created_at, updated_at, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${db.type === 'sqlite' ? 
        'ON CONFLICT(classy_id) DO UPDATE SET' : 
        'ON DUPLICATE KEY UPDATE'
      }
        supporter_id = ${db.type === 'sqlite' ? 'excluded.supporter_id' : 'VALUES(supporter_id)'},
        campaign_id = ${db.type === 'sqlite' ? 'excluded.campaign_id' : 'VALUES(campaign_id)'},
        recurring_plan_id = ${db.type === 'sqlite' ? 'excluded.recurring_plan_id' : 'VALUES(recurring_plan_id)'},
        transaction_type = ${db.type === 'sqlite' ? 'excluded.transaction_type' : 'VALUES(transaction_type)'},
        status = ${db.type === 'sqlite' ? 'excluded.status' : 'VALUES(status)'},
        payment_method = ${db.type === 'sqlite' ? 'excluded.payment_method' : 'VALUES(payment_method)'},
        gross_amount = ${db.type === 'sqlite' ? 'excluded.gross_amount' : 'VALUES(gross_amount)'},
        fee_amount = ${db.type === 'sqlite' ? 'excluded.fee_amount' : 'VALUES(fee_amount)'},
        net_amount = ${db.type === 'sqlite' ? 'excluded.net_amount' : 'VALUES(net_amount)'},
        currency = ${db.type === 'sqlite' ? 'excluded.currency' : 'VALUES(currency)'},
        purchased_at = ${db.type === 'sqlite' ? 'excluded.purchased_at' : 'VALUES(purchased_at)'},
        refunded_at = ${db.type === 'sqlite' ? 'excluded.refunded_at' : 'VALUES(refunded_at)'},
        custom_fields = ${db.type === 'sqlite' ? 'excluded.custom_fields' : 'VALUES(custom_fields)'},
        question_responses = ${db.type === 'sqlite' ? 'excluded.question_responses' : 'VALUES(question_responses)'},
        updated_at = ${db.type === 'sqlite' ? 'excluded.updated_at' : 'VALUES(updated_at)'},
        last_sync_at = ${db.type === 'sqlite' ? 'excluded.last_sync_at' : 'VALUES(last_sync_at)'}
    `;

    // Helper function to convert timestamp to MySQL format
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return null;
      // Convert "2020-01-09T18:13:11+0000" to "2020-01-09 18:13:11"
      return timestamp.replace(/T/, ' ').replace(/\+\d{4}$/, '').replace(/Z$/, '');
    };

    const params = [
      id,
      localSupporterId,
      localCampaignId,
      localRecurringPlanId,
      'donation', // Default transaction type
      status,
      payment_method,
      grossAmount,
      feeAmount,
      netAmount,
      currency_code,
      formatTimestamp(purchased_at),
      formatTimestamp(refunded_at),
      JSON.stringify({}), // custom_fields - not available in this API response
      JSON.stringify({}), // question_responses - not available in this API response  
      formatTimestamp(created_at),
      formatTimestamp(updated_at),
      formatTimestamp(new Date().toISOString())
    ];

    await db.query(query, params);
    
    // Update supporter stats if successful donation
    if (localSupporterId && status === 'success') {
      await this.updateSupporterStatsFromTransaction(db, localSupporterId);
    }
    
    logger.debug('Transaction upserted', { transactionId: id });
  }

  static async updateSupporterStatsFromTransaction(db, supporterId) {
    try {
      const statsQuery = `
        SELECT 
          SUM(CASE WHEN status = 'success' AND transaction_type = 'donation' THEN gross_amount ELSE 0 END) as lifetime_amount,
          COUNT(CASE WHEN status = 'success' AND transaction_type = 'donation' THEN 1 END) as lifetime_count,
          MAX(CASE WHEN status = 'success' AND transaction_type = 'donation' THEN purchased_at END) as last_donation_date
        FROM transactions 
        WHERE supporter_id = ?
      `;
      
      const result = await db.query(statsQuery, [supporterId]);
      
      if (result.length > 0) {
        const stats = result[0];
        await SupporterSync.updateSupporterStats(db, supporterId, {
          lifetime_donation_amount: stats.lifetime_amount || 0,
          lifetime_donation_count: stats.lifetime_count || 0,
          last_donation_date: stats.last_donation_date
        });
      }
    } catch (error) {
      logger.warn('Failed to update supporter stats:', {
        supporterId,
        error: error.message
      });
    }
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

  static async getTransactionsBySupporter(db, supporterId, limit = 50) {
    const query = `
      SELECT * FROM transactions 
      WHERE supporter_id = ? 
      ORDER BY purchased_at DESC 
      LIMIT ?
    `;
    return await db.query(query, [supporterId, limit]);
  }

  static async getTransactionsByCampaign(db, campaignId, limit = 100) {
    const query = `
      SELECT * FROM transactions 
      WHERE campaign_id = ? 
      ORDER BY purchased_at DESC 
      LIMIT ?
    `;
    return await db.query(query, [campaignId, limit]);
  }
}

module.exports = TransactionSync;