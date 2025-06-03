/**
 * Database Configuration and Connection Management
 * 
 * Single source of truth for database connections using Knex.js
 * Supports SQLite (development), MySQL, and PostgreSQL (production)
 */

const knex = require('knex');
const knexConfig = require('../../knexfile');

class DatabaseConfig {
  constructor() {
    this.knex = null;
    this.environment = process.env.NODE_ENV || 'development';
  }

  /**
   * Initialize database connection
   * @returns {Promise<Object>} Knex instance
   */
  async initialize() {
    if (this.knex) {
      return this.knex;
    }

    const config = knexConfig[this.environment];
    if (!config) {
      throw new Error(`No database configuration found for environment: ${this.environment}`);
    }

    this.knex = knex(config);

    // Test connection
    try {
      await this.knex.raw('SELECT 1');
      console.log(`Database connected successfully (${this.environment})`);
    } catch (error) {
      console.error('Database connection failed:', error.message);
      throw error;
    }

    return this.knex;
  }

  /**
   * Get the current Knex instance
   * @returns {Object} Knex instance
   */
  getKnex() {
    if (!this.knex) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.knex;
  }

  /**
   * Run migrations
   * @returns {Promise<Array>} Migration results
   */
  async migrate() {
    const knex = this.getKnex();
    return await knex.migrate.latest();
  }

  /**
   * Rollback migrations
   * @param {boolean} all - Rollback all migrations
   * @returns {Promise<Array>} Rollback results
   */
  async rollback(all = false) {
    const knex = this.getKnex();
    if (all) {
      return await knex.migrate.rollback({}, true);
    }
    return await knex.migrate.rollback();
  }

  /**
   * Run seeds
   * @returns {Promise<Array>} Seed results
   */
  async seed() {
    const knex = this.getKnex();
    return await knex.seed.run();
  }

  /**
   * Close database connection
   * @returns {Promise<void>}
   */
  async close() {
    if (this.knex) {
      await this.knex.destroy();
      this.knex = null;
    }
  }

  /**
   * Health check for database connection
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const knex = this.getKnex();
      const result = await knex.raw('SELECT 1 as health');
      return {
        status: 'healthy',
        environment: this.environment,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        environment: this.environment,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get database statistics
   * @returns {Promise<Object>} Database stats
   */
  async getStats() {
    const knex = this.getKnex();
    
    try {
      const [
        organizationsCount,
        supportersCount,
        campaignsCount,
        transactionsCount,
        recurringPlansCount
      ] = await Promise.all([
        knex('organizations').count('* as count').first(),
        knex('supporters').count('* as count').first(),
        knex('campaigns').count('* as count').first(),
        knex('transactions').count('* as count').first(),
        knex('recurring_plans').count('* as count').first()
      ]);

      return {
        organizations: parseInt(organizationsCount.count),
        supporters: parseInt(supportersCount.count),
        campaigns: parseInt(campaignsCount.count),
        transactions: parseInt(transactionsCount.count),
        recurring_plans: parseInt(recurringPlansCount.count),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // Tables might not exist yet
      return {
        error: 'Tables not found - run migrations first',
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Export singleton instance
const databaseConfig = new DatabaseConfig();

module.exports = {
  DatabaseConfig,
  database: databaseConfig,
  
  // Direct access to Knex instance (for convenience)
  getKnex: () => databaseConfig.getKnex()
};