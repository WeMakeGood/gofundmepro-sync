/**
 * Structured Logging with Winston
 * 
 * Provides centralized logging for the entire application
 * Supports different log levels and output formats
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = ' ' + JSON.stringify(meta);
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { 
    service: 'classy-sync',
    version: require('../../package.json').version 
  },
  transports: [
    // Console output (development)
    new winston.transports.Console({
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
      format: consoleFormat
    }),

    // Error log file
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    }),

    // Combined log file
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 10
    })
  ],

  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: fileFormat
    })
  ],

  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: fileFormat
    })
  ]
});

/**
 * Enhanced logging methods with context
 */
class Logger {
  constructor(context = 'general') {
    this.context = context;
  }

  /**
   * Create a child logger with additional context
   * @param {string} childContext - Additional context
   * @returns {Logger} Child logger instance
   */
  child(childContext) {
    return new Logger(`${this.context}:${childContext}`);
  }

  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  debug(message, meta = {}) {
    logger.debug(message, { context: this.context, ...meta });
  }

  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  info(message, meta = {}) {
    logger.info(message, { context: this.context, ...meta });
  }

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} meta - Additional metadata
   */
  warn(message, meta = {}) {
    logger.warn(message, { context: this.context, ...meta });
  }

  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Error|Object} error - Error object or metadata
   */
  error(message, error = {}) {
    if (error instanceof Error) {
      logger.error(message, { 
        context: this.context, 
        error: error.message, 
        stack: error.stack 
      });
    } else {
      logger.error(message, { context: this.context, ...error });
    }
  }

  /**
   * Log sync operation
   * @param {string} operation - Sync operation type
   * @param {Object} details - Operation details
   */
  sync(operation, details = {}) {
    this.info(`Sync ${operation}`, { 
      operation, 
      syncType: 'classy-api',
      ...details 
    });
  }

  /**
   * Log API request
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {Object} meta - Request metadata
   */
  apiRequest(method, endpoint, meta = {}) {
    this.debug(`API ${method} ${endpoint}`, {
      apiCall: true,
      method,
      endpoint,
      ...meta
    });
  }

  /**
   * Log API response
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {number} statusCode - Response status code
   * @param {Object} meta - Response metadata
   */
  apiResponse(method, endpoint, statusCode, meta = {}) {
    const level = statusCode >= 400 ? 'warn' : 'debug';
    this[level](`API ${method} ${endpoint} - ${statusCode}`, {
      apiResponse: true,
      method,
      endpoint,
      statusCode,
      ...meta
    });
  }

  /**
   * Log database operation
   * @param {string} operation - Database operation
   * @param {string} table - Database table
   * @param {Object} meta - Operation metadata
   */
  database(operation, table, meta = {}) {
    this.debug(`DB ${operation} ${table}`, {
      database: true,
      operation,
      table,
      ...meta
    });
  }

  /**
   * Log plugin operation
   * @param {string} plugin - Plugin name
   * @param {string} operation - Operation type
   * @param {Object} meta - Operation metadata
   */
  plugin(plugin, operation, meta = {}) {
    this.info(`Plugin ${plugin}: ${operation}`, {
      plugin: true,
      pluginName: plugin,
      operation,
      ...meta
    });
  }

  /**
   * Log performance metrics
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in milliseconds
   * @param {Object} meta - Additional metrics
   */
  performance(operation, duration, meta = {}) {
    this.info(`Performance: ${operation} completed in ${duration}ms`, {
      performance: true,
      operation,
      duration,
      ...meta
    });
  }

  /**
   * Log timing wrapper for async operations
   * @param {string} operation - Operation name
   * @param {Function} fn - Async function to time
   * @param {Object} meta - Additional metadata
   * @returns {Promise<*>} Function result
   */
  async time(operation, fn, meta = {}) {
    const startTime = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      this.performance(operation, duration, { ...meta, success: true });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.performance(operation, duration, { ...meta, success: false });
      throw error;
    }
  }
}

// Create default logger instance
const defaultLogger = new Logger('classy-sync');

// Export both the logger class and default instance
module.exports = {
  Logger,
  logger: defaultLogger,
  
  // Factory function for creating context-specific loggers
  createLogger: (context) => new Logger(context),
  
  // Direct access to Winston logger
  winston: logger
};