#!/usr/bin/env node

/**
 * Reset Timestamps Migration Script
 * 
 * This script resets last_sync_at timestamps to force a re-sync with proper
 * Classy API updated_at timestamps. Run this AFTER applying the timestamp
 * preservation fixes to restore proper change detection.
 */

const { database } = require('../src/config/database');
const { createLogger } = require('../src/utils/logger');

const logger = createLogger('timestamp-reset');

async function resetTimestamps() {
  try {
    logger.info('🔄 Starting timestamp reset migration...');
    
    // Initialize database
    await database.initialize();
    const db = database.getKnex();
    
    // Get statistics before reset
    const beforeStats = {
      supporters: await db('supporters').count('* as count').first(),
      transactions: await db('transactions').count('* as count').first(),
      campaigns: await db('campaigns').count('* as count').first(),
      recurringPlans: await db('recurring_plans').count('* as count').first()
    };
    
    logger.info('📊 Records to reset:', {
      supporters: parseInt(beforeStats.supporters.count),
      transactions: parseInt(beforeStats.transactions.count),
      campaigns: parseInt(beforeStats.campaigns.count),
      recurringPlans: parseInt(beforeStats.recurringPlans.count)
    });
    
    // Confirm before proceeding
    console.log('\n⚠️  This will reset last_sync_at timestamps for ALL records to force re-sync.');
    console.log('   This is necessary to restore proper Classy API updated_at timestamps.');
    console.log('   The next full sync will take longer but will fix timestamp corruption.\n');
    
    // Reset last_sync_at to NULL for all tables to force re-sync
    logger.info('🔄 Resetting supporters timestamps...');
    const supportersReset = await db('supporters').update({ last_sync_at: null });
    
    logger.info('🔄 Resetting transactions timestamps...');
    const transactionsReset = await db('transactions').update({ last_sync_at: null });
    
    logger.info('🔄 Resetting campaigns timestamps...');
    const campaignsReset = await db('campaigns').update({ last_sync_at: null });
    
    logger.info('🔄 Resetting recurring plans timestamps...');
    const recurringPlansReset = await db('recurring_plans').update({ last_sync_at: null });
    
    // Log results
    logger.info('✅ Timestamp reset completed:', {
      supportersReset,
      transactionsReset,
      campaignsReset,
      recurringPlansReset
    });
    
    logger.info('📋 Next steps:');
    logger.info('   1. Run: npm run sync all full');
    logger.info('   2. Verify updated_at timestamps are now diverse');
    logger.info('   3. Test MailChimp incremental sync detection');
    
    await database.close();
    process.exit(0);
    
  } catch (error) {
    logger.error('❌ Timestamp reset failed:', error);
    await database.close();
    process.exit(1);
  }
}

// Add to package.json scripts or run directly
if (require.main === module) {
  resetTimestamps();
}

module.exports = { resetTimestamps };