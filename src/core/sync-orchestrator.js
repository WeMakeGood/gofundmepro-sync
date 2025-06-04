/**
 * Sync Orchestrator
 * 
 * Manages automated synchronization operations with intelligent scheduling,
 * dependency management, and failure recovery. Ensures continuous data sync
 * between Classy and third-party services.
 */

const { createLogger } = require('../utils/logger');
const { database } = require('../config/database');
const { organizationManager } = require('../services/organization-manager');
const { PluginManager } = require('./plugin-manager');
const { healthMonitor } = require('./health-monitor');
const { performanceTracker } = require('./performance-tracker');

const logger = createLogger('sync-orchestrator');

class SyncOrchestrator {
  constructor() {
    this.isRunning = false;
    this.activeOperations = new Map();
    this.scheduledTasks = new Map();
    this.syncHistory = [];
    this.maxHistorySize = 100;
    this.pluginManager = null;
    this.failureTracker = new Map();
    this.recoveryConfig = {
      maxRetries: 3,
      retryDelay: 5 * 60 * 1000,      // 5 minutes
      backoffMultiplier: 2,
      enableAutoRecovery: true
    };
    
    // Default sync intervals (can be configured)
    this.defaultIntervals = {
      supporters: 30 * 60 * 1000,    // 30 minutes
      transactions: 15 * 60 * 1000,  // 15 minutes  
      campaigns: 60 * 60 * 1000,     // 1 hour
      recurringPlans: 60 * 60 * 1000, // 1 hour
      plugins: 60 * 60 * 1000        // 1 hour for plugin syncs
    };
    
    // Sync order dependencies
    this.syncOrder = ['supporters', 'campaigns', 'transactions', 'recurringPlans'];
    this.pluginSyncOrder = ['mailchimp']; // Add more plugins as implemented
  }

  /**
   * Initialize the orchestrator
   */
  async initialize() {
    logger.info('Initializing Sync Orchestrator');
    
    try {
      // Initialize database connection
      await database.initialize();
      
      // Initialize plugin manager if MailChimp is configured
      if (process.env.MAILCHIMP_API_KEY && process.env.MAILCHIMP_LIST_ID) {
        this.pluginManager = await PluginManager.createDefault({
          mailchimp: {
            apiKey: process.env.MAILCHIMP_API_KEY,
            listId: process.env.MAILCHIMP_LIST_ID,
            batchSize: 100,
            tagPrefix: 'Classy-'
          }
        });
        
        await this.pluginManager.initializeAll();
        logger.info('Plugin manager initialized for automated syncs');
      }
      
      // Register health monitoring
      healthMonitor.registerComponent('sync-orchestrator', async () => {
        return {
          status: this.isRunning ? 'healthy' : 'stopped',
          activeOperations: this.activeOperations.size,
          scheduledTasks: this.scheduledTasks.size,
          lastSyncCount: this.syncHistory.length > 0 ? 
            this.syncHistory[this.syncHistory.length - 1].entities?.length || 0 : 0
        };
      }, { critical: false, timeout: 5000 });
      
      logger.info('Sync Orchestrator initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Sync Orchestrator', { error: error.message });
      throw error;
    }
  }

