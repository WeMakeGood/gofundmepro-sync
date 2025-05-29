#!/usr/bin/env node

require('dotenv').config();

const { getInstance: getDatabase } = require('../src/core/database');
const logger = require('../src/utils/logger');
const MigrationRunner = require('./migrate');

async function initializeDatabase() {
  logger.info('Initializing database...');
  
  try {
    const db = getDatabase();
    await db.connect();
    
    logger.info('Database connection established');
    
    // Run migrations
    const migrationRunner = new MigrationRunner();
    await migrationRunner.run();
    
    // Reconnect after migrations (migration runner closes connection)
    await db.connect();
    
    // Verify tables exist
    await verifyTables(db);
    
    logger.info('Database initialization completed successfully');
    
    await db.close();
    
  } catch (error) {
    logger.error('Database initialization failed:', error);
    process.exit(1);
  }
}

async function verifyTables(db) {
  const requiredTables = [
    'migrations',
    'organizations',
    'campaigns', 
    'supporters',
    'transactions',
    'recurring_plans',
    'fundraising_teams',
    'fundraising_pages',
    'sync_jobs'
  ];
  
  logger.info('Verifying database tables...');
  
  for (const table of requiredTables) {
    try {
      if (db.type === 'sqlite') {
        const result = await db.query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          [table]
        );
        if (result.length === 0) {
          throw new Error(`Table ${table} not found`);
        }
      } else {
        // MySQL
        const result = await db.query(
          "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
          [process.env.DB_NAME || 'classy_sync', table]
        );
        if (result.length === 0) {
          throw new Error(`Table ${table} not found`);
        }
      }
      
      logger.debug(`✓ Table ${table} exists`);
    } catch (error) {
      logger.error(`✗ Table ${table} verification failed:`, error.message);
      throw error;
    }
  }
  
  logger.info('All required tables verified');
}

async function seedTestData() {
  logger.info('Seeding test data...');
  
  try {
    const db = getDatabase();
    await db.connect();
    
    // Insert sample organization
    await db.query(`
      INSERT OR IGNORE INTO organizations (
        classy_id, name, status, description, created_at, updated_at, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      'org_123456',
      'Test Organization',
      'active',
      'A test organization for development',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString()
    ]);
    
    // Insert sample campaign
    await db.query(`
      INSERT OR IGNORE INTO campaigns (
        classy_id, organization_id, name, status, goal, total_raised,
        donor_count, campaign_type, created_at, updated_at, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'campaign_123456',
      1, // Assuming organization ID 1
      'Test Campaign',
      'active',
      10000.00,
      2500.00,
      25,
      'fundraising',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString()
    ]);
    
    // Insert sample supporter
    await db.query(`
      INSERT OR IGNORE INTO supporters (
        classy_id, email_address, first_name, last_name,
        lifetime_donation_amount, lifetime_donation_count,
        created_at, updated_at, last_sync_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      'supporter_123456',
      'test@example.com',
      'John',
      'Doe',
      500.00,
      2,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
      'synced'
    ]);
    
    logger.info('Test data seeded successfully');
    
    await db.close();
    
  } catch (error) {
    logger.error('Failed to seed test data:', error);
    throw error;
  }
}

async function resetDatabase() {
  logger.warn('Resetting database - ALL DATA WILL BE LOST!');
  
  const confirmation = process.env.CONFIRM_RESET;
  if (confirmation !== 'yes') {
    logger.error('Database reset cancelled. Set CONFIRM_RESET=yes to proceed.');
    process.exit(1);
  }
  
  try {
    const db = getDatabase();
    await db.connect();
    
    const tables = [
      'sync_jobs',
      'fundraising_pages',
      'fundraising_teams', 
      'transactions',
      'recurring_plans',
      'supporters',
      'campaigns',
      'organizations',
      'migrations'
    ];
    
    // Drop tables in reverse order to handle foreign keys
    for (const table of tables) {
      try {
        await db.query(`DROP TABLE IF EXISTS ${table}`);
        logger.info(`Dropped table: ${table}`);
      } catch (error) {
        logger.warn(`Failed to drop table ${table}:`, error.message);
      }
    }
    
    logger.info('Database reset completed');
    
    await db.close();
    
  } catch (error) {
    logger.error('Database reset failed:', error);
    throw error;
  }
}

// CLI Interface
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'init':
      await initializeDatabase();
      break;
      
    case 'seed':
      await seedTestData();
      break;
      
    case 'reset':
      await resetDatabase();
      break;
      
    case 'setup':
      await resetDatabase();
      await initializeDatabase();
      await seedTestData();
      break;
      
    default:
      console.log('Usage:');
      console.log('  node init-db.js init   - Initialize database with migrations');
      console.log('  node init-db.js seed   - Add test data');
      console.log('  node init-db.js reset  - Reset database (requires CONFIRM_RESET=yes)');
      console.log('  node init-db.js setup  - Reset, initialize, and seed database');
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  initializeDatabase,
  seedTestData,
  resetDatabase
};