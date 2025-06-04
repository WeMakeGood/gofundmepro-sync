/**
 * Performance Tracker
 * 
 * Collects and analyzes performance metrics for system monitoring
 * and optimization insights.
 */

const { createLogger } = require('../utils/logger');

const logger = createLogger('performance-tracker');

class PerformanceTracker {
  constructor() {
    this.metrics = new Map();
    this.timers = new Map();
    this.retentionPeriod = 24 * 60 * 60 * 1000; // 24 hours
    this.cleanupInterval = 60 * 60 * 1000; // 1 hour
    this.cleanupTimer = null;
  }

  /**
   * Start tracking a performance metric
   * @param {string} name - Metric name
   * @param {Object} metadata - Additional metric data
   * @returns {string} Timer ID for stopping the metric
   */
  startTimer(name, metadata = {}) {
    const timerId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.timers.set(timerId, {
      name,
      startTime: Date.now(),
      metadata
    });

    logger.debug('Performance timer started', { name, timerId, metadata });
    return timerId;
  }

  /**
   * Stop tracking a performance metric
   * @param {string} timerId - Timer ID from startTimer
   * @param {Object} additionalData - Additional data to record
   */
  stopTimer(timerId, additionalData = {}) {
    const timer = this.timers.get(timerId);
    if (!timer) {
      logger.warn('Timer not found', { timerId });
      return;
    }

    const duration = Date.now() - timer.startTime;
    this.recordMetric(timer.name, duration, {
      ...timer.metadata,
      ...additionalData
    });

    this.timers.delete(timerId);
    
    logger.debug('Performance timer stopped', {
      name: timer.name,
      timerId,
      duration
    });
  }

  /**
   * Record a performance metric directly
   * @param {string} name - Metric name
   * @param {number} value - Metric value (typically duration in ms)
   * @param {Object} metadata - Additional metric data
   */
  recordMetric(name, value, metadata = {}) {
    const timestamp = Date.now();
    
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricData = {
      value,
      timestamp,
      metadata
    };

    this.metrics.get(name).push(metricData);

    logger.debug('Performance metric recorded', {
      name,
      value,
      metadata
    });

    // Auto-cleanup old metrics
    this.cleanupOldMetrics(name);
  }

  /**
   * Get performance statistics for a metric
   * @param {string} name - Metric name
   * @param {Object} options - Analysis options
   * @returns {Object} Performance statistics
   */
  getMetricStats(name, options = {}) {
    const {
      timeRange = this.retentionPeriod,
      includeRaw = false
    } = options;

    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return {
        name,
        count: 0,
        min: null,
        max: null,
        avg: null,
        recent: null,
        trend: 'no-data'
      };
    }

    // Filter metrics within time range
    const cutoff = Date.now() - timeRange;
    const recentMetrics = metrics.filter(m => m.timestamp >= cutoff);

    if (recentMetrics.length === 0) {
      return {
        name,
        count: 0,
        min: null,
        max: null,
        avg: null,
        recent: null,
        trend: 'no-recent-data'
      };
    }

    const values = recentMetrics.map(m => m.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const recent = values[values.length - 1];

    // Calculate trend (comparing recent 25% vs older 75%)
    let trend = 'stable';
    if (values.length >= 4) {
      const recentQuarter = values.slice(-Math.floor(values.length / 4));
      const olderData = values.slice(0, -Math.floor(values.length / 4));
      
      const recentAvg = recentQuarter.reduce((a, b) => a + b, 0) / recentQuarter.length;
      const olderAvg = olderData.reduce((a, b) => a + b, 0) / olderData.length;
      
      const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;
      
      if (changePercent > 10) {
        trend = 'increasing';
      } else if (changePercent < -10) {
        trend = 'decreasing';
      }
    }

    const stats = {
      name,
      count: recentMetrics.length,
      min: Math.round(min),
      max: Math.round(max),
      avg: Math.round(avg),
      recent: Math.round(recent),
      trend,
      timeRange: timeRange / 1000 / 60 // Convert to minutes
    };

    if (includeRaw) {
      stats.rawData = recentMetrics;
    }

    return stats;
  }

