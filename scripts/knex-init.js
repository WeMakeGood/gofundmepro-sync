#!/usr/bin/env node

require('dotenv').config();

const { getInstance: getKnexDatabase } = require('../src/core/knex-database');
const logger = require('../src/utils/logger');

class KnexInitializer {
  constructor() {
    this.db = getKnexDatabase();
  }

  async reset() {
    const confirmation = process.env.CONFIRM_RESET;
    if (confirmation !== 'yes') {
      console.error('❌ Database reset cancelled. Set CONFIRM_RESET=yes to proceed.');
      process.exit(1);
    }

    console.log('⚠️  Resetting database - ALL DATA WILL BE LOST!');
    
    try {
      await this.db.connect();
      
      // Rollback all migrations (this will drop tables)
      console.log('🗑️  Rolling back all migrations...');
      await this.db.rollbackMigration();
      
      console.log('🎉 Database reset completed');
      
    } catch (error) {
      console.error('💥 Database reset failed:', error.message);
      logger.error('Database reset failed:', error);
      process.exit(1);
    }
  }

  async init() {
    console.log('🚀 Initializing database with Knex...');
    
    try {
      await this.db.connect();
      
      console.log('✅ Database connection established');
      
      // Run migrations
      console.log('📋 Running database migrations...');
      const [batchNo, migrations] = await this.db.migrate();
      
      if (migrations.length === 0) {
        console.log('✅ No pending migrations found');
      } else {
        console.log(`✅ Applied ${migrations.length} migrations in batch ${batchNo}`);
        migrations.forEach(migration => {
          console.log(`   📝 ${migration}`);
        });
      }
      
      console.log('🎉 Database initialization completed successfully');
      
    } catch (error) {
      console.error('💥 Database initialization failed:', error.message);
      logger.error('Database initialization failed:', error);
      process.exit(1);
    }
  }

  async seed() {
    console.log('🌱 Seeding database...');
    
    try {
      await this.db.connect();
      
      const [seedFiles] = await this.db.seed();
      
      if (seedFiles.length === 0) {
        console.log('✅ No seed files found or already seeded');
      } else {
        console.log('✅ Seeded database with initial data');
        seedFiles.forEach(file => {
          console.log(`   📝 ${file}`);
        });
      }
      
    } catch (error) {
      console.error('💥 Database seeding failed:', error.message);
      logger.error('Database seeding failed:', error);
      process.exit(1);
    }
  }

  async status() {
    console.log('📊 Checking migration status...');
    
    try {
      await this.db.connect();
      
      // Get migration info
      const [completedMigrations] = await this.db.client.migrate.list();
      
      console.log('\nMigration Status:');
      console.log('================');
      
      if (completedMigrations && completedMigrations.length > 0) {
        completedMigrations.forEach(migration => {
          const name = migration.name || migration;
          console.log(`✅ ${name}`);
        });
        console.log(`\nTotal Applied: ${completedMigrations.length}`);
      } else {
        console.log('No migrations applied yet');
      }
      
    } catch (error) {
      console.error('💥 Failed to get migration status:', error.message);
      logger.error('Migration status check failed:', error);
      process.exit(1);
    }
  }

  async validate() {
    console.log('🔍 Validating database schema...');
    
    try {
      await this.db.connect();
      
      const requiredTables = [
        'organizations', 'campaigns', 'supporters', 'transactions',
        'recurring_plans', 'fundraising_teams', 'fundraising_pages',
        'sync_jobs', 'donor_segmentation_config'
      ];

      const requiredViews = [
        'campaign_performance', 'supporter_summary',
        'donor_value_distribution', 'donor_engagement_distribution'
      ];

      let allValid = true;

      // Check tables
      console.log('📋 Checking required tables...');
      for (const table of requiredTables) {
        const exists = await this.db.schema().hasTable(table);
        if (exists) {
          console.log(`   ✅ ${table}`);
        } else {
          console.log(`   ❌ ${table} - MISSING`);
          allValid = false;
        }
      }

      // Check views (using raw query since Knex doesn't have hasView)
      console.log('📊 Checking required views...');
      for (const view of requiredViews) {
        try {
          await this.db.client.raw(`SELECT 1 FROM ${view} LIMIT 1`);
          console.log(`   ✅ ${view}`);
        } catch (error) {
          console.log(`   ❌ ${view} - MISSING`);
          allValid = false;
        }
      }

      if (allValid) {
        console.log('\n🎉 Database validation PASSED! All required objects exist.');
      } else {
        console.log('\n💥 Database validation FAILED! Some required objects are missing.');
        process.exit(1);
      }

    } catch (error) {
      console.error('💥 Database validation failed:', error.message);
      logger.error('Database validation failed:', error);
      process.exit(1);
    }
  }

  async setup() {
    await this.reset();
    await this.init();
    await this.seed();
    await this.validate();
  }

  async close() {
    await this.db.close();
  }
}

// CLI Interface
async function main() {
  const command = process.argv[2];
  const initializer = new KnexInitializer();
  
  try {
    switch (command) {
      case 'init':
        await initializer.init();
        break;
        
      case 'seed':
        await initializer.seed();
        break;
        
      case 'reset':
        await initializer.reset();
        break;
        
      case 'setup':
        await initializer.setup();
        break;
        
      case 'status':
        await initializer.status();
        break;
        
      case 'validate':
        await initializer.validate();
        break;
        
      default:
        console.log('Usage:');
        console.log('  node knex-init.js init     - Run pending migrations');
        console.log('  node knex-init.js seed     - Seed database with initial data');
        console.log('  node knex-init.js reset    - Reset database (requires CONFIRM_RESET=yes)');
        console.log('  node knex-init.js setup    - Complete setup (reset + init + seed + validate)');
        console.log('  node knex-init.js status   - Show migration status');
        console.log('  node knex-init.js validate - Validate database schema');
        process.exit(1);
    }
  } finally {
    await initializer.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = KnexInitializer;