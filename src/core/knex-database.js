const knex = require('knex');
const logger = require('../utils/logger');

class KnexDatabase {
  constructor() {
    this.knex = null;
    this.connected = false;
  }

  async connect() {
    if (this.connected && this.knex) {
      return this.knex;
    }

    try {
      const knexConfig = require('../../knexfile');
      const config = knexConfig.current();
      
      logger.info(`Connecting to ${config.client} database...`);
      
      this.knex = knex(config);
      
      // Test connection
      await this.knex.raw('SELECT 1');
      
      this.connected = true;
      logger.info('Database connection established successfully');
      
      return this.knex;
    } catch (error) {
      logger.error('Database connection failed:', error);
      throw error;
    }
  }

  async close() {
    if (this.knex) {
      await this.knex.destroy();
      this.connected = false;
      logger.info('Database connection closed');
    }
  }

  async query(sql, params = []) {
    if (!this.connected) {
      await this.connect();
    }
    
    try {
      const result = await this.knex.raw(sql, params);
      
      // Handle different database result formats
      if (this.knex.client.config.client === 'mysql2' || this.knex.client.config.client === 'mysql') {
        // MySQL returns [rows, fields] - we want just the rows
        return result[0];
      } else if (this.knex.client.config.client === 'sqlite3') {
        // SQLite returns rows directly
        return result;
      } else {
        // PostgreSQL and others typically return rows directly
        return result.rows || result;
      }
    } catch (error) {
      logger.error('Query failed:', { sql, params, error: error.message });
      throw error;
    }
  }

  async beginTransaction() {
    if (!this.connected) {
      await this.connect();
    }
    return await this.knex.transaction();
  }

  async commit(trx) {
    return await trx.commit();
  }

  async rollback(trx) {
    return await trx.rollback();
  }

  // Knex query builder methods
  table(tableName) {
    if (!this.connected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.knex(tableName);
  }

  schema() {
    if (!this.connected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.knex.schema;
  }

  // Migration helpers
  async migrate() {
    if (!this.connected) {
      await this.connect();
    }
    return await this.knex.migrate.latest();
  }

  async rollbackMigration() {
    if (!this.connected) {
      await this.connect();
    }
    return await this.knex.migrate.rollback();
  }

  async rollbackAllMigrations() {
    if (!this.connected) {
      await this.connect();
    }
    
    // Keep rolling back until no more batches exist
    let rollbackResult;
    let totalRolledBack = 0;
    
    do {
      rollbackResult = await this.knex.migrate.rollback();
      if (rollbackResult && rollbackResult[1] && rollbackResult[1].length > 0) {
        totalRolledBack += rollbackResult[1].length;
        logger.info(`Rolled back ${rollbackResult[1].length} migrations`);
      }
    } while (rollbackResult && rollbackResult[1] && rollbackResult[1].length > 0);
    
    logger.info(`Total migrations rolled back: ${totalRolledBack}`);
    return totalRolledBack;
  }

  async migrationStatus() {
    if (!this.connected) {
      await this.connect();
    }
    return await this.knex.migrate.status();
  }

  // Seed helpers
  async seed() {
    if (!this.connected) {
      await this.connect();
    }
    return await this.knex.seed.run();
  }

  // Database type detection for SQL syntax compatibility
  get type() {
    if (!this.knex) {
      return process.env.DB_TYPE || 'sqlite';
    }
    const client = this.knex.client.config.client;
    // Normalize database type for SQL syntax compatibility
    if (client === 'mysql2' || client === 'mysql') {
      return 'mysql';
    } else if (client === 'sqlite3') {
      return 'sqlite';
    } else {
      return 'pg'; // PostgreSQL
    }
  }

  get client() {
    return this.knex;
  }

  // Health check method
  async healthCheck() {
    try {
      if (!this.connected) {
        await this.connect();
      }
      
      // Test database connection
      await this.knex.raw('SELECT 1');
      
      return {
        status: 'ok',
        connected: this.connected,
        type: this.type,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new KnexDatabase();
  }
  return instance;
}

module.exports = {
  KnexDatabase,
  getInstance
};