  /**
   * Get all performance metrics overview
   * @param {Object} options - Analysis options
   * @returns {Object} Performance overview
   */
  getPerformanceOverview(options = {}) {
    const {
      timeRange = this.retentionPeriod,
      sortBy = 'avg',
      limit = 10
    } = options;

    const allMetrics = Array.from(this.metrics.keys()).map(name => 
      this.getMetricStats(name, { timeRange })
    );

    // Filter out metrics with no data
    const validMetrics = allMetrics.filter(m => m.count > 0);

    // Sort metrics
    validMetrics.sort((a, b) => {
      if (sortBy === 'count') return b.count - a.count;
      if (sortBy === 'max') return b.max - a.max;
      if (sortBy === 'recent') return b.recent - a.recent;
      return b.avg - a.avg; // Default to avg
    });

    // Apply limit
    const topMetrics = validMetrics.slice(0, limit);

    return {
      overview: {
        totalMetrics: this.metrics.size,
        activeMetrics: validMetrics.length,
        timeRange: timeRange / 1000 / 60, // Convert to minutes
        generatedAt: new Date().toISOString()
      },
      metrics: topMetrics,
      summary: {
        slowestOperation: validMetrics.length > 0 ? validMetrics[0] : null,
        trending: validMetrics.filter(m => m.trend === 'increasing').length,
        stable: validMetrics.filter(m => m.trend === 'stable').length,
        improving: validMetrics.filter(m => m.trend === 'decreasing').length
      }
    };
  }

  /**
   * Track sync operation performance
   * @param {string} entity - Entity type (supporters, transactions, etc.)
   * @param {string} operation - Operation type (full, incremental)
   * @param {Object} metadata - Additional sync data
   * @returns {Function} Function to call when sync completes
   */
  trackSyncOperation(entity, operation, metadata = {}) {
    const name = `sync-${entity}-${operation}`;
    const timerId = this.startTimer(name, {
      entity,
      operation,
      ...metadata
    });

    return (results = {}) => {
      this.stopTimer(timerId, {
        success: results.success !== false,
        recordCount: results.processed || results.created || results.updated || 0,
        errorCount: results.errors || 0,
        ...results
      });
    };
  }

