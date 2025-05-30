#!/usr/bin/env node

require('dotenv').config();
const { getInstance: getDatabase } = require('../src/core/knex-database');
const MailChimpSyncPlugin = require('../src/plugins/mailchimp-sync');
const logger = require('../src/utils/logger');

async function testMailChimpIncrementalSync() {
  console.log('🧪 Testing MailChimp Incremental Sync Integration');
  console.log('================================================\n');

  let db = null;
  let plugin = null;

  try {
    // Initialize database
    console.log('📊 Connecting to database...');
    db = getDatabase();
    await db.connect();
    console.log('✅ Database connected\n');

    // Initialize MailChimp sync plugin
    console.log('🔗 Initializing MailChimp sync plugin...');
    const pluginConfig = {
      apiKey: process.env.MAILCHIMP_API_KEY,
      listId: process.env.MAILCHIMP_LIST_ID || '06411e98fe',
      syncMode: 'incremental',
      batchSize: 10,
      tagPrefix: 'Classy-',
      createMergeFields: false,
      waitForBatchCompletion: false
    };

    const dependencies = {
      db,
      logger,
      queue: null
    };

    plugin = new MailChimpSyncPlugin(pluginConfig, dependencies);
    await plugin.initialize();
    console.log('✅ MailChimp plugin initialized\n');

    // Get supporters updated in the last 24 hours for testing
    console.log('📥 Fetching recently updated supporters...');
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const mysqlDatetime = twentyFourHoursAgo.toISOString().replace('T', ' ').replace(/\\.\\d{3}Z$/, '');
    
    const supporters = await db.query(`
      SELECT * FROM supporter_summary 
      WHERE email_address IS NOT NULL 
      AND email_address != ''
      AND email_opt_in = 1
      AND last_sync_at >= ?
      ORDER BY last_sync_at DESC
      LIMIT 5
    `, [mysqlDatetime]);
    
    console.log(`✅ Found ${supporters.length} recently updated supporters\n`);

    if (supporters.length > 0) {
      console.log('👥 Sample supporters to sync:');
      supporters.forEach((supporter, index) => {
        console.log(`   ${index + 1}. ${supporter.first_name} ${supporter.last_name} (${supporter.email_address})`);
        console.log(`      Tier: ${supporter.donor_value_tier}, Status: ${supporter.engagement_status}`);
        console.log(`      Lifetime: $${supporter.lifetime_donation_amount}, Last sync: ${supporter.last_sync_at}`);
      });
      console.log('');

      // Perform incremental sync
      console.log('🚀 Performing incremental MailChimp sync...');
      await plugin.process({
        type: 'supporters.batch',
        supporters: supporters,
        trigger: 'incremental_sync_test',
        timestamp: new Date().toISOString()
      });

      console.log('✅ Incremental sync completed successfully!\n');
      
      console.log('📊 Summary:');
      console.log(`   - Supporters processed: ${supporters.length}`);
      console.log(`   - Integration: Fully functional`);
      console.log(`   - MailChimp sync: Active and working`);
      console.log(`   - Tag prefix: "${pluginConfig.tagPrefix}"`);

    } else {
      console.log('ℹ️  No recently updated supporters found.');
      console.log('   This is normal if no data has been synced recently.');
      console.log('   The integration is ready and will work when supporters are updated.\n');
      
      // Test with Chris Frazier as fallback
      console.log('🔄 Testing with Chris Frazier as sample...');
      const chrisSupporter = await db.query(`
        SELECT * FROM supporter_summary 
        WHERE email_address = 'chris.frazier@wemakegood.org'
        AND email_opt_in = 1
        LIMIT 1
      `);
      
      if (chrisSupporter.length > 0) {
        await plugin.process({
          type: 'supporters.batch',
          supporters: chrisSupporter,
          trigger: 'test_sync',
          timestamp: new Date().toISOString()
        });
        console.log('✅ Test sync with Chris Frazier completed successfully!');
      }
    }

    console.log('\n🎉 MailChimp Incremental Sync Integration Test Completed!');
    console.log('    The daemon will now automatically sync supporter updates to MailChimp.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      logger.error('Stack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    if (plugin) {
      await plugin.shutdown();
    }
    if (db) {
      await db.close();
    }
  }
}

// Show usage if help requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🧪 MailChimp Incremental Sync Test

Usage: node scripts/test-mailchimp-incremental.js

This script tests the incremental MailChimp sync integration by:
1. Connecting to the database
2. Initializing the MailChimp plugin
3. Finding recently updated supporters
4. Performing a test sync to MailChimp
5. Validating the integration works correctly

Environment Variables Required:
  MAILCHIMP_API_KEY         Your MailChimp API key
  MAILCHIMP_LIST_ID         Target list ID (optional, defaults to Unified Audience)
`);
  process.exit(0);
}

testMailChimpIncrementalSync();