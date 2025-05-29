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
      return await this.knex.raw(sql, params);
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

  // Database type detection
  get type() {
    if (!this.knex) {
      return process.env.DB_TYPE || 'sqlite';
    }
    return this.knex.client.config.client;
  }

  get client() {
    return this.knex;
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