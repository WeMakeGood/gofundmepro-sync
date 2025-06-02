#!/usr/bin/env node

require('dotenv').config();
const { getInstance: getKnexDatabase } = require('../src/core/knex-database');

async function checkNulls() {
  const db = getKnexDatabase();
  
  try {
    await db.connect();
    
    console.log('🔍 Checking for NULL supporter_ids');
    console.log('==================================');
    
    // Check transactions with NULL supporter_ids
    const nullTransactions = await db.client('transactions')
      .where('organization_id', 1)
      .whereNull('supporter_id')
      .count('* as count');
    
    const totalTransactions = await db.client('transactions')
      .where('organization_id', 1)
      .count('* as count');
    
    console.log(`💰 Transactions:`);
    console.log(`   Total: ${totalTransactions[0].count}`);
    console.log(`   NULL supporter_id: ${nullTransactions[0].count}`);
    console.log(`   Valid supporter_id: ${totalTransactions[0].count - nullTransactions[0].count}`);
    
    // Check recurring plans with NULL supporter_ids
    const nullRecurring = await db.client('recurring_plans')
      .where('organization_id', 1)
      .whereNull('supporter_id')
      .count('* as count');
    
    const totalRecurring = await db.client('recurring_plans')
      .where('organization_id', 1)
      .count('* as count');
    
    console.log(`\n🔄 Recurring Plans:`);
    console.log(`   Total: ${totalRecurring[0].count}`);
    console.log(`   NULL supporter_id: ${nullRecurring[0].count}`);
    console.log(`   Valid supporter_id: ${totalRecurring[0].count - nullRecurring[0].count}`);
    
    // Sample transactions with supporter info
    console.log(`\n📋 Sample Transaction Data:`);
    const sampleTransactions = await db.client('transactions')
      .where('organization_id', 1)
      .limit(3)
      .select('classy_id', 'supporter_id', 'campaign_id', 'gross_amount');
    
    sampleTransactions.forEach((txn, i) => {
      console.log(`   ${i+1}. Transaction ${txn.classy_id}: supporter_id=${txn.supporter_id}, campaign_id=${txn.campaign_id}, amount=${txn.gross_amount}`);
    });
    
    // Sample recurring plans with supporter info
    console.log(`\n📋 Sample Recurring Plan Data:`);
    const samplePlans = await db.client('recurring_plans')
      .where('organization_id', 1)
      .limit(3)
      .select('classy_id', 'supporter_id', 'campaign_id', 'amount');
    
    samplePlans.forEach((plan, i) => {
      console.log(`   ${i+1}. Plan ${plan.classy_id}: supporter_id=${plan.supporter_id}, campaign_id=${plan.campaign_id}, amount=${plan.amount}`);
    });
    
    // Check if supporters exist in our database
    console.log(`\n👥 Supporter Data Check:`);
    const supporterCount = await db.client('supporters')
      .where('organization_id', 1)
      .count('* as count');
    
    console.log(`   Total supporters: ${supporterCount[0].count}`);
    
    // Check if any supporters have the classy_ids referenced in transactions
    const sampleSupporterIds = await db.client('transactions')
      .where('organization_id', 1)
      .whereNotNull('supporter_id')
      .limit(3)
      .pluck('supporter_id');
    
    if (sampleSupporterIds.length > 0) {
      console.log(`   Sample supporter IDs found in transactions: ${sampleSupporterIds.join(', ')}`);
    }
    
  } catch (error) {
    console.error('Error checking nulls:', error);
  } finally {
    await db.close();
  }
}

checkNulls();