#!/usr/bin/env node

const { getInstance } = require('../src/core/knex-database');
const logger = require('../src/utils/logger');

async function checkDatabaseData() {
  const db = getInstance();
  
  try {
    // Connect to database
    await db.connect();
    console.log('Connected to database successfully');
    
    // Organization ID to check
    const orgId = 1;
    
    console.log(`\n=== Database Data Check for Organization ${orgId} ===\n`);
    
    // Check record counts for each table
    const tables = ['campaigns', 'supporters', 'transactions', 'recurring_plans'];
    
    for (const table of tables) {
      try {
        const count = await db.table(table)
          .where('organization_id', orgId)
          .count('* as count')
          .first();
        
        console.log(`${table}: ${count.count} records`);
        
        // Get latest records to show recent data
        const latest = await db.table(table)
          .where('organization_id', orgId)
          .orderBy('updated_at', 'desc')
          .limit(3)
          .select('id', 'created_at', 'updated_at');
        
        if (latest.length > 0) {
          console.log(`  Latest ${latest.length} records:`);
          latest.forEach(record => {
            console.log(`    ID: ${record.id}, Created: ${record.created_at}, Updated: ${record.updated_at}`);
          });
        }
        console.log('');
        
      } catch (error) {
        console.log(`${table}: Error checking table - ${error.message}`);
      }
    }
    
    // Check sync_jobs table
    console.log('=== Sync Jobs History ===\n');
    
    try {
      const syncJobs = await db.table('sync_jobs')
        .where('organization_id', orgId)
        .orderBy('started_at', 'desc')
        .limit(10)
        .select('*');
      
      if (syncJobs.length > 0) {
        console.log(`Found ${syncJobs.length} recent sync jobs:`);
        syncJobs.forEach((job, index) => {
          console.log(`\n${index + 1}. Job ID: ${job.id}`);
          console.log(`   Job Type: ${job.job_type}`);
          console.log(`   Status: ${job.status}`);
          console.log(`   Started: ${job.started_at}`);
          console.log(`   Completed: ${job.completed_at || 'Not completed'}`);
          console.log(`   Records Processed: ${job.records_processed || 0}`);
          console.log(`   Records Updated: ${job.records_updated || 0}`);
          console.log(`   Records Created: ${job.records_created || 0}`);
          if (job.error_message) {
            console.log(`   Error: ${job.error_message}`);
          }
          if (job.metadata) {
            console.log(`   Metadata: ${job.metadata}`);
          }
        });
      } else {
        console.log('No sync jobs found for this organization');
      }
      
    } catch (error) {
      console.log(`Error checking sync_jobs: ${error.message}`);
    }
    
    // Check for error logs in recent sync jobs
    console.log('\n=== Error Analysis ===\n');
    
    try {
      const errorJobs = await db.table('sync_jobs')
        .where('organization_id', orgId)
        .where('status', 'failed')
        .orderBy('started_at', 'desc')
        .limit(5)
        .select('*');
      
      if (errorJobs.length > 0) {
        console.log(`Found ${errorJobs.length} failed sync jobs:`);
        errorJobs.forEach((job, index) => {
          console.log(`\n${index + 1}. Failed Job: ${job.job_type}`);
          console.log(`   Started: ${job.started_at}`);
          console.log(`   Error: ${job.error_message}`);
        });
      } else {
        console.log('No failed sync jobs found');
      }
      
    } catch (error) {
      console.log(`Error checking failed jobs: ${error.message}`);
    }
    
    // Check API credential status by looking at recent successful sync jobs
    console.log('\n=== API Credential Status ===\n');
    
    try {
      const recentSuccessful = await db.table('sync_jobs')
        .where('organization_id', orgId)
        .where('status', 'completed')
        .orderBy('started_at', 'desc')
        .limit(3)
        .select('job_type', 'started_at', 'records_processed');
      
      if (recentSuccessful.length > 0) {
        console.log('Recent successful sync jobs (indicating working API credentials):');
        recentSuccessful.forEach((job, index) => {
          console.log(`${index + 1}. ${job.job_type}: ${job.records_processed} records (${job.started_at})`);
        });
      } else {
        console.log('No recent successful sync jobs found - may indicate API credential issues');
      }
      
    } catch (error) {
      console.log(`Error checking API credential status: ${error.message}`);
    }
    
    // Check database schema to make sure tables exist
    console.log('\n=== Database Schema Verification ===\n');
    
    try {
      const allTables = ['campaigns', 'supporters', 'transactions', 'recurring_plans', 'sync_jobs'];
      
      for (const table of allTables) {
        const exists = await db.schema().hasTable(table);
        console.log(`Table '${table}': ${exists ? 'EXISTS' : 'MISSING'}`);
      }
      
    } catch (error) {
      console.log(`Error checking schema: ${error.message}`);
    }
    
    // Summary
    console.log('\n=== Summary ===\n');
    
    try {
      const totalRecords = await Promise.all([
        db.table('campaigns').where('organization_id', orgId).count('* as count').first(),
        db.table('supporters').where('organization_id', orgId).count('* as count').first(),
        db.table('transactions').where('organization_id', orgId).count('* as count').first(),
        db.table('recurring_plans').where('organization_id', orgId).count('* as count').first()
      ]);
      
      const [campaigns, supporters, transactions, recurring] = totalRecords;
      const total = parseInt(campaigns.count) + parseInt(supporters.count) + parseInt(transactions.count) + parseInt(recurring.count);
      
      console.log(`Total records for organization ${orgId}: ${total}`);
      console.log(`- Campaigns: ${campaigns.count}`);
      console.log(`- Supporters: ${supporters.count}`);
      console.log(`- Transactions: ${transactions.count}`);
      console.log(`- Recurring Plans: ${recurring.count}`);
      
      // Check last sync time
      const lastSync = await db.table('sync_jobs')
        .where('organization_id', orgId)
        .where('status', 'completed')
        .orderBy('completed_at', 'desc')
        .first();
      
      if (lastSync) {
        console.log(`\nLast successful sync: ${lastSync.completed_at} (${lastSync.job_type})`);
      } else {
        console.log('\nNo successful syncs found');
      }
      
    } catch (error) {
      console.log(`Error generating summary: ${error.message}`);
    }
    
  } catch (error) {
    console.error('Error checking database data:', error);
  } finally {
    await db.close();
  }
}

// Run the check
checkDatabaseData()
  .then(() => {
    console.log('\nDatabase check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Database check failed:', error);
    process.exit(1);
  });