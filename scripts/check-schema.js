#!/usr/bin/env node

const { getInstance } = require('../src/core/knex-database');

async function checkSchema() {
  const db = getInstance();
  
  try {
    await db.connect();
    console.log('Connected to database successfully\n');
    
    // Get all tables in the database
    const tables = await db.query('SHOW TABLES');
    console.log('=== All Tables in Database ===');
    tables.forEach(table => {
      const tableName = Object.values(table)[0];
      console.log(`- ${tableName}`);
    });
    
    // Check specific tables that should exist
    console.log('\n=== Expected Tables Check ===');
    const expectedTables = ['campaigns', 'supporters', 'transactions', 'sync_jobs', 'organizations'];
    
    for (const table of expectedTables) {
      const exists = await db.schema().hasTable(table);
      console.log(`${table}: ${exists ? 'EXISTS' : 'MISSING'}`);
      
      if (exists) {
        // Get table structure
        const columns = await db.query(`DESCRIBE ${table}`);
        console.log(`  Columns: ${columns.map(col => col.Field).join(', ')}`);
      }
    }
    
    // Check if there are any sync jobs at all
    console.log('\n=== All Sync Jobs ===');
    try {
      const allJobs = await db.table('sync_jobs').select('*').limit(10);
      if (allJobs.length > 0) {
        console.log(`Found ${allJobs.length} sync jobs total:`);
        allJobs.forEach((job, index) => {
          console.log(`${index + 1}. Org: ${job.organization_id}, Type: ${job.job_type}, Status: ${job.status}, Started: ${job.started_at}`);
        });
      } else {
        console.log('No sync jobs found in database');
      }
    } catch (error) {
      console.log(`Error checking sync jobs: ${error.message}`);
    }
    
    // Check if organizations table has data
    console.log('\n=== Organizations ===');
    try {
      const orgs = await db.table('organizations').select('*');
      if (orgs.length > 0) {
        console.log(`Found ${orgs.length} organizations:`);
        orgs.forEach(org => {
          console.log(`- ID: ${org.id}, Name: ${org.name || 'N/A'}, Created: ${org.created_at}`);
        });
      } else {
        console.log('No organizations found');
      }
    } catch (error) {
      console.log(`Error checking organizations: ${error.message}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.close();
  }
}

checkSchema()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Failed:', error);
    process.exit(1);
  });