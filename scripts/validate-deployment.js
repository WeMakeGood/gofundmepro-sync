#!/usr/bin/env node

require('dotenv').config();
const { getInstance: getDatabase } = require('../src/core/database');
const logger = require('../src/utils/logger');

class DeploymentValidator {
  constructor() {
    this.db = getDatabase();
    this.errors = [];
    this.warnings = [];
    this.success = [];
  }

  async validate() {
    console.log('🔍 Starting deployment validation...\n');
    
    try {
      await this.db.connect();
      
      // Run all validation checks
      await this.validateDatabaseConnection();
      await this.validateRequiredTables();
      await this.validateRequiredViews();
      await this.validateMigrationStatus();
      await this.validateDataIntegrity();
      await this.validateViewPerformance();
      
      // Report results
      this.printResults();
      
    } catch (error) {
      this.errors.push(`Critical validation error: ${error.message}`);
      this.printResults();
      process.exit(1);
    } finally {
      await this.db.close();
    }
  }

  async validateDatabaseConnection() {
    try {
      const result = await this.db.query('SELECT 1 as test');
      if (result && result[0]?.test === 1) {
        this.success.push('✅ Database connection successful');
      } else {
        this.errors.push('❌ Database connection test failed');
      }
    } catch (error) {
      this.errors.push(`❌ Database connection failed: ${error.message}`);
    }
  }

  async validateRequiredTables() {
    const requiredTables = [
      'organizations', 'campaigns', 'supporters', 'recurring_plans',
      'transactions', 'fundraising_teams', 'fundraising_pages',
      'sync_jobs', 'migrations', 'donor_segmentation_config'
    ];

    try {
      const tables = await this.db.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = DATABASE()
      `);
      
      const existingTables = tables.map(t => t.table_name || t.TABLE_NAME);
      
      for (const table of requiredTables) {
        if (existingTables.includes(table)) {
          this.success.push(`✅ Required table exists: ${table}`);
        } else {
          this.errors.push(`❌ Missing required table: ${table}`);
        }
      }
    } catch (error) {
      this.errors.push(`❌ Table validation failed: ${error.message}`);
    }
  }

  async validateRequiredViews() {
    const requiredViews = [
      'campaign_performance', 'supporter_summary',
      'donor_value_distribution', 'donor_engagement_distribution'
    ];

    try {
      const views = await this.db.query(`
        SELECT table_name 
        FROM information_schema.views 
        WHERE table_schema = DATABASE()
      `);
      
      const existingViews = views.map(v => v.table_name || v.TABLE_NAME);
      
      for (const view of requiredViews) {
        if (existingViews.includes(view)) {
          this.success.push(`✅ Required view exists: ${view}`);
        } else {
          this.errors.push(`❌ Missing required view: ${view}`);
        }
      }
    } catch (error) {
      this.errors.push(`❌ View validation failed: ${error.message}`);
    }
  }

  async validateMigrationStatus() {
    try {
      const migrations = await this.db.query(`
        SELECT version, name, applied_at 
        FROM migrations 
        ORDER BY version
      `);

      if (migrations.length === 0) {
        this.errors.push('❌ No migrations found in database');
        return;
      }

      const expectedMigrations = ['001', '002', '003'];
      const appliedVersions = migrations.map(m => m.version);

      for (const expectedVersion of expectedMigrations) {
        if (appliedVersions.includes(expectedVersion)) {
          const migration = migrations.find(m => m.version === expectedVersion);
          this.success.push(`✅ Migration ${expectedVersion} applied: ${migration.name}`);
        } else {
          this.warnings.push(`⚠️  Missing migration: ${expectedVersion}`);
        }
      }

      this.success.push(`✅ Total migrations applied: ${migrations.length}`);
      
    } catch (error) {
      this.errors.push(`❌ Migration status check failed: ${error.message}`);
    }
  }

  async validateDataIntegrity() {
    try {
      // Check for orphaned records
      const orphanedTransactions = await this.db.query(`
        SELECT COUNT(*) as count
        FROM transactions t 
        LEFT JOIN supporters s ON t.supporter_id = s.id 
        WHERE t.supporter_id IS NOT NULL AND s.id IS NULL
      `);

      if (orphanedTransactions[0].count === 0) {
        this.success.push('✅ No orphaned transactions found');
      } else {
        this.warnings.push(`⚠️  Found ${orphanedTransactions[0].count} orphaned transactions`);
      }

      // Check supporter lifetime amounts
      const nullAmounts = await this.db.query(`
        SELECT COUNT(*) as count
        FROM supporters 
        WHERE lifetime_donation_amount IS NULL AND lifetime_donation_count > 0
      `);

      if (nullAmounts[0].count === 0) {
        this.success.push('✅ All supporters with donations have calculated lifetime amounts');
      } else {
        this.warnings.push(`⚠️  Found ${nullAmounts[0].count} supporters with missing lifetime amounts`);
      }

    } catch (error) {
      this.warnings.push(`⚠️  Data integrity check incomplete: ${error.message}`);
    }
  }

  async validateViewPerformance() {
    const views = [
      'supporter_summary',
      'donor_value_distribution', 
      'donor_engagement_distribution',
      'campaign_performance'
    ];

    for (const view of views) {
      try {
        const startTime = Date.now();
        const result = await this.db.query(`SELECT COUNT(*) as count FROM ${view}`);
        const duration = Date.now() - startTime;

        if (duration < 5000) { // Under 5 seconds
          this.success.push(`✅ View ${view} performs well (${duration}ms, ${result[0].count} records)`);
        } else {
          this.warnings.push(`⚠️  View ${view} slow performance (${duration}ms, ${result[0].count} records)`);
        }
      } catch (error) {
        this.errors.push(`❌ View ${view} failed: ${error.message}`);
      }
    }
  }

  printResults() {
    console.log('\n📊 VALIDATION RESULTS');
    console.log('====================\n');

    if (this.success.length > 0) {
      console.log('✅ SUCCESS:');
      this.success.forEach(msg => console.log(`   ${msg}`));
      console.log('');
    }

    if (this.warnings.length > 0) {
      console.log('⚠️  WARNINGS:');
      this.warnings.forEach(msg => console.log(`   ${msg}`));
      console.log('');
    }

    if (this.errors.length > 0) {
      console.log('❌ ERRORS:');
      this.errors.forEach(msg => console.log(`   ${msg}`));
      console.log('');
    }

    console.log('📈 SUMMARY:');
    console.log(`   Successful checks: ${this.success.length}`);
    console.log(`   Warnings: ${this.warnings.length}`);
    console.log(`   Errors: ${this.errors.length}`);

    if (this.errors.length === 0) {
      console.log('\n🎉 Deployment validation PASSED! Database is ready for production.');
      process.exit(0);
    } else {
      console.log('\n💥 Deployment validation FAILED! Please address errors before proceeding.');
      process.exit(1);
    }
  }
}

// CLI Interface
async function main() {
  const validator = new DeploymentValidator();
  await validator.validate();
}

if (require.main === module) {
  main();
}

module.exports = DeploymentValidator;