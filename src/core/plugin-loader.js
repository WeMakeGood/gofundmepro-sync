const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const BasePlugin = require('../plugins/base-plugin');

class PluginLoader {
  constructor(config = {}) {
    this.pluginDir = config.pluginDir || path.join(__dirname, '../plugins');
    this.plugins = new Map();
    this.dependencies = {
      db: config.db,
      logger: config.logger || logger,
      queue: config.queue
    };
    this.pluginConfigs = config.plugins || {};
  }

  async loadAllPlugins() {
    try {
      logger.info('Loading plugins from directory:', this.pluginDir);
      
      const pluginFiles = await this.discoverPlugins();
      
      for (const pluginFile of pluginFiles) {
        await this.loadPlugin(pluginFile);
      }
      
      logger.info(`Loaded ${this.plugins.size} plugins`, {
        plugins: Array.from(this.plugins.keys())
      });
      
      return Array.from(this.plugins.values());
    } catch (error) {
      logger.error('Failed to load plugins:', error);
      throw error;
    }
  }

  async discoverPlugins() {
    const pluginFiles = [];
    
    try {
      const items = await fs.readdir(this.pluginDir, { withFileTypes: true });
      
      for (const item of items) {
        if (item.isDirectory()) {
          // Look for index.js in plugin subdirectories
          const indexPath = path.join(this.pluginDir, item.name, 'index.js');
          try {
            await fs.access(indexPath);
            pluginFiles.push({
              name: item.name,
              path: indexPath,
              type: 'directory'
            });
          } catch {
            // No index.js found, skip this directory
          }
        } else if (item.isFile() && item.name.endsWith('.js') && item.name !== 'base-plugin.js') {
          // Direct plugin file
          const pluginName = path.basename(item.name, '.js');
          pluginFiles.push({
            name: pluginName,
            path: path.join(this.pluginDir, item.name),
            type: 'file'
          });
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.warn('Plugin directory does not exist:', this.pluginDir);
        return [];
      }
      throw error;
    }
    
    return pluginFiles;
  }

  async loadPlugin(pluginInfo) {
    const { name, path: pluginPath } = pluginInfo;
    
    try {
      logger.debug(`Loading plugin: ${name} from ${pluginPath}`);
      
      // Require the plugin module
      const PluginClass = require(pluginPath);
      
      // Validate plugin class
      if (!PluginClass || typeof PluginClass !== 'function') {
        throw new Error(`Plugin ${name} does not export a constructor function`);
      }
      
      // Check if plugin extends BasePlugin
      if (!this.isValidPlugin(PluginClass)) {
        throw new Error(`Plugin ${name} does not extend BasePlugin`);
      }
      
      // Get plugin configuration
      const pluginConfig = this.pluginConfigs[name] || {};
      
      // Instantiate plugin
      const plugin = new PluginClass(pluginConfig, this.dependencies);
      
      // Initialize plugin
      const initialized = await plugin.safeInitialize();
      
      if (initialized) {
        this.plugins.set(name, plugin);
        logger.info(`Successfully loaded plugin: ${name}`);
      } else {
        logger.warn(`Plugin ${name} failed to initialize or is disabled`);
      }
      
    } catch (error) {
      logger.error(`Failed to load plugin ${name}:`, error);
      // Continue loading other plugins even if one fails
    }
  }

  isValidPlugin(PluginClass) {
    try {
      // Check if the class extends BasePlugin
      const instance = Object.create(PluginClass.prototype);
      return instance instanceof BasePlugin;
    } catch {
      return false;
    }
  }

  async processEvent(eventData) {
    const results = new Map();
    
    for (const [name, plugin] of this.plugins) {
      try {
        const result = await plugin.safeProcess(eventData);
        results.set(name, result);
      } catch (error) {
        logger.error(`Plugin ${name} failed to process event:`, error);
        results.set(name, { error: error.message });
      }
    }
    
    return results;
  }

  getPlugin(name) {
    return this.plugins.get(name);
  }

  getAllPlugins() {
    return Array.from(this.plugins.values());
  }

  getEnabledPlugins() {
    return Array.from(this.plugins.values()).filter(plugin => plugin.isEnabled());
  }

  async reloadPlugin(name) {
    // Shutdown existing plugin
    if (this.plugins.has(name)) {
      const existingPlugin = this.plugins.get(name);
      await existingPlugin.safeShutdown();
      this.plugins.delete(name);
    }
    
    // Clear require cache for hot reloading
    const pluginFiles = await this.discoverPlugins();
    const pluginInfo = pluginFiles.find(p => p.name === name);
    
    if (pluginInfo) {
      delete require.cache[require.resolve(pluginInfo.path)];
      await this.loadPlugin(pluginInfo);
      return this.plugins.get(name);
    } else {
      throw new Error(`Plugin ${name} not found`);
    }
  }

  async unloadPlugin(name) {
    if (this.plugins.has(name)) {
      const plugin = this.plugins.get(name);
      await plugin.safeShutdown();
      this.plugins.delete(name);
      logger.info(`Unloaded plugin: ${name}`);
      return true;
    }
    return false;
  }

  async shutdownAllPlugins() {
    logger.info('Shutting down all plugins...');
    
    const shutdownPromises = Array.from(this.plugins.values()).map(plugin => 
      plugin.safeShutdown()
    );
    
    await Promise.allSettled(shutdownPromises);
    this.plugins.clear();
    
    logger.info('All plugins shut down');
  }

  getPluginStatus() {
    const status = {};
    
    for (const [name, plugin] of this.plugins) {
      status[name] = {
        enabled: plugin.isEnabled(),
        initialized: plugin.initialized,
        name: plugin.name
      };
    }
    
    return status;
  }

  async healthCheck() {
    const pluginHealth = {};
    
    for (const [name, plugin] of this.plugins) {
      pluginHealth[name] = {
        enabled: plugin.isEnabled(),
        initialized: plugin.initialized,
        status: plugin.isEnabled() && plugin.initialized ? 'healthy' : 'unhealthy'
      };
    }
    
    const healthyCount = Object.values(pluginHealth)
      .filter(p => p.status === 'healthy').length;
    
    return {
      status: healthyCount > 0 ? 'ok' : 'warning',
      totalPlugins: this.plugins.size,
      healthyPlugins: healthyCount,
      plugins: pluginHealth,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = PluginLoader;