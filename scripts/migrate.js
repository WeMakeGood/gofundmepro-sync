#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const { getInstance: getDatabase } = require('../src/core/database');
const logger = require('../src/utils/logger');

class MigrationRunner {
  constructor() {
    this.db = getDatabase();
    this.migrationsDir = path.join(__dirname, '../migrations');
  }

  async run() {
    try {
      await this.db.connect();
      
      // Ensure migrations table exists
      await this.ensureMigrationsTable();
      
      // Get pending migrations
      const pendingMigrations = await this.getPendingMigrations();
      
      if (pendingMigrations.length === 0) {
        logger.info('No pending migrations found');
        return;
      }
      
      logger.info(`Found ${pendingMigrations.length} pending migrations`);
      
      // Run each migration
      for (const migration of pendingMigrations) {
        await this.runMigration(migration);
      }
      
      logger.info('All migrations completed successfully');
      
    } catch (error) {
      logger.error('Migration failed:', error);
      process.exit(1);
    } finally {
      await this.db.close();
    }
  }

  async ensureMigrationsTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(255),
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    await this.db.query(createTableSQL);
  }

  async getPendingMigrations() {
    // Get all migration files
    const migrationFiles = await this.getMigrationFiles();
    
    // Get applied migrations
    const appliedMigrations = await this.getAppliedMigrations();
    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    
    // Filter to pending migrations
    return migrationFiles.filter(migration => 
      !appliedVersions.has(migration.version)
    );
  }

  async getMigrationFiles() {
    try {
      const files = await fs.readdir(this.migrationsDir);
      const migrations = [];
      
      for (const file of files) {
        if (file.endsWith('.sql')) {
          const match = file.match(/^(\d+)_(.+)\.sql$/);
          if (match) {
            migrations.push({
              version: match[1],
              name: match[2],
              filename: file,
              path: path.join(this.migrationsDir, file)
            });
          }
        }
      }
      
      // Sort by version number
      return migrations.sort((a, b) => 
        parseInt(a.version) - parseInt(b.version)
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn('Migrations directory does not exist');
        return [];
      }
      throw error;
    }
  }

  async getAppliedMigrations() {
    try {
      return await this.db.query(
        'SELECT * FROM migrations ORDER BY version'
      );
    } catch (error) {
      // If migrations table doesn't exist, return empty array
      return [];
    }
  }

  async runMigration(migration) {
    logger.info(`Running migration ${migration.version}: ${migration.name}`);
    
    try {
      // Read migration SQL
      const migrationSQL = await fs.readFile(migration.path, 'utf8');
      
      // Split SQL into individual statements
      const statements = this.splitSQL(migrationSQL);
      
      // Begin transaction
      await this.db.beginTransaction();
      
      try {
        // Execute each statement
        for (const statement of statements) {
          if (statement.trim()) {
            await this.db.query(statement);
          }
        }
        
        // Record migration as applied (if not already recorded)
        const recordSQL = `
          INSERT OR IGNORE INTO migrations (version, name) 
          VALUES (?, ?)
        `;
        await this.db.query(recordSQL, [migration.version, migration.name]);
        
        // Commit transaction
        await this.db.commit();
        
        logger.info(`Migration ${migration.version} completed successfully`);
        
      } catch (error) {
        // Rollback on error
        await this.db.rollback();
        throw error;
      }
      
    } catch (error) {
      logger.error(`Migration ${migration.version} failed:`, error);
      throw error;
    }
  }

  splitSQL(sql) {
    // Remove comments and split on semicolons
    const lines = sql.split('\n');
    const cleanLines = lines
      .filter(line => !line.trim().startsWith('--'))
      .map(line => line.trim())
      .filter(line => line);
    
    const cleanSQL = cleanLines.join(' ');
    
    // Split on semicolons but keep them for each statement
    return cleanSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt)
      .map(stmt => stmt + ';');
  }

  async rollback(targetVersion = null) {
    try {
      await this.db.connect();
      
      const appliedMigrations = await this.getAppliedMigrations();
      
      if (appliedMigrations.length === 0) {
        logger.info('No migrations to rollback');
        return;
      }
      
      // Determine which migrations to rollback
      let migrationsToRollback;
      if (targetVersion) {
        migrationsToRollback = appliedMigrations
          .filter(m => parseInt(m.version) > parseInt(targetVersion))
          .reverse();
      } else {
        // Rollback just the last migration
        migrationsToRollback = [appliedMigrations[appliedMigrations.length - 1]];
      }
      
      logger.warn(`Rolling back ${migrationsToRollback.length} migrations`);
      
      for (const migration of migrationsToRollback) {
        await this.rollbackMigration(migration);
      }
      
      logger.info('Rollback completed successfully');
      
    } catch (error) {
      logger.error('Rollback failed:', error);
      process.exit(1);
    } finally {
      await this.db.close();
    }
  }

  async rollbackMigration(migration) {
    logger.warn(`Rolling back migration ${migration.version}: ${migration.name}`);
    
    // Check for rollback SQL file
    const rollbackPath = path.join(
      this.migrationsDir, 
      `${migration.version}_${migration.name}_rollback.sql`
    );
    
    try {
      const rollbackSQL = await fs.readFile(rollbackPath, 'utf8');
      const statements = this.splitSQL(rollbackSQL);
      
      await this.db.beginTransaction();
      
      try {
        // Execute rollback statements
        for (const statement of statements) {
          if (statement.trim()) {
            await this.db.query(statement);
          }
        }
        
        // Remove migration record
        await this.db.query(
          'DELETE FROM migrations WHERE version = ?',
          [migration.version]
        );
        
        await this.db.commit();
        
        logger.info(`Migration ${migration.version} rolled back successfully`);
        
      } catch (error) {
        await this.db.rollback();
        throw error;
      }
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.error(`No rollback file found for migration ${migration.version}`);
        logger.error('Manual rollback required');
      } else {
        logger.error(`Rollback of migration ${migration.version} failed:`, error);
      }
      throw error;
    }
  }

  async status() {
    try {
      await this.db.connect();
      
      const migrationFiles = await this.getMigrationFiles();
      const appliedMigrations = await this.getAppliedMigrations();
      const appliedVersions = new Set(appliedMigrations.map(m => m.version));
      
      console.log('\nMigration Status:');
      console.log('================');
      
      for (const migration of migrationFiles) {
        const status = appliedVersions.has(migration.version) ? 'APPLIED' : 'PENDING';
        const appliedAt = appliedVersions.has(migration.version) 
          ? appliedMigrations.find(m => m.version === migration.version).applied_at
          : '';
        
        console.log(`${migration.version}: ${migration.name} [${status}] ${appliedAt}`);
      }
      
      const pendingCount = migrationFiles.length - appliedMigrations.length;
      console.log(`\nTotal: ${migrationFiles.length}, Applied: ${appliedMigrations.length}, Pending: ${pendingCount}`);
      
    } catch (error) {
      logger.error('Failed to get migration status:', error);
      process.exit(1);
    } finally {
      await this.db.close();
    }
  }
}

// CLI Interface
async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  const runner = new MigrationRunner();
  
  switch (command) {
    case 'up':
    case 'migrate':
      await runner.run();
      break;
      
    case 'down':
    case 'rollback':
      await runner.rollback(arg);
      break;
      
    case 'status':
      await runner.status();
      break;
      
    default:
      console.log('Usage:');
      console.log('  node migrate.js up|migrate     - Run pending migrations');
      console.log('  node migrate.js down|rollback [version] - Rollback migrations');
      console.log('  node migrate.js status         - Show migration status');
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = MigrationRunner;