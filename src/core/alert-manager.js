/**
 * Alert Manager
 * 
 * Manages system alerts and notifications based on health monitoring
 * and performance metrics. Supports multiple notification channels.
 */

const { createLogger } = require('../utils/logger');

const logger = createLogger('alert-manager');

class AlertManager {
  constructor() {
    this.rules = new Map();
    this.channels = new Map();
    this.alertHistory = [];
    this.suppressions = new Map();
    this.maxHistorySize = 1000;
    this.defaultCooldown = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Register an alert rule
   * @param {string} name - Rule name
   * @param {Object} rule - Alert rule configuration
   */
  addRule(name, rule) {
    const alertRule = {
      name,
      condition: rule.condition,
      severity: rule.severity || 'medium',
      message: rule.message,
      cooldown: rule.cooldown || this.defaultCooldown,
      channels: rule.channels || ['console'],
      enabled: rule.enabled !== false,
      lastTriggered: null,
      triggerCount: 0
    };

    this.rules.set(name, alertRule);
    logger.debug('Alert rule registered', { name, severity: alertRule.severity });
  }

  /**
   * Register a notification channel
   * @param {string} name - Channel name
   * @param {Object} channel - Channel configuration
   */
  addChannel(name, channel) {
    this.channels.set(name, {
      name,
      type: channel.type,
      config: channel.config || {},
      enabled: channel.enabled !== false,
      sendFunction: channel.sendFunction,
      lastUsed: null,
      messageCount: 0
    });

    logger.debug('Notification channel registered', { name, type: channel.type });
  }

  /**
   * Process system data and trigger alerts if conditions are met
   * @param {Object} data - System data (health, performance, etc.)
   */
  async processAlerts(data) {
    const triggeredAlerts = [];

    for (const [ruleName, rule] of this.rules.entries()) {
      if (!rule.enabled) continue;

      try {
        // Check cooldown period
        if (this.isInCooldown(rule)) {
          continue;
        }

        // Evaluate condition
        const shouldTrigger = await this.evaluateCondition(rule.condition, data);

        if (shouldTrigger) {
          const alert = await this.triggerAlert(rule, data);
          triggeredAlerts.push(alert);
        }

      } catch (error) {
        logger.error('Error processing alert rule', {
          rule: ruleName,
          error: error.message
        });
      }
    }

    return triggeredAlerts;
  }

  /**
   * Trigger an alert
   * @param {Object} rule - Alert rule
   * @param {Object} data - System data
   * @returns {Object} Alert object
   */
  async triggerAlert(rule, data) {
    const alert = {
      id: this.generateAlertId(),
      rule: rule.name,
      severity: rule.severity,
      message: this.formatMessage(rule.message, data),
      timestamp: new Date(),
      data: this.extractRelevantData(data, rule),
      status: 'active'
    };

    // Update rule state
    rule.lastTriggered = alert.timestamp;
    rule.triggerCount++;

    // Add to history
    this.addToHistory(alert);

    // Send notifications
    await this.sendNotifications(alert, rule.channels);

    logger.warn('Alert triggered', {
      id: alert.id,
      rule: rule.name,
      severity: alert.severity
    });

    return alert;
  }

  /**
   * Evaluate alert condition
   * @param {Function|Object} condition - Condition function or object
   * @param {Object} data - System data
   * @returns {boolean} Whether condition is met
   */
  async evaluateCondition(condition, data) {
    if (typeof condition === 'function') {
      return await condition(data);
    }

    if (typeof condition === 'object') {
      return this.evaluateObjectCondition(condition, data);
    }

    logger.warn('Invalid alert condition type', { condition: typeof condition });
    return false;
  }

  /**
   * Evaluate object-based condition
   * @param {Object} condition - Condition object
   * @param {Object} data - System data
   * @returns {boolean} Whether condition is met
   */
  evaluateObjectCondition(condition, data) {
    const { path, operator, value } = condition;

    // Extract value from data using path
    const actualValue = this.getValueByPath(data, path);

    if (actualValue === undefined) {
      return false;
    }

    // Apply operator
    switch (operator) {
      case 'equals':
        return actualValue === value;
      case 'not_equals':
        return actualValue !== value;
      case 'greater_than':
        return actualValue > value;
      case 'less_than':
        return actualValue < value;
      case 'greater_equal':
        return actualValue >= value;
      case 'less_equal':
        return actualValue <= value;
      case 'contains':
        return Array.isArray(actualValue) ? actualValue.includes(value) : 
               typeof actualValue === 'string' ? actualValue.includes(value) : false;
      case 'regex':
        return new RegExp(value).test(String(actualValue));
      default:
        logger.warn('Unknown operator in condition', { operator });
        return false;
    }
  }

  /**
   * Get value from object by dot-notation path
   * @param {Object} obj - Object to extract from
   * @param {string} path - Dot-notation path
   * @returns {*} Extracted value
   */
  getValueByPath(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && typeof current === 'object' ? current[key] : undefined;
    }, obj);
  }

  /**
   * Check if rule is in cooldown period
   * @param {Object} rule - Alert rule
   * @returns {boolean} Whether rule is in cooldown
   */
  isInCooldown(rule) {
    if (!rule.lastTriggered) return false;
    
    const timeSinceLastTrigger = Date.now() - rule.lastTriggered.getTime();
    return timeSinceLastTrigger < rule.cooldown;
  }

  /**
   * Format alert message with data interpolation
   * @param {string} template - Message template
   * @param {Object} data - System data
   * @returns {string} Formatted message
   */
  formatMessage(template, data) {
    return template.replace(/\{([^}]+)\}/g, (match, path) => {
      const value = this.getValueByPath(data, path);
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Extract relevant data for alert context
   * @param {Object} data - System data
   * @param {Object} rule - Alert rule
   * @returns {Object} Relevant data
   */
  extractRelevantData(data, rule) {
    // Basic extraction - could be enhanced based on rule configuration
    return {
      timestamp: data.timestamp,
      status: data.status,
      summary: data.summary,
      components: data.components?.filter(c => c.status === 'error') || []
    };
  }

  /**
   * Send notifications to configured channels
   * @param {Object} alert - Alert object
   * @param {Array} channelNames - Channel names to use
   */
  async sendNotifications(alert, channelNames) {
    const promises = channelNames.map(async (channelName) => {
      const channel = this.channels.get(channelName);
      
      if (!channel || !channel.enabled) {
        logger.debug('Channel not available or disabled', { channel: channelName });
        return;
      }

      try {
        await this.sendToChannel(alert, channel);
        
        // Update channel stats
        channel.lastUsed = new Date();
        channel.messageCount++;
        
      } catch (error) {
        logger.error('Failed to send notification', {
          channel: channelName,
          alert: alert.id,
          error: error.message
        });
      }
    });

    await Promise.all(promises);
  }

  /**
   * Send alert to specific channel
   * @param {Object} alert - Alert object
   * @param {Object} channel - Channel configuration
   */
  async sendToChannel(alert, channel) {
    switch (channel.type) {
      case 'console':
        this.sendToConsole(alert);
        break;
        
      case 'webhook':
        await this.sendToWebhook(alert, channel.config);
        break;
        
      case 'email':
        await this.sendToEmail(alert, channel.config);
        break;
        
      case 'custom':
        if (channel.sendFunction) {
          await channel.sendFunction(alert, channel.config);
        }
        break;
        
      default:
        logger.warn('Unknown channel type', { type: channel.type });
    }
  }

  /**
   * Send alert to console
   * @param {Object} alert - Alert object
   */
  sendToConsole(alert) {
    const icon = this.getSeverityIcon(alert.severity);
    const timestamp = alert.timestamp.toISOString();
    
    console.log(`\n${icon} ALERT [${alert.severity.toUpperCase()}] ${timestamp}`);
    console.log(`Rule: ${alert.rule}`);
    console.log(`Message: ${alert.message}`);
    
    if (alert.data.components && alert.data.components.length > 0) {
      console.log('Affected components:');
      alert.data.components.forEach(comp => {
        console.log(`  - ${comp.component}: ${comp.error || comp.status}`);
      });
    }
    console.log('');
  }

  /**
   * Send alert to webhook
   * @param {Object} alert - Alert object
   * @param {Object} config - Webhook configuration
   */
  async sendToWebhook(alert, config) {
    const axios = require('axios');
    
    const payload = {
      alert: {
        id: alert.id,
        rule: alert.rule,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp.toISOString(),
        data: alert.data
      },
      system: 'classy-sync'
    };

    await axios.post(config.url, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...config.headers
      },
      timeout: config.timeout || 10000
    });

    logger.debug('Alert sent to webhook', { url: config.url, alert: alert.id });
  }

  /**
   * Send alert to email (placeholder - would need email service integration)
   * @param {Object} alert - Alert object
   * @param {Object} config - Email configuration
   */
  async sendToEmail(alert, config) {
    // This would integrate with an email service like SendGrid, SES, etc.
    logger.info('Email notification would be sent', {
      to: config.to,
      subject: `Classy Sync Alert: ${alert.rule}`,
      alert: alert.id
    });
  }

  /**
   * Get severity icon
   * @param {string} severity - Alert severity
   * @returns {string} Icon for severity
   */
  getSeverityIcon(severity) {
    switch (severity) {
      case 'critical': return '🚨';
      case 'high': return '🔴';
      case 'medium': return '⚠️';
      case 'low': return 'ℹ️';
      default: return '📢';
    }
  }

  /**
   * Generate unique alert ID
   * @returns {string} Alert ID
   */
  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add alert to history
   * @param {Object} alert - Alert object
   */
  addToHistory(alert) {
    this.alertHistory.push(alert);
    
    // Maintain history size
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get alert history
   * @param {Object} options - Filter options
   * @returns {Array} Alert history
   */
  getAlertHistory(options = {}) {
    const {
      severity,
      rule,
      since,
      limit = 50
    } = options;

    let filtered = this.alertHistory;

    if (severity) {
      filtered = filtered.filter(alert => alert.severity === severity);
    }

    if (rule) {
      filtered = filtered.filter(alert => alert.rule === rule);
    }

    if (since) {
      const sinceDate = new Date(since);
      filtered = filtered.filter(alert => alert.timestamp >= sinceDate);
    }

    return filtered.slice(-limit);
  }

  /**
   * Initialize default alert rules
   */
  initializeDefaultRules() {
    // Critical component failures
    this.addRule('critical-component-failure', {
      condition: (data) => {
        const criticalErrors = data.components?.filter(c => 
          c.status === 'error' && c.critical
        ) || [];
        return criticalErrors.length > 0;
      },
      severity: 'critical',
      message: 'Critical system component failure detected: {summary.criticalErrors} component(s) failing',
      cooldown: 2 * 60 * 1000, // 2 minutes
      channels: ['console', 'webhook']
    });

    // System degraded
    this.addRule('system-degraded', {
      condition: (data) => data.status === 'degraded',
      severity: 'medium',
      message: 'System performance degraded: {summary.errors} component(s) with errors',
      cooldown: 10 * 60 * 1000, // 10 minutes
      channels: ['console']
    });

    // High memory usage
    this.addRule('high-memory-usage', {
      condition: {
        path: 'system.memory.heapUsed',
        operator: 'greater_than',
        value: 500 * 1024 * 1024 // 500MB
      },
      severity: 'medium',
      message: 'High memory usage detected: {system.memory.heapUsed} bytes used',
      cooldown: 15 * 60 * 1000, // 15 minutes
      channels: ['console']
    });

    logger.info('Default alert rules initialized');
  }

  /**
   * Initialize default notification channels
   */
  initializeDefaultChannels() {
    // Console channel (always available)
    this.addChannel('console', {
      type: 'console',
      enabled: true
    });

    // Webhook channel (if configured)
    if (process.env.ALERT_WEBHOOK_URL) {
      this.addChannel('webhook', {
        type: 'webhook',
        config: {
          url: process.env.ALERT_WEBHOOK_URL,
          headers: process.env.ALERT_WEBHOOK_HEADERS ? 
            JSON.parse(process.env.ALERT_WEBHOOK_HEADERS) : {}
        },
        enabled: true
      });
    }

    logger.info('Default notification channels initialized');
  }

  /**
   * Get manager status
   * @returns {Object} Manager status
   */
  getStatus() {
    return {
      rules: {
        total: this.rules.size,
        enabled: Array.from(this.rules.values()).filter(r => r.enabled).length
      },
      channels: {
        total: this.channels.size,
        enabled: Array.from(this.channels.values()).filter(c => c.enabled).length
      },
      history: {
        total: this.alertHistory.length,
        recent: this.alertHistory.filter(a => 
          Date.now() - a.timestamp.getTime() < 24 * 60 * 60 * 1000
        ).length
      }
    };
  }
}

// Export singleton instance
const alertManager = new AlertManager();

// Initialize default rules and channels
alertManager.initializeDefaultRules();
alertManager.initializeDefaultChannels();

module.exports = {
  AlertManager,
  alertManager
};