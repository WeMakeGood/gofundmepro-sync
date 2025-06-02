#!/usr/bin/env node

require('dotenv').config();

const { getInstance: getDatabase } = require('../src/core/knex-database');
const logger = require('../src/utils/logger');

class SupporterStatsCalculator {
  constructor() {
    this.db = getDatabase();
  }

  async recalculateAllSupporterStats() {
    console.log('🔄 Recalculating supporter lifetime statistics from transaction data...');
    
    try {
      await this.db.connect();
      
      // Get count of supporters that need updates
      const countResult = await this.db.query(`
        SELECT COUNT(*) as total_supporters
        FROM supporters s
        WHERE EXISTS (
          SELECT 1 FROM transactions t 
          WHERE t.supporter_id = s.id 
          AND t.status = 'success' 
          AND t.transaction_type = 'donation'
        )
      `);
      
      const totalSupporters = countResult[0].total_supporters;
      console.log(`📊 Found ${totalSupporters} supporters with successful donations`);
      
      // Update all supporter lifetime statistics
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
          last_sync_at = NOW()
      `;
      
      await this.db.query(updateQuery);
      
      // Verify the update
      const verificationResult = await this.db.query(`
        SELECT 
          COUNT(*) as total_supporters,
          COUNT(CASE WHEN lifetime_donation_amount > 0 THEN 1 END) as supporters_with_donations,
          ROUND(SUM(lifetime_donation_amount), 2) as total_lifetime_value,
          ROUND(AVG(lifetime_donation_amount), 2) as avg_lifetime_value
        FROM supporters
      `);
      
      const stats = verificationResult[0];
      
      console.log('✅ Supporter statistics updated successfully!');
      console.log(`📈 Results:`);
      console.log(`   Total supporters: ${stats.total_supporters}`);
      console.log(`   Supporters with donations: ${stats.supporters_with_donations}`);
      console.log(`   Total lifetime value: $${stats.total_lifetime_value}`);
      console.log(`   Average lifetime value: $${stats.avg_lifetime_value}`);
      
      return stats;
      
    } catch (error) {
      console.error('💥 Failed to recalculate supporter stats:', error.message);
      logger.error('Supporter stats recalculation failed:', error);
      throw error;
    } finally {
      await this.db.close();
    }
  }

  async recalculateSingleSupporter(supporterId) {
    console.log(`🔄 Recalculating stats for supporter ID: ${supporterId}`);
    
    try {
      await this.db.connect();
      
      const statsQuery = `
        SELECT 
          SUM(CASE WHEN status = 'success' AND transaction_type = 'donation' THEN gross_amount ELSE 0 END) as lifetime_amount,
          COUNT(CASE WHEN status = 'success' AND transaction_type = 'donation' THEN 1 END) as lifetime_count,
          MIN(CASE WHEN status = 'success' AND transaction_type = 'donation' THEN purchased_at END) as first_donation_date,
          MAX(CASE WHEN status = 'success' AND transaction_type = 'donation' THEN purchased_at END) as last_donation_date
        FROM transactions 
        WHERE supporter_id = ?
      `;
      
      const result = await this.db.query(statsQuery, [supporterId]);
      
      if (result.length > 0) {
        const stats = result[0];
        
        const updateQuery = `
          UPDATE supporters 
          SET lifetime_donation_amount = ?,
              lifetime_donation_count = ?,
              first_donation_date = ?,
              last_donation_date = ?,
              last_sync_at = NOW()
          WHERE id = ?
        `;
        
        await this.db.query(updateQuery, [
          stats.lifetime_amount || 0,
          stats.lifetime_count || 0,
          stats.first_donation_date,
          stats.last_donation_date,
          supporterId
        ]);
        
        console.log('✅ Supporter stats updated successfully');
        return stats;
      }
      
    } catch (error) {
      console.error('💥 Failed to recalculate supporter stats:', error.message);
      logger.error('Single supporter stats recalculation failed:', error);
      throw error;
    } finally {
      await this.db.close();
    }
  }

  async validateSupporterStats() {
    console.log('🔍 Validating supporter lifetime statistics...');
    
    try {
      await this.db.connect();
      
      // Find discrepancies between stored and calculated values
      const discrepancyQuery = `
        SELECT 
          s.id,
          s.email_address,
          s.lifetime_donation_amount as stored_amount,
          s.lifetime_donation_count as stored_count,
          COALESCE(calc.calculated_amount, 0) as calculated_amount,
          COALESCE(calc.calculated_count, 0) as calculated_count
        FROM supporters s
        LEFT JOIN (
          SELECT 
            supporter_id,
            SUM(CASE WHEN status = 'success' AND transaction_type = 'donation' THEN gross_amount ELSE 0 END) as calculated_amount,
            COUNT(CASE WHEN status = 'success' AND transaction_type = 'donation' THEN 1 END) as calculated_count
          FROM transactions
          GROUP BY supporter_id
        ) calc ON s.id = calc.supporter_id
        WHERE 
          COALESCE(s.lifetime_donation_amount, 0) != COALESCE(calc.calculated_amount, 0)
          OR COALESCE(s.lifetime_donation_count, 0) != COALESCE(calc.calculated_count, 0)
        LIMIT 10
      `;
      
      const discrepancies = await this.db.query(discrepancyQuery);
      
      if (discrepancies.length === 0) {
        console.log('✅ All supporter statistics are accurate!');
      } else {
        console.log(`⚠️  Found ${discrepancies.length} discrepancies (showing first 10):`);
        discrepancies.forEach(row => {
          console.log(`   ${row.email_address}: stored $${row.stored_amount}/${row.stored_count} vs calculated $${row.calculated_amount}/${row.calculated_count}`);
        });
      }
      
      return discrepancies;
      
    } catch (error) {
      console.error('💥 Failed to validate supporter stats:', error.message);
      throw error;
    } finally {
      await this.db.close();
    }
  }
}

// CLI Interface
async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  const calculator = new SupporterStatsCalculator();
  
  try {
    switch (command) {
      case 'recalculate':
      case 'all':
        await calculator.recalculateAllSupporterStats();
        break;
        
      case 'single':
        if (!arg) {
          console.error('Usage: node recalculate-supporter-stats.js single <supporter_id>');
          process.exit(1);
        }
        await calculator.recalculateSingleSupporter(parseInt(arg));
        break;
        
      case 'validate':
        await calculator.validateSupporterStats();
        break;
        
      default:
        console.log('Usage:');
        console.log('  node recalculate-supporter-stats.js recalculate  - Recalculate all supporter stats');
        console.log('  node recalculate-supporter-stats.js single <id>  - Recalculate single supporter');
        console.log('  node recalculate-supporter-stats.js validate     - Validate accuracy of current stats');
        process.exit(1);
    }
  } catch (error) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = SupporterStatsCalculator;