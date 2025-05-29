#!/usr/bin/env node

require('dotenv').config();
const { Database } = require('../src/core/database');
const MailChimpSyncPlugin = require('../src/plugins/mailchimp-sync');
const logger = require('../src/utils/logger');

async function runMailChimpFullSync() {
  console.log('🔄 Starting MailChimp Full Sync\n');

  const startTime = Date.now();
  let db = null;
  let plugin = null;

  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run') || args.includes('-d');
    const batchSize = parseInt(args.find(arg => arg.startsWith('--batch-size='))?.split('=')[1]) || 50;
    const limit = parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1]) || null;

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No actual sync will be performed\n');
    }

    // Initialize database
    console.log('📊 Connecting to database...');
    db = new Database();
    await db.connect();

    // Get sync statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_supporters,
        COUNT(CASE WHEN email_address IS NOT NULL AND email_address != '' THEN 1 END) as with_email,
        COUNT(CASE WHEN email_address IS NOT NULL AND email_address != '' AND email_opt_in = 1 THEN 1 END) as email_consented,
        COUNT(CASE WHEN email_address IS NOT NULL AND email_opt_in = 1 AND lifetime_donation_amount > 0 THEN 1 END) as donors_with_consent,
        SUM(CASE WHEN email_address IS NOT NULL AND email_opt_in = 1 THEN lifetime_donation_amount ELSE 0 END) as total_value_consented,
        COUNT(CASE WHEN email_address IS NOT NULL AND email_opt_in = 1 AND active_recurring_plans > 0 THEN 1 END) as recurring_consented,
        SUM(CASE WHEN email_address IS NOT NULL AND email_opt_in = 1 THEN monthly_recurring_amount ELSE 0 END) as total_monthly_recurring_consented
      FROM supporter_summary
    `;
    
    const stats = await db.query(statsQuery);
    const stat = stats[0];
    
    console.log('📈 Sync Statistics:');
    console.log(`   Total supporters: ${stat.total_supporters.toLocaleString()}`);
    console.log(`   With email addresses: ${stat.with_email.toLocaleString()}`);
    console.log(`   Email consented: ${stat.email_consented.toLocaleString()} (${Math.round(stat.email_consented/stat.with_email*100)}% of emails)`);
    console.log(`   Donors with consent: ${stat.donors_with_consent.toLocaleString()}`);
    console.log(`   Total value (consented): $${stat.total_value_consented.toLocaleString()}`);
    console.log(`   Recurring donors (consented): ${stat.recurring_consented.toLocaleString()}`);
    console.log(`   Monthly recurring (consented): $${stat.total_monthly_recurring_consented.toLocaleString()}`);
    console.log('');

    if (dryRun) {
      console.log('✅ Dry run completed - statistics gathered successfully');
      return;
    }

    // Initialize MailChimp sync plugin
    console.log('🔗 Initializing MailChimp sync...');
    const pluginConfig = {
      apiKey: process.env.MAILCHIMP_API_KEY,
      listId: '06411e98fe', // Unified Audience
      syncMode: 'full',
      batchSize: batchSize,
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

    // Get supporters to sync
    let query = `
      SELECT * FROM supporter_summary 
      WHERE email_address IS NOT NULL 
      AND email_address != ''
      AND email_opt_in = 1
      ORDER BY lifetime_donation_amount DESC
    `;
    
    if (limit) {
      query += ` LIMIT ${limit}`;
      console.log(`⚠️  Limited sync: processing top ${limit} supporters by donation amount\n`);
    }
    
    console.log('📥 Fetching supporters to sync...');
    const supporters = await db.query(query);
    
    console.log(`✅ Found ${supporters.length} supporters to sync\n`);

    // Show sample of what will be synced
    console.log('👥 Sample supporters to sync:');
    supporters.slice(0, 5).forEach((supporter, index) => {
      console.log(`   ${index + 1}. ${supporter.first_name} ${supporter.last_name} (${supporter.email_address})`);
      console.log(`      Tier: ${supporter.donor_value_tier}, Status: ${supporter.engagement_status}`);
      console.log(`      Lifetime: $${supporter.lifetime_donation_amount}, Recurring: $${supporter.monthly_recurring_amount}`);
    });
    
    if (supporters.length > 5) {
      console.log(`   ... and ${supporters.length - 5} more`);
    }
    console.log('');

    // Perform the sync
    console.log('🚀 Starting sync process...');
    const syncStartTime = Date.now();
    
    await plugin.process({
      type: 'supporters.batch',
      supporters: supporters
    });
    
    const syncDuration = Date.now() - syncStartTime;
    
    console.log(`✅ Sync process completed in ${(syncDuration / 1000).toFixed(1)} seconds`);
    
    // Show completion stats
    const totalDuration = Date.now() - startTime;
    console.log('\n📊 Sync Summary:');
    console.log(`   Supporters processed: ${supporters.length.toLocaleString()}`);
    console.log(`   Batch size: ${batchSize}`);
    console.log(`   Total batches: ${Math.ceil(supporters.length / batchSize)}`);
    console.log(`   Total duration: ${(totalDuration / 1000).toFixed(1)} seconds`);
    console.log(`   Average per supporter: ${(totalDuration / supporters.length).toFixed(0)}ms`);

    await plugin.shutdown();

  } catch (error) {
    console.error('❌ MailChimp full sync failed:', error.message);
    if (error.stack) {
      logger.error('Stack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    if (db) {
      await db.close();
    }
  }
}

// Show usage if help requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
📧 MailChimp Full Sync

Usage: node scripts/mailchimp-full-sync.js [options]

Options:
  --dry-run, -d              Show what would be synced without actually syncing
  --batch-size=<number>      Number of supporters per batch (default: 50)
  --limit=<number>           Limit total supporters to sync (for testing)
  --help, -h                 Show this help message

Examples:
  node scripts/mailchimp-full-sync.js --dry-run
  node scripts/mailchimp-full-sync.js --batch-size=25 --limit=100
  node scripts/mailchimp-full-sync.js

Environment Variables Required:
  MAILCHIMP_API_KEY         Your MailChimp API key
  MAILCHIMP_LIST_ID         Target list ID (optional, defaults to Unified Audience)
`);
  process.exit(0);
}

runMailChimpFullSync();