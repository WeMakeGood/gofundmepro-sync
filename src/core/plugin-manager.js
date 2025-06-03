/**
 * Plugin Manager
 * 
 * Manages loading, initialization, and coordination of plugins
 * Provides a unified interface for processing data through multiple plugins
 */

const { createLogger } = require('../utils/logger');
const { MailChimpSyncPlugin } = require('../plugins/mailchimp-sync');

const logger = createLogger('plugin-manager');

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.initialized = false;
    this.pluginConfigs = new Map();
  }

  /**
   * Register a plugin with configuration
   * @param {string} name - Plugin name
   * @param {Class} PluginClass - Plugin class constructor
   * @param {Object} config - Plugin configuration
   * @param {Object} dependencies - Plugin dependencies
   * @returns {Promise<void>}
   */
  async registerPlugin(name, PluginClass, config = {}, dependencies = {}) {
    logger.info(`Registering plugin: ${name}`);

    try {
      // Create plugin instance
      const plugin = new PluginClass(config, dependencies);
      
      // Store configuration for reference
      this.pluginConfigs.set(name, {
        class: PluginClass,
        config,
        dependencies
      });
      
      // Store plugin instance
      this.plugins.set(name, plugin);
      
      logger.info(`Plugin registered successfully: ${name}`);
      
    } catch (error) {
      logger.error(`Failed to register plugin: ${name}`, {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Initialize all registered plugins
   * @returns {Promise<Object>} Initialization results
   */
  async initializeAll() {
    logger.info(`Initializing ${this.plugins.size} plugins`);
    
    const results = {
      successful: [],
      failed: [],
      total: this.plugins.size
    };

    for (const [name, plugin] of this.plugins) {
      try {
        logger.info(`Initializing plugin: ${name}`);
        await plugin.initialize();
        
        results.successful.push(name);
        logger.info(`Plugin initialized successfully: ${name}`);
        
      } catch (error) {
        logger.error(`Failed to initialize plugin: ${name}`, {
          error: error.message
        });
        
        results.failed.push({
          name,
          error: error.message
        });
      }
    }

    this.initialized = results.failed.length === 0;
    
    logger.info('Plugin initialization completed', {
      successful: results.successful.length,
      failed: results.failed.length,
      allInitialized: this.initialized
    });

    return results;
  }

  /**
   * Initialize a specific plugin
   * @param {string} name - Plugin name
   * @returns {Promise<void>}
   */
  async initializePlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }

    logger.info(`Initializing plugin: ${name}`);
    await plugin.initialize();
    logger.info(`Plugin initialized successfully: ${name}`);
  }

  /**
   * Get a specific plugin instance
   * @param {string} name - Plugin name
   * @returns {Object|null} Plugin instance or null if not found
   */
  getPlugin(name) {
    return this.plugins.get(name) || null;
  }

  /**
   * Check if a plugin is registered
   * @param {string} name - Plugin name
   * @returns {boolean} True if plugin is registered
   */
  hasPlugin(name) {
    return this.plugins.has(name);
  }

  /**
   * Get all registered plugin names
   * @returns {Array<string>} Array of plugin names
   */
  getPluginNames() {
    return Array.from(this.plugins.keys());
  }

  /**
   * Process data through a specific plugin
   * @param {string} pluginName - Plugin name
   * @param {Object} data - Data to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  async processWithPlugin(pluginName, data, options = {}) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    if (!plugin.initialized) {
      throw new Error(`Plugin not initialized: ${pluginName}`);
    }

    logger.info(`Processing data with plugin: ${pluginName}`, {
      dataType: data.type || 'unknown'
    });

    return await plugin.process(data, options);
  }

  /**
   * Process data through multiple plugins
   * @param {Array<string>} pluginNames - Array of plugin names
   * @param {Object} data - Data to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Combined processing results
   */
  async processWithPlugins(pluginNames, data, options = {}) {
    const results = {
      successful: [],
      failed: [],
      total: pluginNames.length,
      data: data.type || 'unknown'
    };

    logger.info(`Processing data through ${pluginNames.length} plugins`, {
      plugins: pluginNames,
      dataType: data.type || 'unknown'
    });

    for (const pluginName of pluginNames) {
      try {
        const result = await this.processWithPlugin(pluginName, data, options);
        results.successful.push({
          plugin: pluginName,
          ...result
        });
        
      } catch (error) {
        logger.error(`Plugin processing failed: ${pluginName}`, {
          error: error.message
        });
        
        results.failed.push({
          plugin: pluginName,
          error: error.message
        });
      }
    }

    logger.info('Multi-plugin processing completed', {
      successful: results.successful.length,
      failed: results.failed.length,
      dataType: data.type || 'unknown'
    });

    return results;
  }

  /**
   * Process data through all registered and initialized plugins
   * @param {Object} data - Data to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Combined processing results
   */
  async processWithAllPlugins(data, options = {}) {
    const initializedPlugins = Array.from(this.plugins.entries())
      .filter(([name, plugin]) => plugin.initialized)
      .map(([name]) => name);

    if (initializedPlugins.length === 0) {
      logger.warn('No initialized plugins available for processing');
      return {
        successful: [],
        failed: [],
        total: 0,
        data: data.type || 'unknown'
      };
    }

    return await this.processWithPlugins(initializedPlugins, data, options);
  }

  /**
   * Get health status of all plugins
   * @returns {Promise<Object>} Health status for all plugins
   */
  async getHealthStatus() {
    const health = {
      manager: {
        status: 'healthy',
        pluginCount: this.plugins.size,
        initialized: this.initialized
      },
      plugins: {}
    };

    for (const [name, plugin] of this.plugins) {
      try {
        health.plugins[name] = await plugin.healthCheck();
      } catch (error) {
        health.plugins[name] = {
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }

    // Overall health based on plugin status
    const pluginStatuses = Object.values(health.plugins).map(p => p.status);
    const hasErrors = pluginStatuses.includes('error');
    const allHealthy = pluginStatuses.every(status => status === 'healthy');

    health.manager.status = hasErrors ? 'error' : allHealthy ? 'healthy' : 'warning';

    return health;
  }

  /**
   * Get configuration schema for all plugins
   * @returns {Object} Combined configuration schema
   */
  getConfigSchemas() {
    const schemas = {};

    for (const [name, plugin] of this.plugins) {
      try {
        schemas[name] = plugin.getConfigSchema();
      } catch (error) {
        schemas[name] = {
          name,
          error: `Failed to get schema: ${error.message}`
        };
      }
    }

    return schemas;
  }

  /**
   * Get status information for all plugins
   * @returns {Object} Status information
   */
  getStatus() {
    const status = {
      manager: {
        initialized: this.initialized,
        pluginCount: this.plugins.size,
        timestamp: new Date().toISOString()
      },
      plugins: {}
    };

    for (const [name, plugin] of this.plugins) {
      try {
        status.plugins[name] = plugin.getStatus();
      } catch (error) {
        status.plugins[name] = {
          name,
          error: `Failed to get status: ${error.message}`
        };
      }
    }

    return status;
  }

  /**
   * Shutdown a specific plugin
   * @param {string} name - Plugin name
   * @returns {Promise<void>}
   */
  async shutdownPlugin(name) {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin not found: ${name}`);
    }

    logger.info(`Shutting down plugin: ${name}`);
    await plugin.shutdown();
    logger.info(`Plugin shutdown completed: ${name}`);
  }

  /**
   * Shutdown all plugins
   * @returns {Promise<Object>} Shutdown results
   */
  async shutdownAll() {
    logger.info(`Shutting down ${this.plugins.size} plugins`);
    
    const results = {
      successful: [],
      failed: [],
      total: this.plugins.size
    };

    for (const [name, plugin] of this.plugins) {
      try {
        await plugin.shutdown();
        results.successful.push(name);
        
      } catch (error) {
        logger.error(`Failed to shutdown plugin: ${name}`, {
          error: error.message
        });
        
        results.failed.push({
          name,
          error: error.message
        });
      }
    }

    this.initialized = false;
    
    logger.info('Plugin shutdown completed', {
      successful: results.successful.length,
      failed: results.failed.length
    });

    return results;
  }

  /**
   * Reload a plugin (shutdown and reinitialize)
   * @param {string} name - Plugin name
   * @returns {Promise<void>}
   */
  async reloadPlugin(name) {
    const pluginConfig = this.pluginConfigs.get(name);
    if (!pluginConfig) {
      throw new Error(`Plugin configuration not found: ${name}`);
    }

    logger.info(`Reloading plugin: ${name}`);

    // Shutdown existing plugin
    if (this.plugins.has(name)) {
      await this.shutdownPlugin(name);
    }

    // Re-register and initialize
    await this.registerPlugin(
      name,
      pluginConfig.class,
      pluginConfig.config,
      pluginConfig.dependencies
    );
    
    await this.initializePlugin(name);
    
    logger.info(`Plugin reloaded successfully: ${name}`);
  }

  /**
   * Create default plugin manager with MailChimp plugin
   * @param {Object} config - Configuration object
   * @returns {Promise<PluginManager>} Configured plugin manager
   */
  static async createDefault(config = {}) {
    const manager = new PluginManager();

    // Register MailChimp plugin if configured
    if (config.mailchimp && config.mailchimp.apiKey && config.mailchimp.listId) {
      await manager.registerPlugin(
        'mailchimp',
        MailChimpSyncPlugin,
        config.mailchimp,
        config.dependencies || {}
      );
    }

    return manager;
  }
}

module.exports = {
  PluginManager
};