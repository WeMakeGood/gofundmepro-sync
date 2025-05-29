const winston = require('winston');
const path = require('path');

const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'classy-sync' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Helper methods for structured logging
logger.syncEvent = (eventType, data = {}) => {
  logger.info('Sync event', {
    eventType,
    ...data,
    timestamp: new Date().toISOString()
  });
};

logger.apiCall = (endpoint, method, status, duration, data = {}) => {
  logger.info('API call', {
    endpoint,
    method,
    status,
    duration,
    ...data,
    timestamp: new Date().toISOString()
  });
};

logger.dbQuery = (query, duration, rowCount = null) => {
  logger.debug('Database query', {
    query: query.substring(0, 100), // Truncate long queries
    duration,
    rowCount,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger;