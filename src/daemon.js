#!/usr/bin/env node

/**
 * Classy Sync Daemon
 * 
 * Continuous synchronization service that runs automated incremental syncs
 * between Classy and third-party services (MailChimp, etc.)
 */

const fs = require('fs');
const path = require('path');
const { createLogger } = require('./utils/logger');
const { syncOrchestrator } = require('./core/sync-orchestrator');
const { healthMonitor } = require('./core/health-monitor');
const { performanceTracker } = require('./core/performance-tracker');

const logger = createLogger('daemon');

class ClassySyncDaemon {
  constructor() {
    this.isRunning = false;
    this.startTime = null;
    this.pidFile = path.join(__dirname, '../daemon.pid');
    this.configFile = path.join(__dirname, '../daemon-config.json');
    this.healthCheckInterval = null;
    this.statusReportInterval = null;
    
    // Default daemon configuration
    this.config = {
      syncIntervals: {
        supporters: 30 * 60 * 1000,    // 30 minutes
        transactions: 15 * 60 * 1000,  // 15 minutes
        campaigns: 60 * 60 * 1000,     // 1 hour
        recurringPlans: 60 * 60 * 1000, // 1 hour
        plugins: 60 * 60 * 1000        // 1 hour
      },
      healthCheck: {
        interval: 5 * 60 * 1000,       // 5 minutes
        alertOnFailure: true
      },
      statusReporting: {
        interval: 60 * 60 * 1000,      // 1 hour
        logLevel: 'info'
      },
      autoRestart: {
        enabled: true,
        maxRestarts: 5,
        restartDelay: 30 * 1000        // 30 seconds
      },
      plugins: {
        enabled: true,
        mailchimp: true
      }
    };
    
    this.restartCount = 0;
  }