  /**
   * Start continuous sync operations
   * @param {Object} options - Orchestrator options
   */
  async start(options = {}) {
    if (this.isRunning) {
      logger.warn('Sync Orchestrator already running');
      return;
    }

    const {
      intervals = this.defaultIntervals,
      startImmediate = true,
      enablePlugins = true
    } = options;

    logger.info('Starting Sync Orchestrator', { 
      intervals, 
      startImmediate, 
      enablePlugins 
    });

    this.isRunning = true;

    try {
      // Get all active organizations
      const organizations = await organizationManager.listOrganizations();
      const activeOrgs = organizations.filter(org => org.status === 'active');

      if (activeOrgs.length === 0) {
        logger.warn('No active organizations found - sync orchestrator running but idle');
      }

      // Schedule sync operations for each organization
      for (const org of activeOrgs) {
        await this.scheduleOrganizationSyncs(org, intervals, enablePlugins);
      }

      // Start immediate sync if requested
      if (startImmediate && activeOrgs.length > 0) {
        logger.info('Starting immediate sync for all organizations');
        
        // Stagger initial syncs to avoid overwhelming the system
        for (let i = 0; i < activeOrgs.length; i++) {
          setTimeout(async () => {
            await this.performOrganizationSync(activeOrgs[i], { 
              type: 'incremental',
              includePlugins: enablePlugins 
            });
          }, i * 30000); // 30-second stagger
        }
      }

      // Schedule health monitoring integration
      this.scheduleHealthIntegration();

      logger.info('Sync Orchestrator started successfully', {
        organizations: activeOrgs.length,
        scheduledTasks: this.scheduledTasks.size
      });

    } catch (error) {
      logger.error('Failed to start Sync Orchestrator', { error: error.message });
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Schedule sync operations for a specific organization
   * @param {Object} organization - Organization details
   * @param {Object} intervals - Sync intervals configuration
   * @param {boolean} enablePlugins - Whether to include plugin syncs
   */
  async scheduleOrganizationSyncs(organization, intervals, enablePlugins) {
    const orgId = organization.id;
    
    logger.info('Scheduling syncs for organization', {
      orgId,
      name: organization.name,
      classyId: organization.classy_id
    });

    // Schedule entity syncs
    for (const entity of this.syncOrder) {
      const interval = intervals[entity];
      if (interval) {
        const taskId = `${orgId}-${entity}`;
        
        const intervalId = setInterval(async () => {
          await this.performEntitySync(organization, entity);
        }, interval);

        this.scheduledTasks.set(taskId, {
          type: 'entity',
          organization: orgId,
          entity,
          interval,
          intervalId,
          lastRun: null,
          nextRun: new Date(Date.now() + interval)
        });

        logger.debug('Scheduled entity sync', {
          taskId,
          entity,
          intervalMinutes: interval / 1000 / 60
        });
      }
    }

    // Schedule plugin syncs if enabled
    if (enablePlugins && this.pluginManager) {
      const pluginInterval = intervals.plugins;
      if (pluginInterval) {
        const taskId = `${orgId}-plugins`;
        
        const intervalId = setInterval(async () => {
          await this.performPluginSync(organization);
        }, pluginInterval);

        this.scheduledTasks.set(taskId, {
          type: 'plugins',
          organization: orgId,
          interval: pluginInterval,
          intervalId,
          lastRun: null,
          nextRun: new Date(Date.now() + pluginInterval)
        });

        logger.debug('Scheduled plugin sync', {
          taskId,
          intervalMinutes: pluginInterval / 1000 / 60
        });
      }
    }
  }

  /**
   * Perform complete organization sync
   * @param {Object} organization - Organization details
   * @param {Object} options - Sync options
   */
  async performOrganizationSync(organization, options = {}) {
    const { type = 'incremental', includePlugins = true } = options;
    const orgId = organization.id;
    const operationId = `org-sync-${orgId}-${Date.now()}`;

    if (this.activeOperations.has(orgId)) {
      logger.warn('Organization sync already in progress', { orgId });
      return;
    }

    const operation = {
      id: operationId,
      organizationId: orgId,
      type: 'organization',
      syncType: type,
      startTime: new Date(),
      status: 'running',
      entities: [],
      plugins: [],
      errors: []
    };

    this.activeOperations.set(orgId, operation);
    const timer = performanceTracker.trackSyncOperation('organization', type, {
      organizationId: orgId,
      organizationName: organization.name
    });

    logger.info('Starting organization sync', {
      operationId,
      orgId,
      name: organization.name,
      type,
      includePlugins
    });

    try {
      // Sync entities in dependency order
      for (const entity of this.syncOrder) {
        const entityResult = await this.performEntitySync(organization, entity, { 
          type,
          skipIfActive: false // Allow as part of org sync
        });
        operation.entities.push(entityResult);
      }

      // Sync plugins if enabled
      if (includePlugins && this.pluginManager) {
        const pluginResult = await this.performPluginSync(organization, {
          skipIfActive: false
        });
        operation.plugins.push(pluginResult);
      }

      operation.status = 'completed';
      operation.endTime = new Date();
      operation.duration = operation.endTime - operation.startTime;

      // Calculate summary
      const totalProcessed = operation.entities.reduce((sum, e) => sum + (e.processed || 0), 0);
      const totalErrors = operation.entities.reduce((sum, e) => sum + (e.errors || 0), 0) +
                         operation.plugins.reduce((sum, p) => sum + (p.errors || 0), 0);

      timer({
        success: totalErrors === 0,
        processed: totalProcessed,
        errors: totalErrors,
        entitiesCount: operation.entities.length,
        pluginsCount: operation.plugins.length
      });

      logger.info('Organization sync completed', {
        operationId,
        orgId,
        duration: operation.duration,
        processed: totalProcessed,
        errors: totalErrors,
        entities: operation.entities.length,
        plugins: operation.plugins.length
      });

    } catch (error) {
      operation.status = 'failed';
      operation.endTime = new Date();
      operation.duration = operation.endTime - operation.startTime;
      operation.errors.push(error.message);

      timer({
        success: false,
        error: error.message
      });

      logger.error('Organization sync failed', {
        operationId,
        orgId,
        error: error.message,
        duration: operation.duration
      });

    } finally {
      this.activeOperations.delete(orgId);
      this.addToHistory(operation);
    }
  }

  /**
   * Perform entity sync for an organization
   * @param {Object} organization - Organization details
   * @param {string} entity - Entity type to sync
   * @param {Object} options - Sync options
   */
  async performEntitySync(organization, entity, options = {}) {
    const { type = 'incremental', skipIfActive = true } = options;
    const orgId = organization.id;
    const operationKey = `${orgId}-${entity}`;

    if (skipIfActive && this.activeOperations.has(operationKey)) {
      logger.debug('Entity sync already active, skipping', { orgId, entity });
      return { skipped: true, reason: 'already_active' };
    }

    const timer = performanceTracker.trackSyncOperation(entity, type, {
      organizationId: orgId,
      organizationName: organization.name
    });

    logger.info('Starting entity sync', { orgId, entity, type });

    try {
      this.activeOperations.set(operationKey, {
        organizationId: orgId,
        entity,
        type,
        startTime: new Date()
      });

      // Get appropriate sync class
      const syncClass = this.getSyncClass(entity);
      if (!syncClass) {
        throw new Error(`Unknown entity type: ${entity}`);
      }

      // Perform sync based on type
      let results;
      if (type === 'full') {
        results = await syncClass.fullSync(orgId, organization.classy_id);
      } else {
        results = await syncClass.incrementalSync(orgId, organization.classy_id);
      }

      // Update scheduled task timestamp
      const taskId = `${orgId}-${entity}`;
      const task = this.scheduledTasks.get(taskId);
      if (task) {
        task.lastRun = new Date();
        task.nextRun = new Date(Date.now() + task.interval);
      }

      timer({
        success: true,
        processed: results.processed || results.created || results.updated || 0,
        errors: results.errors || 0
      });

      logger.info('Entity sync completed', {
        orgId,
        entity,
        type,
        processed: results.processed || results.created || results.updated || 0,
        errors: results.errors || 0
      });

      return {
        entity,
        type,
        success: true,
        processed: results.processed || results.created || results.updated || 0,
        errors: results.errors || 0,
        duration: Date.now() - this.activeOperations.get(operationKey).startTime
      };

    } catch (error) {
      timer({
        success: false,
        error: error.message
      });

      logger.error('Entity sync failed', {
        orgId,
        entity,
        type,
        error: error.message
      });

      // Track failure for potential recovery
      await this.trackFailure(operationKey, error, {
        organizationId: orgId,
        entity,
        type
      });

      return {
        entity,
        type,
        success: false,
        error: error.message,
        duration: Date.now() - this.activeOperations.get(operationKey)?.startTime || 0
      };

    } finally {
      this.activeOperations.delete(operationKey);
    }
  }

  /**
   * Perform plugin sync for an organization
   * @param {Object} organization - Organization details
   * @param {Object} options - Sync options
   */
  async performPluginSync(organization, options = {}) {
    const { skipIfActive = true } = options;
    const orgId = organization.id;
    const operationKey = `${orgId}-plugins`;

    if (skipIfActive && this.activeOperations.has(operationKey)) {
      logger.debug('Plugin sync already active, skipping', { orgId });
      return { skipped: true, reason: 'already_active' };
    }

    if (!this.pluginManager) {
      logger.debug('Plugin manager not available, skipping plugin sync', { orgId });
      return { skipped: true, reason: 'no_plugin_manager' };
    }

    const timer = performanceTracker.trackSyncOperation('plugins', 'sync', {
      organizationId: orgId,
      organizationName: organization.name
    });

    logger.info('Starting plugin sync', { orgId });

    try {
      this.activeOperations.set(operationKey, {
        organizationId: orgId,
        type: 'plugins',
        startTime: new Date()
      });

      // Get supporters with email consent for plugin sync
      const supporters = await database.getKnex()('supporters')
        .where('organization_id', orgId)
        .whereNotNull('email_address')
        .where('email_address', '!=', '')
        .where('email_opt_in', true)
        .select('*');

      if (supporters.length === 0) {
        logger.info('No consented supporters found for plugin sync', { orgId });
        return {
          type: 'plugins',
          success: true,
          processed: 0,
          message: 'No consented supporters'
        };
      }

      // Process with plugin manager
      const results = await this.pluginManager.processWithAllPlugins({
        type: 'supporters.sync',
        supporters
      }, { 
        organizationId: orgId,
        syncType: 'incremental' 
      });

      // Update scheduled task timestamp
      const taskId = `${orgId}-plugins`;
      const task = this.scheduledTasks.get(taskId);
      if (task) {
        task.lastRun = new Date();
        task.nextRun = new Date(Date.now() + task.interval);
      }

      const successful = results.successful ? results.successful.length : 0;
      const failed = results.failed ? results.failed.length : 0;
      const totalPlugins = successful + failed;

      timer({
        success: failed === 0,
        processed: supporters.length,
        errors: failed,
        pluginsCount: totalPlugins
      });

      logger.info('Plugin sync completed', {
        orgId,
        supporters: supporters.length,
        successful,
        failed,
        plugins: totalPlugins
      });

      return {
        type: 'plugins',
        success: failed === 0,
        processed: supporters.length,
        errors: failed,
        pluginsProcessed: results.length,
        duration: Date.now() - this.activeOperations.get(operationKey).startTime
      };

    } catch (error) {
      timer({
        success: false,
        error: error.message
      });

      logger.error('Plugin sync failed', {
        orgId,
        error: error.message
      });

      return {
        type: 'plugins',
        success: false,
        error: error.message,
        duration: Date.now() - this.activeOperations.get(operationKey)?.startTime || 0
      };

    } finally {
      this.activeOperations.delete(operationKey);
    }
  }

  /**
   * Get sync class for entity type
   * @param {string} entity - Entity type
   * @returns {Object} Sync class
   */
  getSyncClass(entity) {
    try {
      switch (entity) {
        case 'supporters':
          return require('../classy/entities/supporters').supportersSync;
        case 'transactions':
          return require('../classy/entities/transactions').transactionsSync;
        case 'campaigns':
          return require('../classy/entities/campaigns').campaignsSync;
        case 'recurringPlans':
          return require('../classy/entities/recurring-plans').recurringPlansSync;
        default:
          return null;
      }
    } catch (error) {
      logger.error('Failed to load sync class', { entity, error: error.message });
      return null;
    }
  }

  /**
   * Schedule health monitoring integration
   */
  scheduleHealthIntegration() {
    // Run health check every 5 minutes and log results
    const healthInterval = setInterval(async () => {
      try {
        const health = await healthMonitor.checkAllComponents({ parallel: true });
        
        if (health.status !== 'healthy') {
          logger.warn('System health check detected issues', {
            status: health.status,
            errors: health.summary.errors,
            criticalErrors: health.summary.criticalErrors
          });
        }
        
      } catch (error) {
        logger.error('Health monitoring integration failed', { error: error.message });
      }
    }, 5 * 60 * 1000); // 5 minutes

    this.scheduledTasks.set('health-monitoring', {
      type: 'health',
      interval: 5 * 60 * 1000,
      intervalId: healthInterval,
      lastRun: new Date(),
      nextRun: new Date(Date.now() + 5 * 60 * 1000)
    });
  }

  /**
   * Stop the orchestrator
   */
  async stop() {
    if (!this.isRunning) {
      logger.warn('Sync Orchestrator not running');
      return;
    }

    logger.info('Stopping Sync Orchestrator');

    this.isRunning = false;

    // Clear all scheduled tasks
    for (const [taskId, task] of this.scheduledTasks.entries()) {
      clearInterval(task.intervalId);
      logger.debug('Cleared scheduled task', { taskId });
    }
    this.scheduledTasks.clear();

    // Wait for active operations to complete (with timeout)
    const activeCount = this.activeOperations.size;
    if (activeCount > 0) {
      logger.info('Waiting for active operations to complete', { activeCount });
      
      const timeout = 60000; // 1 minute timeout
      const startTime = Date.now();
      
      while (this.activeOperations.size > 0 && (Date.now() - startTime) < timeout) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (this.activeOperations.size > 0) {
        logger.warn('Some operations still active after timeout', {
          remaining: this.activeOperations.size
        });
      }
    }

    // Shutdown plugin manager
    if (this.pluginManager) {
      await this.pluginManager.shutdownAll();
    }

    logger.info('Sync Orchestrator stopped');
  }

  /**
   * Add operation to history
   * @param {Object} operation - Operation details
   */
  addToHistory(operation) {
    this.syncHistory.push(operation);
    
    // Maintain history size
    if (this.syncHistory.length > this.maxHistorySize) {
      this.syncHistory = this.syncHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get orchestrator status
   * @returns {Object} Status information
   */
  getStatus() {
    const scheduledTasks = Array.from(this.scheduledTasks.values()).map(task => ({
      type: task.type,
      organization: task.organization,
      entity: task.entity,
      intervalMinutes: task.interval / 1000 / 60,
      lastRun: task.lastRun,
      nextRun: task.nextRun
    }));

    const activeOps = Array.from(this.activeOperations.values()).map(op => ({
      organizationId: op.organizationId,
      type: op.type || op.entity,
      startTime: op.startTime,
      duration: Date.now() - op.startTime.getTime()
    }));

    const recentHistory = this.syncHistory.slice(-10).map(op => ({
      id: op.id,
      organizationId: op.organizationId,
      type: op.type,
      status: op.status,
      startTime: op.startTime,
      duration: op.duration,
      entitiesCount: op.entities?.length || 0,
      pluginsCount: op.plugins?.length || 0,
      errorsCount: op.errors?.length || 0
    }));

    return {
      isRunning: this.isRunning,
      scheduledTasks: {
        count: this.scheduledTasks.size,
        tasks: scheduledTasks
      },
      activeOperations: {
        count: this.activeOperations.size,
        operations: activeOps
      },
      history: {
        total: this.syncHistory.length,
        recent: recentHistory
      },
      pluginManager: this.pluginManager ? {
        initialized: true,
        pluginCount: this.pluginManager.plugins.size
      } : null
    };
  }

  /**
   * Track failure for potential recovery
   * @param {string} operationKey - Operation identifier
   * @param {Error} error - Error that occurred
   * @param {Object} context - Operation context
   */
  async trackFailure(operationKey, error, context) {
    if (!this.recoveryConfig.enableAutoRecovery) {
      return;
    }

    const failureInfo = this.failureTracker.get(operationKey) || {
      operationKey,
      context,
      failures: [],
      retryCount: 0,
      nextRetry: null,
      disabled: false
    };

    failureInfo.failures.push({
      timestamp: new Date(),
      error: error.message,
      stack: error.stack
    });

    // Limit failure history
    if (failureInfo.failures.length > 10) {
      failureInfo.failures = failureInfo.failures.slice(-10);
    }

    // Check if we should schedule a retry
    if (failureInfo.retryCount < this.recoveryConfig.maxRetries && !failureInfo.disabled) {
      const delay = this.recoveryConfig.retryDelay * 
                   Math.pow(this.recoveryConfig.backoffMultiplier, failureInfo.retryCount);
      
      failureInfo.nextRetry = new Date(Date.now() + delay);
      failureInfo.retryCount++;

      // Schedule recovery attempt
      setTimeout(async () => {
        await this.attemptRecovery(operationKey, failureInfo);
      }, delay);

      logger.warn('Scheduled recovery attempt', {
        operationKey,
        retryCount: failureInfo.retryCount,
        nextRetry: failureInfo.nextRetry,
        delay: delay / 1000 / 60 + ' minutes'
      });
    } else {
      // Too many failures, disable auto-recovery for this operation
      failureInfo.disabled = true;
      
      logger.error('Operation disabled due to repeated failures', {
        operationKey,
        totalFailures: failureInfo.failures.length,
        retryCount: failureInfo.retryCount
      });
    }

    this.failureTracker.set(operationKey, failureInfo);
  }

  /**
   * Attempt recovery for a failed operation
   * @param {string} operationKey - Operation identifier
   * @param {Object} failureInfo - Failure tracking information
   */
  async attemptRecovery(operationKey, failureInfo) {
    if (!this.isRunning || failureInfo.disabled) {
      return;
    }

    const { context } = failureInfo;
    
    logger.info('Attempting operation recovery', {
      operationKey,
      retryCount: failureInfo.retryCount,
      organizationId: context.organizationId,
      entity: context.entity
    });

    try {
      // Get organization details
      const organization = await organizationManager.getOrganization(context.organizationId);
      
      if (!organization || organization.status !== 'active') {
        logger.warn('Organization not active, skipping recovery', {
          organizationId: context.organizationId
        });
        return;
      }

      // Attempt the operation again
      let result;
      if (context.entity) {
        result = await this.performEntitySync(organization, context.entity, {
          type: context.type,
          skipIfActive: false
        });
      } else if (context.type === 'plugins') {
        result = await this.performPluginSync(organization, {
          skipIfActive: false
        });
      }

      if (result && result.success !== false) {
        // Recovery successful
        this.failureTracker.delete(operationKey);
        
        logger.info('Operation recovery successful', {
          operationKey,
          retryCount: failureInfo.retryCount,
          result: result
        });
      } else {
        // Recovery failed, will be handled by trackFailure
        throw new Error(result?.error || 'Recovery attempt failed');
      }

    } catch (error) {
      logger.error('Recovery attempt failed', {
        operationKey,
        retryCount: failureInfo.retryCount,
        error: error.message
      });

      // Track this failure too
      await this.trackFailure(operationKey, error, context);
    }
  }

  /**
   * Get failure status for operations
   * @returns {Array} Failure information
   */
  getFailureStatus() {
    const failures = [];
    
    for (const [operationKey, failureInfo] of this.failureTracker.entries()) {
      failures.push({
        operationKey,
        context: failureInfo.context,
        retryCount: failureInfo.retryCount,
        totalFailures: failureInfo.failures.length,
        lastFailure: failureInfo.failures[failureInfo.failures.length - 1],
        nextRetry: failureInfo.nextRetry,
        disabled: failureInfo.disabled
      });
    }
    
    return failures.sort((a, b) => {
      if (a.disabled !== b.disabled) return a.disabled ? 1 : -1;
      return b.lastFailure.timestamp - a.lastFailure.timestamp;
    });
  }

  /**
   * Clear failure tracking for an operation
   * @param {string} operationKey - Operation identifier
   */
  clearFailureTracking(operationKey) {
    const removed = this.failureTracker.delete(operationKey);
    if (removed) {
      logger.info('Cleared failure tracking', { operationKey });
    }
    return removed;
  }

  /**
   * Reset all failure tracking
   */
  resetFailureTracking() {
    const count = this.failureTracker.size;
    this.failureTracker.clear();
    logger.info('Reset all failure tracking', { clearedCount: count });
    return count;
  }

  /**
   * Get sync schedule for all organizations
   * @returns {Array} Schedule information
   */
  getSyncSchedule() {
    const schedule = [];
    
    for (const [taskId, task] of this.scheduledTasks.entries()) {
      schedule.push({
        taskId,
        type: task.type,
        organization: task.organization,
        entity: task.entity,
        intervalMinutes: task.interval / 1000 / 60,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
        overdue: task.nextRun && new Date() > task.nextRun
      });
    }
    
    return schedule.sort((a, b) => {
      if (!a.nextRun) return 1;
      if (!b.nextRun) return -1;
      return a.nextRun - b.nextRun;
    });
  }
}

// Export singleton instance
const syncOrchestrator = new SyncOrchestrator();

module.exports = {
  SyncOrchestrator,
  syncOrchestrator
};