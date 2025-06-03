const logger = require('../utils/logger');

/**
 * Base class for all third-party integration plugins
 */
class BasePlugin {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.enabled = config.enabled !== false;
  }

  /**
   * Initialize the plugin (setup connections, validate config, etc.)
   */
  async initialize() {
    if (!this.enabled) {
      logger.info(`Plugin ${this.name} is disabled`);
      return;
    }

    logger.info(`Initializing plugin: ${this.name}`);
    
    try {
      await this.setup();
      logger.info(`Successfully initialized plugin: ${this.name}`);
    } catch (error) {
      logger.error(`Failed to initialize plugin ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Process data with this plugin
   */
  async process(data, options = {}) {
    if (!this.enabled) {
      logger.debug(`Skipping disabled plugin: ${this.name}`);
      return { skipped: true, reason: 'Plugin disabled' };
    }

    const { dryRun = false } = options;

    try {
      logger.debug(`Processing data with plugin: ${this.name}`, {
        dataType: data.type,
        recordCount: Array.isArray(data.records) ? data.records.length : 1,
        dryRun
      });

      if (dryRun) {
        return this.dryRunProcess(data, options);
      }

      const result = await this.execute(data, options);
      
      logger.debug(`Successfully processed data with plugin: ${this.name}`, result);
      return result;
      
    } catch (error) {
      logger.error(`Failed to process data with plugin ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Gracefully shutdown the plugin
   */
  async shutdown() {
    if (!this.enabled) {
      return;
    }

    logger.info(`Shutting down plugin: ${this.name}`);
    
    try {
      await this.cleanup();
      logger.info(`Successfully shut down plugin: ${this.name}`);
    } catch (error) {
      logger.error(`Error shutting down plugin ${this.name}:`, error);
    }
  }

  /**
   * Check if plugin is healthy and ready
   */
  async healthCheck() {
    if (!this.enabled) {
      return { healthy: true, status: 'disabled' };
    }

    try {
      const result = await this.checkHealth();
      return { healthy: true, ...result };
    } catch (error) {
      return { 
        healthy: false, 
        error: error.message,
        status: 'error'
      };
    }
  }

  // Abstract methods that must be implemented by child classes

  /**
   * Setup the plugin (validate config, establish connections, etc.)
   */
  async setup() {
    throw new Error('setup() must be implemented by child class');
  }

  /**
   * Execute the actual plugin logic
   */
  async execute(data, options) {
    throw new Error('execute() must be implemented by child class');
  }

  /**
   * Simulate processing for dry run mode
   */
  dryRunProcess(data, options) {
    return {
      dryRun: true,
      message: `Would process ${Array.isArray(data.records) ? data.records.length : 1} records with ${this.name}`,
      plugin: this.name
    };
  }

  /**
   * Cleanup resources on shutdown (optional)
   */
  async cleanup() {
    // Optional - override if needed
  }

  /**
   * Check plugin health (optional)
   */
  async checkHealth() {
    return { status: 'ok' };
  }
}

module.exports = BasePlugin;