  /**
   * Start the daemon
   * @param {Object} options - Daemon options
   */
  async start(options = {}) {
    if (this.isRunning) {
      logger.warn('Daemon already running');
      return;
    }

    try {
      console.log('🚀 Starting Classy Sync Daemon...');
      
      // Load configuration
      await this.loadConfiguration();
      
      // Override config with command line options
      if (options.config) {
        this.config = { ...this.config, ...options.config };
      }
      
      // Check if another daemon is running
      await this.checkExistingDaemon();
      
      // Initialize core components
      await this.initializeComponents();
      
      // Create PID file
      await this.createPidFile();
      
      // Setup graceful shutdown handlers
      this.setupShutdownHandlers();
      
      // Start sync orchestrator
      await syncOrchestrator.initialize();
      await syncOrchestrator.start({
        intervals: this.config.syncIntervals,
        startImmediate: options.immediate !== false,
        enablePlugins: this.config.plugins.enabled
      });
      
      // Start monitoring services
      this.startMonitoringServices();
      
      this.isRunning = true;
      this.startTime = new Date();
      
      logger.info('Classy Sync Daemon started successfully', {
        pid: process.pid,
        config: this.getSafeConfig(),
        startTime: this.startTime
      });
      
      console.log('✅ Daemon started successfully');
      console.log(`📊 Process ID: ${process.pid}`);
      console.log(`⏰ Sync Intervals: ${this.formatIntervals()}`);
      console.log(`🔌 Plugins: ${this.config.plugins.enabled ? 'Enabled' : 'Disabled'}`);
      console.log('📋 Use `npm run daemon:status` to check status');
      console.log('🛑 Use `npm run daemon:stop` to stop the daemon\n');
      
      // Initial status report
      this.logStatusReport();
      
    } catch (error) {
      logger.error('Failed to start daemon', { error: error.message });
      console.error('❌ Failed to start daemon:', error.message);
      
      // Cleanup on startup failure
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Stop the daemon
   */
  async stop() {
    if (!this.isRunning) {
      logger.warn('Daemon not running');
      return;
    }

    logger.info('Stopping Classy Sync Daemon');
    console.log('🛑 Stopping Classy Sync Daemon...');

    this.isRunning = false;

    try {
      // Stop monitoring services
      this.stopMonitoringServices();
      
      // Stop sync orchestrator
      await syncOrchestrator.stop();
      
      // Stop performance tracking
      performanceTracker.stopAutoCleanup();
      
      // Cleanup
      await this.cleanup();
      
      logger.info('Classy Sync Daemon stopped successfully');
      console.log('✅ Daemon stopped successfully');
      
    } catch (error) {
      logger.error('Error during daemon shutdown', { error: error.message });
      console.error('⚠️  Error during shutdown:', error.message);
    }
  }

  /**
   * Load configuration from file
   */
  async loadConfiguration() {
    try {
      if (fs.existsSync(this.configFile)) {
        const configData = fs.readFileSync(this.configFile, 'utf8');
        const fileConfig = JSON.parse(configData);
        this.config = { ...this.config, ...fileConfig };
        
        logger.info('Configuration loaded from file', { 
          configFile: this.configFile 
        });
      } else {
        // Create default config file
        fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
        logger.info('Created default configuration file', { 
          configFile: this.configFile 
        });
      }
    } catch (error) {
      logger.warn('Failed to load configuration, using defaults', { 
        error: error.message 
      });
    }
  }

  /**
   * Check if another daemon instance is running
   */
  async checkExistingDaemon() {
    if (fs.existsSync(this.pidFile)) {
      const pidData = fs.readFileSync(this.pidFile, 'utf8');
      const existingPid = parseInt(pidData.trim());
      
      try {
        // Check if process is still running
        process.kill(existingPid, 0);
        throw new Error(`Daemon already running with PID ${existingPid}`);
      } catch (killError) {
        if (killError.code === 'ESRCH') {
          // Process not found, remove stale PID file
          fs.unlinkSync(this.pidFile);
          logger.info('Removed stale PID file', { pid: existingPid });
        } else {
          throw killError;
        }
      }
    }
  }

  /**
   * Initialize core components
   */
  async initializeComponents() {
    logger.info('Initializing core components');
    
    // Initialize health monitoring
    await healthMonitor.initializeStandardComponents();
    
    // Start performance tracking
    performanceTracker.startAutoCleanup();
    
    logger.info('Core components initialized');
  }

  /**
   * Create PID file
   */
  async createPidFile() {
    fs.writeFileSync(this.pidFile, process.pid.toString());
    logger.debug('Created PID file', { pid: process.pid, file: this.pidFile });
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupShutdownHandlers() {
    const gracefulShutdown = async (signal) => {
      logger.info('Received shutdown signal', { signal });
      console.log(`\n📨 Received ${signal}, shutting down gracefully...`);
      
      await this.stop();
      process.exit(0);
    };

    // Handle various shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      console.error('💥 Uncaught exception:', error.message);
      
      if (this.config.autoRestart.enabled && this.restartCount < this.config.autoRestart.maxRestarts) {
        console.log('🔄 Attempting automatic restart...');
        await this.attemptRestart();
      } else {
        await this.stop();
        process.exit(1);
      }
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      logger.error('Unhandled promise rejection', { reason, promise });
      console.error('💥 Unhandled promise rejection:', reason);
      
      if (this.config.autoRestart.enabled && this.restartCount < this.config.autoRestart.maxRestarts) {
        console.log('🔄 Attempting automatic restart...');
        await this.attemptRestart();
      } else {
        await this.stop();
        process.exit(1);
      }
    });
  }

  /**
   * Attempt automatic restart
   */
  async attemptRestart() {
    this.restartCount++;
    
    logger.warn('Attempting automatic restart', { 
      restartCount: this.restartCount,
      maxRestarts: this.config.autoRestart.maxRestarts 
    });
    
    try {
      await this.stop();
      
      // Wait before restarting
      await new Promise(resolve => 
        setTimeout(resolve, this.config.autoRestart.restartDelay)
      );
      
      await this.start();
      
    } catch (error) {
      logger.error('Automatic restart failed', { error: error.message });
      process.exit(1);
    }
  }

  /**
   * Start monitoring services
   */
  startMonitoringServices() {
    // Health check monitoring
    if (this.config.healthCheck.interval > 0) {
      this.healthCheckInterval = setInterval(async () => {
        try {
          const health = await healthMonitor.checkAllComponents({ parallel: true });
          
          if (health.status !== 'healthy') {
            logger.warn('Health check detected issues', {
              status: health.status,
              summary: health.summary
            });
            
            if (this.config.healthCheck.alertOnFailure) {
              console.log(`⚠️  Health check alert: ${health.status.toUpperCase()}`);
              console.log(`   Errors: ${health.summary.errors} (${health.summary.criticalErrors} critical)`);
            }
          }
          
        } catch (error) {
          logger.error('Health check monitoring failed', { error: error.message });
        }
      }, this.config.healthCheck.interval);
    }
    
    // Status reporting
    if (this.config.statusReporting.interval > 0) {
      this.statusReportInterval = setInterval(() => {
        this.logStatusReport();
      }, this.config.statusReporting.interval);
    }
    
    logger.debug('Monitoring services started');
  }

  /**
   * Stop monitoring services
   */
  stopMonitoringServices() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.statusReportInterval) {
      clearInterval(this.statusReportInterval);
      this.statusReportInterval = null;
    }
    
