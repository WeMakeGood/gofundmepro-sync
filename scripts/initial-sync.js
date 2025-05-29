#!/usr/bin/env node

require('dotenv').config();

const SyncEngine = require('../src/core/sync-engine');
const logger = require('../src/utils/logger');

async function initialFullSync() {
  console.log('🚀 Starting initial full sync of all Classy data...\n');

  const syncOrder = [
    { entity: 'campaigns', description: 'Campaign metadata' },
    { entity: 'supporters', description: 'Supporter profiles' },
    { entity: 'transactions', description: 'Transaction history' },
    { entity: 'recurring_plans', description: 'Recurring donation plans' }
  ];

  const results = {};
  let totalRecords = 0;
  let totalSuccessful = 0;
  let totalFailed = 0;

  try {
    const syncEngine = new SyncEngine();
    await syncEngine.initialize();

    // Set organization ID (you can make this configurable)
    const organizationId = 64531; // Eden organization

    console.log(`📋 Syncing data for organization ID: ${organizationId}\n`);

    for (const { entity, description } of syncOrder) {
      console.log(`📥 Syncing ${description}...`);
      
      const startTime = Date.now();
      
      try {
        const result = await syncEngine.runFullSync(entity, {
          organization_id: organizationId,
          batch_size: 50 // Smaller batches for initial sync
        });

        const duration = Math.round((Date.now() - startTime) / 1000);
        
        results[entity] = result;
        totalRecords += result.totalRecords || 0;
        totalSuccessful += result.successfulRecords || 0;
        totalFailed += result.failedRecords || 0;

        console.log(`   ✅ Completed in ${duration}s`);
        console.log(`   📊 ${result.successfulRecords || 0} successful, ${result.failedRecords || 0} failed`);
        
        if (result.failedRecords > 0) {
          console.log(`   ⚠️  Some records failed - check logs for details`);
        }
        
        console.log();
        
        // Add a small delay between syncs to be respectful
        if (entity !== 'recurring') {
          console.log('   ⏱️  Waiting 2 seconds before next sync...\n');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}\n`);
        results[entity] = { error: error.message };
      }
    }

    console.log('🎉 Initial sync completed!\n');
    console.log('📈 SUMMARY:');
    console.log(`   Total records processed: ${totalRecords}`);
    console.log(`   Successful: ${totalSuccessful}`);
    console.log(`   Failed: ${totalFailed}`);
    console.log(`   Success rate: ${totalRecords > 0 ? Math.round((totalSuccessful / totalRecords) * 100) : 0}%\n`);

    console.log('📊 Detailed Results:');
    Object.entries(results).forEach(([entity, result]) => {
      if (result.error) {
        console.log(`   ${entity}: ERROR - ${result.error}`);
      } else {
        console.log(`   ${entity}: ${result.successfulRecords || 0} synced, ${result.failedRecords || 0} failed`);
      }
    });

    console.log('\n🔄 Next Steps:');
    console.log('1. Check sync job status: SELECT * FROM sync_jobs ORDER BY started_at DESC;');
    console.log('2. Start the daemon for ongoing sync: node daemon.js');
    console.log('3. Monitor health: curl http://localhost:3000/health');

    await syncEngine.shutdown();
    process.exit(0);

  } catch (error) {
    logger.error('Initial sync failed:', error);
    console.error('💥 Critical error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Check your .env file has CLASSY_CLIENT_ID and CLASSY_CLIENT_SECRET');
    console.error('2. Verify network connectivity to https://api.classy.org');
    console.error('3. Check logs for detailed error information');
    process.exit(1);
  }
}

// Handle command line options
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Initial Full Sync - Performs a complete sync of all Classy data');
  console.log('');
  console.log('Usage: node scripts/initial-sync.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h    Show this help message');
  console.log('  --dry-run     Show what would be synced without making changes');
  console.log('');
  console.log('This script will sync all entities in the following order:');
  console.log('1. Campaigns (campaign metadata)');
  console.log('2. Supporters (donor profiles)'); 
  console.log('3. Transactions (donation history)');
  console.log('4. Recurring Plans (subscription data)');
  console.log('');
  console.log('The sync uses organization ID 64531 (Eden). To change this,');
  console.log('edit the organizationId variable in the script.');
  process.exit(0);
}

if (require.main === module) {
  initialFullSync();
}