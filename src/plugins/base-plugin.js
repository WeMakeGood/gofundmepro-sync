const logger = require('../utils/logger');

class BasePlugin {
  constructor(config, dependencies) {
    this.config = config || {};
    this.db = dependencies.db;
    this.logger = dependencies.logger || logger;
    this.queue = dependencies.queue;
    this.name = this.constructor.name;
    this.enabled = this.config.enabled !== false;
    this.initialized = false;
  }
  
  async initialize() {
    throw new Error('Plugin must implement initialize() method');
  }
  
  async process(data) {
    throw new Error('Plugin must implement process() method');
  }
  
  async shutdown() {
    // Optional cleanup method
    this.logger.info(`Plugin ${this.name} shutdown`);
  }

  isEnabled() {
    return this.enabled;
  }

  async safeInitialize() {
    if (!this.enabled) {
      this.logger.info(`Plugin ${this.name} is disabled`);
      return false;
    }

    try {
      await this.initialize();
      this.initialized = true;
      this.logger.info(`Plugin ${this.name} initialized successfully`);
      return true;
    } catch (error) {
      this.logger.error(`Plugin ${this.name} initialization failed:`, error);
      this.enabled = false;
      return false;
    }
  }

  async safeProcess(data) {
    if (!this.enabled || !this.initialized) {
      return null;
    }

    try {
      const result = await this.process(data);
      this.logger.debug(`Plugin ${this.name} processed data`, {
        dataType: data.type,
        result: result ? 'success' : 'no action'
      });
      return result;
    } catch (error) {
      this.logger.error(`Plugin ${this.name} processing failed:`, error);
      // Don't disable plugin on processing errors, just log and continue
      return null;
    }
  }

  async safeShutdown() {
    try {
      await this.shutdown();
    } catch (error) {
      this.logger.error(`Plugin ${this.name} shutdown failed:`, error);
    }
  }

  // Helper method for common data validation
  validateEventData(data, requiredFields = []) {
    if (!data || typeof data !== 'object') {
      throw new Error('Event data must be an object');
    }

    if (!data.type) {
      throw new Error('Event data must have a type field');
    }

    for (const field of requiredFields) {
      if (!(field in data)) {
        throw new Error(`Event data missing required field: ${field}`);
      }
    }

    return true;
  }

  // Helper method for database operations
  async executeDbQuery(query, params = []) {
    try {
      return await this.db.query(query, params);
    } catch (error) {
      this.logger.error(`Database query failed in plugin ${this.name}:`, {
        query: query.substring(0, 100),
        error: error.message
      });
      throw error;
    }
  }

  // Helper method for HTTP requests
  async makeHttpRequest(axios, config) {
    const startTime = Date.now();
    
    try {
      const response = await axios(config);
      const duration = Date.now() - startTime;
      
      this.logger.debug(`HTTP request successful in plugin ${this.name}`, {
        url: config.url,
        method: config.method,
        status: response.status,
        duration
      });
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error(`HTTP request failed in plugin ${this.name}:`, {
        url: config.url,
        method: config.method,
        status: error.response?.status,
        duration,
        error: error.message
      });
      
      throw error;
    }
  }

  // Helper method for rate limiting
  async rateLimit(requestsPerSecond = 1) {
    const now = Date.now();
    const minInterval = 1000 / requestsPerSecond;
    
    if (!this.lastRequestTime) {
      this.lastRequestTime = now;
      return;
    }
    
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < minInterval) {
      const delay = minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }
}

module.exports = BasePlugin;