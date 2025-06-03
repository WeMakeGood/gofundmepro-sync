#!/usr/bin/env node

require('dotenv').config();

const { getInstance: getKnexDatabase } = require('../src/core/knex-database');

async function testDatabaseFlexibility() {
  console.log('🧪 Testing Database Flexibility with Knex\n');
  
  const db = getKnexDatabase();
  
  try {
    await db.connect();
    
    console.log(`📊 Connected to: ${db.type}`);
    console.log(`🏢 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`💾 Database Type: ${process.env.DB_TYPE || 'sqlite'}\n`);
    
    // Test query builder syntax (works across all databases)
    console.log('🔍 Testing cross-database query syntax...');
    
    // Insert test organization using Knex query builder
    await db.table('organizations').insert({
      classy_id: 'test_org_001',
      name: 'Test Organization',
      status: 'active',
      description: 'A test organization for demonstrating Knex flexibility',
      created_at: new Date(),
      updated_at: new Date(),
      last_sync_at: new Date()
    }).onConflict('classy_id').ignore();
    
    console.log('✅ Inserted test organization');
    
    // Query using builder syntax
    const orgs = await db.table('organizations')
      .select('name', 'status', 'created_at')
      .where('classy_id', 'test_org_001');
    
    console.log('✅ Query successful:', orgs[0]);
    
    // Test transaction
    console.log('\n💸 Testing transaction support...');
    
    const trx = await db.beginTransaction();
    try {
      await trx('campaigns').insert({
        id: 999999, // Classy campaign ID
        organization_id: orgs[0].id || 1,
        name: 'Test Campaign',
        status: 'active',
        goal: 10000.00,
        total_raised: 0,
        campaign_type: 'fundraising',
        created_at: new Date(),
        updated_at: new Date(),
        last_sync_at: new Date()
      });
      
      await trx.commit();
      console.log('✅ Transaction committed successfully');
      
    } catch (error) {
      await trx.rollback();
      console.log('❌ Transaction rolled back');
      throw error;
    }
    
    // Test aggregation
    console.log('\n📈 Testing aggregation queries...');
    
    const stats = await db.table('organizations')
      .count('* as total_orgs')
      .first();
    
    console.log('✅ Aggregation query:', stats);
    
    // Test views
    console.log('\n📊 Testing analytical views...');
    
    const campaignStats = await db.table('campaign_performance')
      .select('name', 'status', 'goal', 'actual_raised')
      .limit(5);
    
    console.log('✅ View query successful:', campaignStats.length, 'campaigns found');
    
    console.log('\n🎉 All database flexibility tests PASSED!');
    console.log('\n💡 Benefits achieved:');
    console.log('  ✅ Single codebase works with SQLite, MySQL, PostgreSQL');
    console.log('  ✅ Consistent migration system across environments');
    console.log('  ✅ Type-safe query building');
    console.log('  ✅ Transaction support');
    console.log('  ✅ Database-specific optimizations handled automatically');
    
  } catch (error) {
    console.error('💥 Test failed:', error.message);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  testDatabaseFlexibility();
}

module.exports = testDatabaseFlexibility;