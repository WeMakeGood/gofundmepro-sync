/**
 * Health Monitor System
 * 
 * Centralized health monitoring for all system components.
 * Standardizes health check patterns and provides comprehensive system status.
 */

const { createLogger } = require('../utils/logger');
const { database } = require('../config/database');
const { alertManager } = require('./alert-manager');

const logger = createLogger('health-monitor');

class SystemHealthMonitor {
  constructor() {
    this.components = new Map();
    this.lastCheck = null;
    this.checkInterval = 5 * 60 * 1000; // 5 minutes
    this.intervalId = null;
  }

  /**
   * Register a component for health monitoring
   * @param {string} name - Component name
   * @param {Function} healthCheckFn - Function that returns health status
   * @param {Object} options - Monitoring options
   */
  registerComponent(name, healthCheckFn, options = {}) {
    const component = {
      name,
      healthCheckFn,
      critical: options.critical || false,
      timeout: options.timeout || 10000,
      lastCheck: null,
      lastResult: null,
      enabled: options.enabled !== false
    };

    this.components.set(name, component);
    logger.debug('Registered component for health monitoring', { 
      name, 
      critical: component.critical 
    });
  }

  /**
   * Unregister a component
   * @param {string} name - Component name
   */
  unregisterComponent(name) {
    this.components.delete(name);
    logger.debug('Unregistered component from health monitoring', { name });
  }

  /**
   * Perform health check on a single component
   * @param {string} name - Component name
   * @returns {Promise<Object>} Health check result
   */
  async checkComponent(name) {
    const component = this.components.get(name);
    if (!component) {
      throw new Error(`Component '${name}' not registered`);
    }

    if (!component.enabled) {
      return {
        component: name,
        status: 'disabled',
        message: 'Component monitoring disabled',
        timestamp: new Date().toISOString()
      };
    }

    const startTime = Date.now();
    
    try {
      // Run health check with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), component.timeout);
      });

      const result = await Promise.race([
        component.healthCheckFn(),
        timeoutPromise
      ]);

      const duration = Date.now() - startTime;
      const healthResult = {
        component: name,
        status: result.status || 'healthy',
        critical: component.critical,
        duration,
        timestamp: new Date().toISOString(),
        ...result
      };

      component.lastCheck = new Date();
      component.lastResult = healthResult;

      logger.debug('Component health check completed', {
        name,
        status: healthResult.status,
        duration
      });

      return healthResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      const healthResult = {
        component: name,
        status: 'error',
        critical: component.critical,
        error: error.message,
        duration,
        timestamp: new Date().toISOString()
      };

      component.lastCheck = new Date();
      component.lastResult = healthResult;

      logger.error('Component health check failed', {
        name,
        error: error.message,
        duration
      });

