#!/usr/bin/env node

require('dotenv').config();
const { getInstance: getKnexDatabase } = require('../src/core/knex-database');

async function checkData() {
  const db = getKnexDatabase();
  
  try {
    await db.connect();
    
    console.log('📊 Database Data Summary');
    console.log('========================');
    
    // Check organizations
    const orgs = await db.client('organizations').count('* as count');
    console.log(`🏢 Organizations: ${orgs[0].count}`);
    
    // Check data for organization 1
    const orgId = 1;
    console.log(`\n📋 Data for Organization ${orgId}:`);
    
    const campaigns = await db.client('campaigns').where('organization_id', orgId).count('* as count');
    console.log(`   📢 Campaigns: ${campaigns[0].count}`);
    
    const supporters = await db.client('supporters').where('organization_id', orgId).count('* as count');
    console.log(`   👥 Supporters: ${supporters[0].count}`);
    
    const transactions = await db.client('transactions').where('organization_id', orgId).count('* as count');
    console.log(`   💰 Transactions: ${transactions[0].count}`);
    
    const recurring = await db.client('recurring_plans').where('organization_id', orgId).count('* as count');
    console.log(`   🔄 Recurring Plans: ${recurring[0].count}`);
    
    // Check donor segmentation config
    const segmentConfig = await db.client('donor_segmentation_config').where('organization_id', orgId).count('* as count');
    console.log(`   📊 Donor Segmentation Config: ${segmentConfig[0].count}`);
    
    // Check recent sync jobs (use different column name)
    try {
      const syncJobs = await db.client('sync_jobs')
        .where('organization_id', orgId)
        .orderBy('id', 'desc')
        .limit(5)
        .select('entity_type', 'status', 'records_processed');
      
      console.log(`\n🔄 Recent Sync Jobs:`);
      syncJobs.forEach(job => {
        console.log(`   ${job.entity_type}: ${job.status} (${job.records_processed} records)`);
      });
    } catch (error) {
      console.log(`\n🔄 Sync jobs table may have different schema: ${error.message}`);
    }
    
    // Sample some actual data
    const sampleCampaign = await db.client('campaigns').where('organization_id', orgId).first();
    if (sampleCampaign) {
      console.log(`\n📢 Sample Campaign: "${sampleCampaign.name}" (ID: ${sampleCampaign.classy_id})`);
    }
    
    const sampleSupporter = await db.client('supporters').where('organization_id', orgId).first();
    if (sampleSupporter) {
      console.log(`👤 Sample Supporter: ${sampleSupporter.email_address || 'No email'} (ID: ${sampleSupporter.classy_id})`);
    }
    
  } catch (error) {
    console.error('Error checking data:', error);
  } finally {
    await db.close();
  }
}

checkData();