/**
 * Base Plugin Class
 * 
 * Abstract base class for all third-party integrations
 * Provides common patterns for plugin initialization, processing, and cleanup
 */

const { createLogger } = require('../utils/logger');

class BasePlugin {
  constructor(name, config = {}, dependencies = {}) {
    this.name = name;
    this.config = config;
    this.dependencies = dependencies;
    this.logger = createLogger(`plugin:${name}`);
    this.initialized = false;
    this.healthStatus = 'unknown';
  }

  /**
   * Initialize the plugin
   * Sets up connections, validates configuration, and prepares for processing
   * @returns {Promise<void>}
   */
  async initialize() {
    this.logger.info(`Initializing ${this.name} plugin`);
    
    try {
      // Validate configuration
      await this.validateConfig();
      
      // Perform plugin-specific setup
      await this.setup();
      
      // Run initial health check
      const health = await this.healthCheck();
      this.healthStatus = health.status;
      
      this.initialized = true;
      this.logger.info(`${this.name} plugin initialized successfully`, {
        healthStatus: this.healthStatus
      });
      
    } catch (error) {
      this.logger.error(`Failed to initialize ${this.name} plugin`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate plugin configuration
   * @returns {Promise<void>}
   */
  async validateConfig() {
    const requiredFields = this.getRequiredConfigFields();
    const missingFields = [];

    for (const field of requiredFields) {
      if (!this.config[field]) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      throw new Error(`Missing required configuration fields: ${missingFields.join(', ')}`);
    }

    this.logger.debug('Configuration validated successfully');
  }

  /**
   * Get required configuration fields (to be implemented by subclasses)
   * @returns {Array<string>} Array of required field names
   */
  getRequiredConfigFields() {
    return [];
  }

  /**
   * Plugin-specific setup (to be implemented by subclasses)
   * @returns {Promise<void>}
   */
  async setup() {
    // Default implementation - no setup required
  }

  /**
   * Process data with this plugin
   * @param {Object} data - Data to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  async process(data, options = {}) {
    if (!this.initialized) {
      throw new Error(`Plugin ${this.name} not initialized. Call initialize() first.`);
    }

    const startTime = Date.now();
    this.logger.info(`Processing data with ${this.name} plugin`, {
      dataType: data.type || 'unknown',
      recordCount: data.supporters?.length || data.transactions?.length || 1
    });

    try {
      // Perform plugin-specific processing
      const results = await this.execute(data, options);
      
      const duration = Date.now() - startTime;
      this.logger.performance(`${this.name}-process`, duration, {
        success: true,
        ...results
      });

      return {
        plugin: this.name,
        success: true,
        duration,
        ...results
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`${this.name} plugin processing failed`, {
        error: error.message,
        duration,
        dataType: data.type || 'unknown'
      });

      return {
        plugin: this.name,
        success: false,
        error: error.message,
        duration
      };
    }
  }

  /**
   * Execute plugin-specific processing logic (to be implemented by subclasses)
   * @param {Object} data - Data to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  async execute(data, options) {
    throw new Error('execute() method must be implemented by subclass');
  }

  /**
   * Health check for the plugin
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      // Basic health check - plugin is initialized
      if (!this.initialized) {
        return {
          status: 'error',
          message: 'Plugin not initialized',
          timestamp: new Date().toISOString()
        };
      }

      // Perform plugin-specific health checks
      const pluginHealth = await this.checkHealth();
      
      return {
        status: 'healthy',
        plugin: this.name,
        initialized: this.initialized,
        ...pluginHealth,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        status: 'error',
        plugin: this.name,
        message: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Plugin-specific health check (to be implemented by subclasses)
   * @returns {Promise<Object>} Plugin-specific health data
   */
  async checkHealth() {
    return {};
  }

  /**
   * Shutdown the plugin and cleanup resources
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.logger.info(`Shutting down ${this.name} plugin`);
    
    try {
      // Perform plugin-specific cleanup
      await this.cleanup();
      
      this.initialized = false;
      this.healthStatus = 'shutdown';
      
      this.logger.info(`${this.name} plugin shutdown complete`);
      
    } catch (error) {
      this.logger.error(`Error during ${this.name} plugin shutdown`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Plugin-specific cleanup (to be implemented by subclasses)
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Default implementation - no cleanup required
  }

  /**
   * Get plugin status information
   * @returns {Object} Plugin status
   */
  getStatus() {
    return {
      name: this.name,
      initialized: this.initialized,
      healthStatus: this.healthStatus,
      config: {
        // Return config without sensitive data
        ...Object.keys(this.config).reduce((safe, key) => {
          // Hide fields that might contain secrets
          if (key.toLowerCase().includes('key') || 
              key.toLowerCase().includes('secret') || 
              key.toLowerCase().includes('password')) {
            safe[key] = '***';
          } else {
            safe[key] = this.config[key];
          }
          return safe;
        }, {})
      }
    };
  }

  /**
   * Get plugin configuration schema (for documentation/validation)
   * @returns {Object} Configuration schema
   */
  getConfigSchema() {
    return {
      name: this.name,
      description: 'Base plugin - extend this class',
      requiredFields: this.getRequiredConfigFields(),
      optionalFields: [],
      supportedDataTypes: ['supporters', 'transactions', 'campaigns'],
      supportedOptions: {}
    };
  }
}

module.exports = {
  BasePlugin
};