  /**
   * Track API request performance
   * @param {string} endpoint - API endpoint
   * @param {string} method - HTTP method
   * @param {Object} metadata - Request metadata
   * @returns {Function} Function to call when request completes
   */
  trackAPIRequest(endpoint, method = 'GET', metadata = {}) {
    const name = `api-${method.toLowerCase()}-${endpoint.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const timerId = this.startTimer(name, {
      endpoint,
      method,
      ...metadata
    });

    return (response = {}) => {
      this.stopTimer(timerId, {
        statusCode: response.status || response.statusCode,
        success: (response.status || response.statusCode || 200) < 400,
        responseSize: response.data ? JSON.stringify(response.data).length : 0,
        ...response
      });
    };
  }

  /**
   * Track database operation performance
   * @param {string} operation - Database operation type
   * @param {string} table - Table name
   * @param {Object} metadata - Operation metadata
   * @returns {Function} Function to call when operation completes
   */
  trackDatabaseOperation(operation, table, metadata = {}) {
    const name = `db-${operation}-${table}`;
    const timerId = this.startTimer(name, {
      operation,
      table,
      ...metadata
    });

    return (results = {}) => {
      this.stopTimer(timerId, {
        success: results.success !== false,
        rowCount: results.rowCount || results.affectedRows || 0,
        ...results
      });
    };
  }

  /**
   * Clean up old metrics to prevent memory leaks
   * @param {string} name - Specific metric name (optional)
   */
  cleanupOldMetrics(name = null) {
    const cutoff = Date.now() - this.retentionPeriod;

    if (name) {
      // Clean specific metric
      const metrics = this.metrics.get(name);
      if (metrics) {
        const filtered = metrics.filter(m => m.timestamp >= cutoff);
        this.metrics.set(name, filtered);
      }
    } else {
      // Clean all metrics
      for (const [metricName, metrics] of this.metrics.entries()) {
        const filtered = metrics.filter(m => m.timestamp >= cutoff);
        this.metrics.set(metricName, filtered);
        
        // Remove empty metric arrays
        if (filtered.length === 0) {
          this.metrics.delete(metricName);
        }
      }
    }
  }

  /**
   * Start automatic cleanup of old metrics
   */
  startAutoCleanup() {
    if (this.cleanupTimer) {
      this.stopAutoCleanup();
    }

    this.cleanupTimer = setInterval(() => {
      logger.debug('Running automatic metric cleanup');
      this.cleanupOldMetrics();
    }, this.cleanupInterval);

    logger.info('Started automatic performance metric cleanup', {
      interval: this.cleanupInterval / 1000 / 60 + ' minutes',
      retention: this.retentionPeriod / 1000 / 60 / 60 + ' hours'
    });
  }

  /**
   * Stop automatic cleanup
   */
  stopAutoCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info('Stopped automatic performance metric cleanup');
    }
  }

  /**
   * Generate performance report
   * @param {Object} options - Report options
   * @returns {Object} Performance report
   */
  generateReport(options = {}) {
    const {
      timeRange = this.retentionPeriod,
      includeRecommendations = true
    } = options;

    const overview = this.getPerformanceOverview({ timeRange });
    const recommendations = includeRecommendations ? this.generateRecommendations(overview) : [];

    return {
      ...overview,
      recommendations,
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage()
      }
    };
  }

  /**
   * Generate performance recommendations
   * @param {Object} overview - Performance overview
   * @returns {Array} Array of recommendations
   */
  generateRecommendations(overview) {
    const recommendations = [];

    // Check for slow operations
    const slowOps = overview.metrics.filter(m => m.avg > 5000); // > 5 seconds
    if (slowOps.length > 0) {
      recommendations.push({
        type: 'performance',
        severity: 'medium',
        message: `${slowOps.length} operations averaging > 5 seconds`,
        details: slowOps.map(op => `${op.name}: ${op.avg}ms average`),
        action: 'Review and optimize slow operations'
      });
    }

    // Check for increasing trends
    const increasingOps = overview.metrics.filter(m => m.trend === 'increasing');
    if (increasingOps.length > 0) {
      recommendations.push({
        type: 'trend',
        severity: 'low',
        message: `${increasingOps.length} operations showing increasing response times`,
        details: increasingOps.map(op => `${op.name}: trending slower`),
        action: 'Monitor trending operations for potential issues'
      });
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    const memUsedMB = memUsage.heapUsed / 1024 / 1024;
    if (memUsedMB > 500) {
      recommendations.push({
        type: 'resource',
        severity: 'medium',
        message: `High memory usage: ${memUsedMB.toFixed(1)}MB`,
        action: 'Monitor memory usage and consider optimization'
      });
    }

    return recommendations;
  }

  /**
   * Reset all metrics (for testing or maintenance)
   */
  reset() {
    this.metrics.clear();
    this.timers.clear();
    logger.info('Performance metrics reset');
  }

  /**
   * Get current status
   * @returns {Object} Tracker status
   */
  getStatus() {
    return {
      metricsCount: this.metrics.size,
      activeTimers: this.timers.size,
      autoCleanup: !!this.cleanupTimer,
      retentionHours: this.retentionPeriod / 1000 / 60 / 60
    };
  }
}

// Export singleton instance
const performanceTracker = new PerformanceTracker();

// Start auto-cleanup by default
performanceTracker.startAutoCleanup();

module.exports = {
  PerformanceTracker,
  performanceTracker
};