    logger.debug('Monitoring services stopped');
  }

  /**
   * Log status report
   */
  logStatusReport() {
    try {
      const status = this.getStatus();
      const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
      
      logger.info('Daemon status report', {
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        orchestrator: status.orchestrator,
        memory: process.memoryUsage(),
        performance: performanceTracker.getStatus()
      });
      
      if (this.config.statusReporting.logLevel === 'info') {
        console.log(`📊 Status Report - Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`);
        console.log(`   Active Operations: ${status.orchestrator.activeOperations.count}`);
        console.log(`   Scheduled Tasks: ${status.orchestrator.scheduledTasks.count}`);
        console.log(`   Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
      }
      
    } catch (error) {
      logger.error('Failed to generate status report', { error: error.message });
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      // Remove PID file
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
        logger.debug('Removed PID file');
      }
    } catch (error) {
      logger.error('Error during cleanup', { error: error.message });
    }
  }

  /**
   * Get daemon status
   * @returns {Object} Status information
   */
  getStatus() {
    // Check if daemon is actually running by examining PID file
    const actuallyRunning = this.checkDaemonRunning();
    
    return {
      isRunning: actuallyRunning.running,
      pid: actuallyRunning.pid || process.pid,
      startTime: this.startTime,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      restartCount: this.restartCount,
      config: this.getSafeConfig(),
      orchestrator: syncOrchestrator.getStatus(),
      memory: process.memoryUsage(),
      performance: performanceTracker.getStatus()
    };
  }

  /**
   * Check if daemon is actually running by checking PID file
   * @returns {Object} Running status and PID
   */
  checkDaemonRunning() {
    if (fs.existsSync(this.pidFile)) {
      try {
        const pidData = fs.readFileSync(this.pidFile, 'utf8');
        const existingPid = parseInt(pidData.trim());
        
        // Check if process is still running
        process.kill(existingPid, 0);
        return { running: true, pid: existingPid };
      } catch (killError) {
        if (killError.code === 'ESRCH') {
          // Process not found
          return { running: false, pid: null };
        } else {
          // Some other error, assume not running
          return { running: false, pid: null };
        }
      }
    }
    return { running: false, pid: null };
  }

  /**
   * Get configuration without sensitive data
   * @returns {Object} Safe configuration
   */
  getSafeConfig() {
    return {
      syncIntervals: this.config.syncIntervals,
      healthCheck: this.config.healthCheck,
      statusReporting: this.config.statusReporting,
      autoRestart: this.config.autoRestart,
      plugins: this.config.plugins
    };
  }

  /**
   * Format intervals for display
   * @returns {string} Formatted intervals
   */
  formatIntervals() {
    const intervals = this.config.syncIntervals;
    const formatted = Object.entries(intervals).map(([entity, ms]) => {
      const minutes = ms / 1000 / 60;
      return `${entity}=${minutes}m`;
    });
    return formatted.join(', ');
  }
}

/**
 * CLI interface for daemon management
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const daemon = new ClassySyncDaemon();
  
  switch (command) {
    case 'start':
      const immediate = !args.includes('--no-immediate');
      await daemon.start({ immediate });
      break;
      
    case 'stop':
      await daemon.stop();
      break;
      
    case 'status':
      const status = daemon.getStatus();
      console.log('📊 Classy Sync Daemon Status');
      console.log('============================');
      console.log(`Running: ${status.isRunning ? '✅ Yes' : '❌ No'}`);
      if (status.isRunning) {
        console.log(`PID: ${status.pid}`);
        console.log(`Uptime: ${Math.floor(status.uptime / 1000 / 60)} minutes`);
        console.log(`Restart Count: ${status.restartCount}`);
        console.log(`Active Operations: ${status.orchestrator.activeOperations.count}`);
        console.log(`Scheduled Tasks: ${status.orchestrator.scheduledTasks.count}`);
      }
      break;
      
    case 'restart':
      await daemon.stop();
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second pause
      await daemon.start();
      break;
      
    case 'schedule':
      const schedule = syncOrchestrator.getSyncSchedule();
      console.log('📅 Sync Schedule');
      console.log('================');
      if (schedule.length === 0) {
        console.log('No scheduled tasks');
      } else {
        schedule.forEach(task => {
          const nextRun = task.nextRun ? task.nextRun.toLocaleTimeString() : 'Never';
          const overdue = task.overdue ? ' (OVERDUE)' : '';
          console.log(`${task.type}/${task.entity || 'all'}: ${task.intervalMinutes}m intervals, next: ${nextRun}${overdue}`);
        });
      }
      break;
      
    default:
      console.log('Classy Sync Daemon');
      console.log('==================');
      console.log('Commands:');
      console.log('  start [--no-immediate]  Start the daemon');
      console.log('  stop                    Stop the daemon');
      console.log('  restart                 Restart the daemon');
      console.log('  status                  Show daemon status');
      console.log('  schedule                Show sync schedule');
      console.log('');
      console.log('Examples:');
      console.log('  npm run daemon:start    Start daemon with immediate sync');
      console.log('  npm run daemon:status   Check if daemon is running');
      console.log('  npm run daemon:stop     Stop the daemon');
      process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Daemon command failed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  ClassySyncDaemon
};