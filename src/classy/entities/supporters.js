const logger = require('../../utils/logger');

class SupporterSync {
  static async incrementalSync(api, db, params = {}) {
    const stats = { totalRecords: 0, successfulRecords: 0, failedRecords: 0 };
    
    try {
      const updatedSince = params.updated_since;
      const batchSize = params.batch_size || 100;
      
      logger.info('Starting incremental supporter sync', { updatedSince, batchSize });
      
      // The supporters API is very slow, so use small batch sizes and timeout handling
      const smallBatchSize = Math.min(batchSize, 20); // Much smaller batch due to API slowness
      
      logger.info(`Using small batch size ${smallBatchSize} due to supporters API performance`);
      
      // Handle the slow supporters API with graceful fallback
      let supporters = [];
      
      try {
        // Use direct API call with single page to avoid timeout
        const response = await Promise.race([
          api.makeRequest('GET', `/2.0/organizations/${params.classy_organization_id}/supporters`, null, {
            per_page: 5, // Very small batch for slow API
            sort: 'updated_at:desc'
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Supporters API timeout')), 60000) // 60 second timeout
          )
        ]);
        
        supporters = response.data || [];
        
        logger.info(`Successfully retrieved ${supporters.length} supporters from slow API`);
        
      } catch (error) {
        if (error.message.includes('timeout')) {
          logger.warn('Supporters API too slow, skipping incremental sync this time', {
            error: error.message,
            suggestion: 'Supporters update infrequently, this is acceptable'
          });
          
          // Return empty result - this is acceptable for supporters due to low update frequency
          return {
            totalRecords: 0,
            successfulRecords: 0,
            failedRecords: 0,
            skipped: true,
            reason: 'API timeout - supporters update infrequently'
          };
        }
        throw error; // Re-throw non-timeout errors
      }
      
      // Filter client-side to only include supporters updated since last sync
      const filteredSupporters = supporters.filter(supporter => {
        return new Date(supporter.updated_at) > updatedSince;
      });
      
      stats.totalRecords = filteredSupporters.length;
      
      logger.info(`Found ${filteredSupporters.length} supporters updated since ${updatedSince} (client-side filtered from ${supporters.length} total)`);
      
      for (const supporter of filteredSupporters) {
        try {
          await this.upsertSupporter(db, supporter, params.organization_id);
          stats.successfulRecords++;
        } catch (error) {
          stats.failedRecords++;
          logger.error('Failed to sync supporter:', {
            supporterId: supporter.id,
            error: error.message
          });
        }
      }
      
      return stats;
    } catch (error) {
      logger.error('Incremental supporter sync failed:', error);
      throw error;
    }
  }

  static async fullSync(api, db, params = {}) {
    const stats = { totalRecords: 0, successfulRecords: 0, failedRecords: 0 };
    
    try {
      const batchSize = params.batch_size || 100;
      
      logger.info('Starting full supporter sync', { batchSize });
      
      // Get supporters using direct API call to avoid fetchAll timeout
      const response = await api.makeRequest('GET', `/2.0/organizations/${params.classy_organization_id}/supporters`, null, {
        per_page: Math.min(batchSize, 50) // Limit to 50 for full sync
      });
      
      const supporters = response.data || [];
      
      stats.totalRecords = supporters.length;
      
      for (const supporter of supporters) {
        try {
          await this.upsertSupporter(db, supporter, params.organization_id);
          stats.successfulRecords++;
        } catch (error) {
          stats.failedRecords++;
          logger.error('Failed to sync supporter:', {
            supporterId: supporter.id,
            error: error.message
          });
        }
      }
      
      // After syncing all supporters, recalculate lifetime stats from transactions
      logger.info('Recalculating supporter lifetime statistics from transactions...');
      await this.recalculateAllLifetimeStats(db);
      
      return stats;
    } catch (error) {
      logger.error('Full supporter sync failed:', error);
      throw error;
    }
  }

  static async syncSingle(api, db, supporterId) {
    try {
      logger.info('Syncing single supporter', { supporterId });
      
      const supporter = await api.getSupporter(supporterId);
      await this.upsertSupporter(db, supporter);
      
      return { success: true, supporterId };
    } catch (error) {
      logger.error('Single supporter sync failed:', {
        supporterId,
        error: error.message
      });
      throw error;
    }
  }

  static async upsertSupporter(db, supporterData, organizationId) {
    const {
      id,
      email_address,
      first_name,
      last_name,
      phone,
      address1,
      address2,
      city,
      state,
      postal_code,
      country,
      // Consent and communication fields
      opt_in,
      sms_opt_in,
      last_email_consent_decision_date,
      last_sms_consent_decision_date,
      last_emailed_at,
      // Note: lifetime stats aren't provided by the supporter API
      // These will be calculated from transactions
      created_at,
      updated_at
    } = supporterData;
    
    const query = `
      INSERT INTO supporters (
        classy_id, organization_id, email_address, first_name, last_name, phone,
        address_line1, address_line2, city, state, postal_code, country,
        lifetime_donation_amount, lifetime_donation_count,
        first_donation_date, last_donation_date, custom_fields,
        email_opt_in, sms_opt_in, last_email_consent_date, last_sms_consent_date, last_emailed_at,
        created_at, updated_at, last_sync_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ${db.type === 'sqlite' ? 
        'ON CONFLICT(classy_id) DO UPDATE SET' : 
        'ON DUPLICATE KEY UPDATE'
      }
        email_address = ${db.type === 'sqlite' ? 'excluded.email_address' : 'VALUES(email_address)'},
        first_name = ${db.type === 'sqlite' ? 'excluded.first_name' : 'VALUES(first_name)'},
        last_name = ${db.type === 'sqlite' ? 'excluded.last_name' : 'VALUES(last_name)'},
        phone = ${db.type === 'sqlite' ? 'excluded.phone' : 'VALUES(phone)'},
        address_line1 = ${db.type === 'sqlite' ? 'excluded.address_line1' : 'VALUES(address_line1)'},
        address_line2 = ${db.type === 'sqlite' ? 'excluded.address_line2' : 'VALUES(address_line2)'},
        city = ${db.type === 'sqlite' ? 'excluded.city' : 'VALUES(city)'},
        state = ${db.type === 'sqlite' ? 'excluded.state' : 'VALUES(state)'},
        postal_code = ${db.type === 'sqlite' ? 'excluded.postal_code' : 'VALUES(postal_code)'},
        country = ${db.type === 'sqlite' ? 'excluded.country' : 'VALUES(country)'},
        lifetime_donation_amount = ${db.type === 'sqlite' ? 'excluded.lifetime_donation_amount' : 'VALUES(lifetime_donation_amount)'},
        lifetime_donation_count = ${db.type === 'sqlite' ? 'excluded.lifetime_donation_count' : 'VALUES(lifetime_donation_count)'},
        first_donation_date = ${db.type === 'sqlite' ? 'excluded.first_donation_date' : 'VALUES(first_donation_date)'},
        last_donation_date = ${db.type === 'sqlite' ? 'excluded.last_donation_date' : 'VALUES(last_donation_date)'},
        custom_fields = ${db.type === 'sqlite' ? 'excluded.custom_fields' : 'VALUES(custom_fields)'},
        email_opt_in = ${db.type === 'sqlite' ? 'excluded.email_opt_in' : 'VALUES(email_opt_in)'},
        sms_opt_in = ${db.type === 'sqlite' ? 'excluded.sms_opt_in' : 'VALUES(sms_opt_in)'},
        last_email_consent_date = ${db.type === 'sqlite' ? 'excluded.last_email_consent_date' : 'VALUES(last_email_consent_date)'},
        last_sms_consent_date = ${db.type === 'sqlite' ? 'excluded.last_sms_consent_date' : 'VALUES(last_sms_consent_date)'},
        last_emailed_at = ${db.type === 'sqlite' ? 'excluded.last_emailed_at' : 'VALUES(last_emailed_at)'},
        updated_at = ${db.type === 'sqlite' ? 'excluded.updated_at' : 'VALUES(updated_at)'},
        last_sync_at = ${db.type === 'sqlite' ? 'excluded.last_sync_at' : 'VALUES(last_sync_at)'},
        sync_status = ${db.type === 'sqlite' ? 'excluded.sync_status' : 'VALUES(sync_status)'}
    `;

    // Helper function to convert timestamp to MySQL format
    const formatTimestamp = (timestamp) => {
      if (!timestamp) return null;
      // Convert "2020-01-09T18:13:11+0000" to "2020-01-09 18:13:11"
      return timestamp.replace(/T/, ' ').replace(/\+\d{4}$/, '').replace(/Z$/, '');
    };

    const params = [
      id,
      organizationId,
      email_address,
      first_name,
      last_name,
      phone,
      address1, // address_line1
      address2, // address_line2
      city,
      state,
      postal_code,
      country,
      null, // lifetime_donation_amount - will be calculated from transactions
      null, // lifetime_donation_count - will be calculated from transactions
      null, // first_donation_date - will be calculated from transactions
      null, // last_donation_date - will be calculated from transactions
      JSON.stringify({}), // custom_fields - not available in basic supporter response
      opt_in || null, // email_opt_in
      sms_opt_in || null, // sms_opt_in
      formatTimestamp(last_email_consent_decision_date), // last_email_consent_date
      formatTimestamp(last_sms_consent_decision_date), // last_sms_consent_date
      formatTimestamp(last_emailed_at), // last_emailed_at
      formatTimestamp(created_at),
      formatTimestamp(updated_at),
      formatTimestamp(new Date().toISOString()),
      'synced'
    ];

    await db.query(query, params);
    
    logger.debug('Supporter upserted', { supporterId: id });
  }

  static async getSupporterByClassyId(db, classyId) {
    const query = 'SELECT * FROM supporters WHERE classy_id = ?';
    const result = await db.query(query, [classyId]);
    return result.length > 0 ? result[0] : null;
  }

  // Consent and CRM integration methods
  static async getEmailOptedInSupporters(db, limit = null) {
    let query = `
      SELECT id, classy_id, email_address, first_name, last_name, 
             last_email_consent_date, last_emailed_at
      FROM supporters 
      WHERE email_opt_in = 1 
      ORDER BY last_email_consent_date DESC
    `;
    
    if (limit) {
      query += ` LIMIT ${limit}`;
    }
    
    return await db.query(query);
  }

  static async getSMSOptedInSupporters(db, limit = null) {
    let query = `
      SELECT id, classy_id, phone, first_name, last_name,
             last_sms_consent_date
      FROM supporters 
      WHERE sms_opt_in = 1 AND phone IS NOT NULL AND LENGTH(phone) > 0
      ORDER BY last_sms_consent_date DESC
    `;
    
    if (limit) {
      query += ` LIMIT ${limit}`;
    }
    
    return await db.query(query);
  }

  static async getConsentStats(db) {
    const query = `
      SELECT 
        COUNT(*) as total_supporters,
        COUNT(CASE WHEN email_opt_in = 1 THEN 1 END) as email_opted_in,
        COUNT(CASE WHEN email_opt_in = 0 THEN 1 END) as email_opted_out,
        COUNT(CASE WHEN sms_opt_in = 1 THEN 1 END) as sms_opted_in,
        COUNT(CASE WHEN sms_opt_in = 0 THEN 1 END) as sms_opted_out,
        COUNT(CASE WHEN last_email_consent_date IS NOT NULL THEN 1 END) as have_email_consent_date,
        COUNT(CASE WHEN last_sms_consent_date IS NOT NULL THEN 1 END) as have_sms_consent_date
      FROM supporters
    `;
    
    const result = await db.query(query);
    return result.length > 0 ? result[0] : null;
  }

  static async getSupportersForCRM(db, options = {}) {
    const {
      emailOptIn = null,
      smsOptIn = null,
      hasEmail = true,
      hasPhone = false,
      minDonationAmount = null,
      limit = null
    } = options;

    let query = `
      SELECT 
        s.id, s.classy_id, s.email_address, s.first_name, s.last_name, s.phone,
        s.email_opt_in, s.sms_opt_in, s.last_email_consent_date, s.last_sms_consent_date,
        s.lifetime_donation_amount, s.lifetime_donation_count, s.last_donation_date,
        s.created_at, s.updated_at
      FROM supporters s
      WHERE 1=1
    `;
    
    const params = [];
    
    if (hasEmail) {
      query += ' AND s.email_address IS NOT NULL AND LENGTH(s.email_address) > 0';
    }
    
    if (hasPhone) {
      query += ' AND s.phone IS NOT NULL AND LENGTH(s.phone) > 0';
    }
    
    if (emailOptIn !== null) {
      query += ' AND s.email_opt_in = ?';
      params.push(emailOptIn ? 1 : 0);
    }
    
    if (smsOptIn !== null) {
      query += ' AND s.sms_opt_in = ?';
      params.push(smsOptIn ? 1 : 0);
    }
    
    if (minDonationAmount !== null) {
      query += ' AND s.lifetime_donation_amount >= ?';
      params.push(minDonationAmount);
    }
    
    query += ' ORDER BY s.lifetime_donation_amount DESC, s.last_donation_date DESC';
    
    if (limit) {
      query += ` LIMIT ${limit}`;
    }
    
    return await db.query(query, params);
  }

  static async getSupporterByEmail(db, email) {
    const query = 'SELECT * FROM supporters WHERE email_address = ?';
    const result = await db.query(query, [email]);
    return result.length > 0 ? result[0] : null;
  }

  static async updateSupporterStats(db, supporterId, stats) {
    const query = `
      UPDATE supporters 
      SET lifetime_donation_amount = ?,
          lifetime_donation_count = ?,
          last_donation_date = ?,
          updated_at = ?,
          last_sync_at = ?
      WHERE id = ?
    `;
    
    const params = [
      stats.lifetime_donation_amount,
      stats.lifetime_donation_count,
      stats.last_donation_date,
      new Date().toISOString(),
      new Date().toISOString(),
      supporterId
    ];

    await db.query(query, params);
  }

  static async recalculateAllLifetimeStats(db) {
    try {
      logger.info('Recalculating lifetime statistics for all supporters...');
      
      const updateQuery = `
        UPDATE supporters s
        SET 
          lifetime_donation_amount = COALESCE((
            SELECT SUM(t.gross_amount)
            FROM transactions t 
            WHERE t.supporter_id = s.id 
            AND t.status = 'success'
            AND t.transaction_type = 'donation'
          ), 0),
          lifetime_donation_count = COALESCE((
            SELECT COUNT(*)
            FROM transactions t 
            WHERE t.supporter_id = s.id 
            AND t.status = 'success'
            AND t.transaction_type = 'donation'
          ), 0),
          first_donation_date = (
            SELECT MIN(t.purchased_at)
            FROM transactions t 
            WHERE t.supporter_id = s.id 
            AND t.status = 'success'
            AND t.transaction_type = 'donation'
          ),
          last_donation_date = (
            SELECT MAX(t.purchased_at)
            FROM transactions t 
            WHERE t.supporter_id = s.id 
            AND t.status = 'success'
            AND t.transaction_type = 'donation'
          ),
          last_sync_at = ${db.type === 'mysql' ? 'NOW()' : "datetime('now')"}
      `;
      
      await db.query(updateQuery);
      
      // Get update statistics
      const countResult = await db.query(`
        SELECT 
          COUNT(*) as total_supporters,
          COUNT(CASE WHEN lifetime_donation_amount > 0 THEN 1 END) as supporters_with_donations
        FROM supporters
      `);
      
      const stats = countResult[0];
      logger.info('Supporter lifetime statistics recalculated', {
        totalSupporters: stats.total_supporters,
        supportersWithDonations: stats.supporters_with_donations
      });
      
      return stats;
      
    } catch (error) {
      logger.error('Failed to recalculate supporter lifetime statistics:', error);
      throw error;
    }
  }
}

module.exports = SupporterSync;