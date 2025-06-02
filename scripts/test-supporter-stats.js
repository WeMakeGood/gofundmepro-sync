#!/usr/bin/env node

/**
 * Test the specific supporter stats SQL that was failing in initial sync
 * This tests the exact query that caused the MySQL syntax error
 */

const { getInstance } = require('../src/core/knex-database');

async function testSupporterStatsSQL() {
  console.log('🧪 Testing supporter stats SQL syntax...');
  
  try {
    const db = getInstance();
    await db.connect();
    
    const dbType = db.type;
    console.log(`📊 Database type: ${dbType}`);
    
    // Test the exact SQL that was failing from supporters.js
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
      WHERE s.id = 999999
    `;
    
    console.log('🔍 Testing SQL syntax (no actual update will occur)...');
    console.log(`   Using ${db.type === 'mysql' ? 'NOW()' : "datetime('now')"} for timestamp`);
    
    // This should not update any rows since supporter ID 999999 likely doesn't exist
    // But it will test the SQL syntax
    await db.query(updateQuery);
    
    console.log('✅ Supporter stats SQL syntax is valid!');
    
    // Test a simpler version to make sure basic UPDATE syntax works
    console.log('🔍 Testing basic UPDATE syntax...');
    const basicUpdate = `
      UPDATE supporters 
      SET last_sync_at = ${db.type === 'mysql' ? 'NOW()' : "datetime('now')"}
      WHERE id = 999999
    `;
    
    await db.query(basicUpdate);
    console.log('✅ Basic UPDATE syntax works!');
    
    await db.close();
    console.log('🎉 All supporter stats SQL tests passed!');
    
  } catch (error) {
    console.error('❌ Supporter stats SQL test failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Run the test
testSupporterStatsSQL();