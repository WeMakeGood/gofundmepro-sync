const logger = require('./logger');

const defaultRetryConfig = {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000, // Exponential backoff
  retryCondition: (error) => {
    // Retry on network errors and 5xx responses
    return !error.response || error.response.status >= 500;
  },
  onRetry: (retryCount, error) => {
    logger.warn(`Retry attempt ${retryCount}`, {
      error: error.message,
      url: error.config?.url
    });
  }
};

class RetryManager {
  constructor(config = {}) {
    this.config = { ...defaultRetryConfig, ...config };
  }

  async execute(fn, customConfig = {}) {
    const config = { ...this.config, ...customConfig };
    let lastError;

    for (let attempt = 0; attempt <= config.retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt === config.retries || !config.retryCondition(error)) {
          throw error;
        }

        const delay = config.retryDelay(attempt + 1);
        config.onRetry(attempt + 1, error);
        
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Circuit breaker implementation
class CircuitBreaker {
  constructor(config = {}) {
    this.failureThreshold = config.failureThreshold || 5;
    this.resetTimeout = config.resetTimeout || 300000; // 5 minutes
    this.monitorTimeout = config.monitorTimeout || 60000; // 1 minute
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
  }

  async execute(fn, identifier = 'unknown') {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error(`Circuit breaker is OPEN for ${identifier}`);
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess(identifier);
      return result;
    } catch (error) {
      this.onFailure(identifier);
      throw error;
    }
  }

  onSuccess(identifier) {
    this.failureCount = 0;
    this.state = 'CLOSED';
    logger.info(`Circuit breaker reset for ${identifier}`);
  }

  onFailure(identifier) {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
      logger.warn(`Circuit breaker opened for ${identifier}`, {
        failureCount: this.failureCount,
        resetTime: new Date(this.nextAttempt)
      });
    }
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      nextAttempt: this.nextAttempt
    };
  }
}

module.exports = {
  RetryManager,
  CircuitBreaker,
  defaultRetryConfig
};