      return healthResult;
    }
  }

  /**
   * Perform health check on all components
   * @param {Object} options - Check options
   * @returns {Promise<Object>} Complete system health status
   */
  async checkAllComponents(options = {}) {
    const startTime = Date.now();
    const { parallel = true, includeDisabled = false } = options;

    logger.info('Starting system health check', {
      componentCount: this.components.size,
      parallel
    });

    const components = Array.from(this.components.keys()).filter(name => {
      const component = this.components.get(name);
      return includeDisabled || component.enabled;
    });

    let results;
    if (parallel) {
      // Run all checks in parallel
      const promises = components.map(name => this.checkComponent(name));
      results = await Promise.all(promises);
    } else {
      // Run checks sequentially
      results = [];
      for (const name of components) {
        const result = await this.checkComponent(name);
        results.push(result);
      }
    }

    const duration = Date.now() - startTime;
    this.lastCheck = new Date();

    // Analyze results
    const healthySystems = results.filter(r => r.status === 'healthy').length;
    const errorSystems = results.filter(r => r.status === 'error').length;
    const criticalErrors = results.filter(r => r.status === 'error' && r.critical).length;
    
    const overallStatus = this.determineOverallStatus(results);

    const systemHealth = {
      status: overallStatus,
      timestamp: this.lastCheck.toISOString(),
      duration,
      summary: {
        total: results.length,
        healthy: healthySystems,
        errors: errorSystems,
        criticalErrors,
        disabled: this.components.size - results.length
      },
      components: results
    };

    logger.info('System health check completed', {
      status: overallStatus,
      duration,
      summary: systemHealth.summary
    });

    // Process alerts based on health results
    try {
      await alertManager.processAlerts({
        ...systemHealth,
        system: {
          nodeVersion: process.version,
          platform: process.platform,
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          pid: process.pid
        }
      });
    } catch (error) {
      logger.error('Failed to process health alerts', { error: error.message });
    }

    return systemHealth;
  }

  /**
   * Determine overall system status based on component results
   * @param {Array} results - Component health results
   * @returns {string} Overall status
   */
  determineOverallStatus(results) {
    const criticalErrors = results.filter(r => r.status === 'error' && r.critical);
    const anyErrors = results.filter(r => r.status === 'error');

    if (criticalErrors.length > 0) {
      return 'critical';
    }

    if (anyErrors.length > 0) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Get quick system status (last check results)
   * @returns {Object} System status summary
   */
  getSystemStatus() {
    if (!this.lastCheck) {
      return {
        status: 'unknown',
        message: 'No health checks performed yet',
        lastCheck: null,
        summary: {
          total: 0,
          healthy: 0,
          errors: 0,
          criticalErrors: 0
        },
        components: []
      };
    }

    const components = Array.from(this.components.values()).map(comp => ({
      name: comp.name,
      enabled: comp.enabled,
      critical: comp.critical,
      lastCheck: comp.lastCheck,
      status: comp.lastResult?.status || 'unknown'
    }));

    const healthyCount = components.filter(c => c.status === 'healthy').length;
    const errorCount = components.filter(c => c.status === 'error').length;
    const criticalErrors = components.filter(c => c.status === 'error' && c.critical).length;

    let overallStatus = 'healthy';
    if (criticalErrors > 0) {
      overallStatus = 'critical';
    } else if (errorCount > 0) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      lastCheck: this.lastCheck.toISOString(),
      summary: {
        total: components.length,
        healthy: healthyCount,
        errors: errorCount,
        criticalErrors
      },
      components
    };
  }

  /**
   * Start automatic health monitoring
   * @param {number} interval - Check interval in milliseconds
   */
  startMonitoring(interval = this.checkInterval) {
    if (this.intervalId) {
      this.stopMonitoring();
    }

    this.checkInterval = interval;
    this.intervalId = setInterval(async () => {
      try {
        await this.checkAllComponents({ parallel: true });
      } catch (error) {
        logger.error('Automatic health check failed', { error: error.message });
      }
    }, interval);

    logger.info('Started automatic health monitoring', {
      interval: interval / 1000 + ' seconds'
    });
  }

  /**
   * Stop automatic health monitoring
   */
  stopMonitoring() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped automatic health monitoring');
    }
  }

  /**
   * Initialize standard system components
   */
  async initializeStandardComponents() {
    logger.info('Initializing standard health monitoring components');

    // Database health check
    this.registerComponent('database', async () => {
      try {
        await database.initialize();
        const knex = database.getKnex();
        
        // Test basic query
        await knex.raw('SELECT 1');
        
        // Get connection pool status
        const pool = knex.client.pool;
        
        return {
          status: 'healthy',
          database: database.config?.client || 'unknown',
          connections: {
            used: pool.numUsed(),
            free: pool.numFree(),
            pending: pool.numPendingAcquires(),
            max: pool.max
          }
        };
      } catch (error) {
        return {
          status: 'error',
          error: error.message,
          database: database.config?.client || 'unknown'
        };
      }
    }, { critical: true, timeout: 15000 });

    // MailChimp integration health check
    try {
      if (process.env.MAILCHIMP_API_KEY && process.env.MAILCHIMP_LIST_ID) {
        const { MailChimpClient } = require('../integrations/mailchimp-client');
        
        this.registerComponent('mailchimp', async () => {
          try {
            const client = new MailChimpClient({
              apiKey: process.env.MAILCHIMP_API_KEY,
              listId: process.env.MAILCHIMP_LIST_ID
            });
            
            return await client.healthCheck();
          } catch (error) {
            return {
              status: 'error',
              error: error.message
            };
          }
        }, { critical: false, timeout: 10000 });
      }
    } catch (error) {
      logger.debug('MailChimp client not available for health monitoring');
    }

    // Plugin Manager health check (if available)
    try {
      const { PluginManager } = require('./plugin-manager');
      
      this.registerComponent('plugin-manager', async () => {
        try {
          // Check if plugin manager can be instantiated
          const manager = new PluginManager();
          
          return {
            status: 'healthy',
            message: 'Plugin manager available',
            pluginCount: manager.plugins.size || 0
          };
        } catch (error) {
          return {
            status: 'error',
            error: error.message
          };
        }
      }, { critical: false, timeout: 5000 });

    } catch (error) {
      logger.debug('Plugin manager not available for health monitoring');
    }

    logger.info('Standard health monitoring components initialized');
  }

  /**
   * Generate comprehensive health report
   * @returns {Promise<Object>} Detailed health report
   */
  async generateHealthReport() {
    const systemHealth = await this.checkAllComponents({ parallel: true });
    
    const report = {
      ...systemHealth,
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        pid: process.pid
      },
      recommendations: this.generateRecommendations(systemHealth)
    };

    return report;
  }

  /**
   * Generate health recommendations based on current status
   * @param {Object} healthResults - System health results
   * @returns {Array} Array of recommendations
   */
  generateRecommendations(healthResults) {
    const recommendations = [];

    // Check for critical errors
    const criticalErrors = healthResults.components.filter(c => c.status === 'error' && c.critical);
    if (criticalErrors.length > 0) {
      recommendations.push({
        type: 'critical',
        message: `${criticalErrors.length} critical component(s) failing`,
        action: 'Immediate attention required - check logs and restart affected services'
      });
    }

    // Check for slow responses
    const slowComponents = healthResults.components.filter(c => c.duration > 5000);
    if (slowComponents.length > 0) {
      recommendations.push({
        type: 'performance',
        message: `${slowComponents.length} component(s) responding slowly`,
        action: 'Monitor performance and consider optimization'
      });
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    const memUsedMB = memUsage.heapUsed / 1024 / 1024;
    if (memUsedMB > 500) {
      recommendations.push({
        type: 'resource',
        message: `High memory usage: ${memUsedMB.toFixed(1)}MB`,
        action: 'Monitor memory usage and consider optimization'
      });
    }

    return recommendations;
  }
}

// Export singleton instance
const healthMonitor = new SystemHealthMonitor();

module.exports = {
  SystemHealthMonitor,
  healthMonitor
};