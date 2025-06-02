#!/usr/bin/env node

require('dotenv').config();

const SyncEngine = require('./src/core/sync-engine');
const SyncScheduler = require('./src/core/scheduler');
const PluginLoader = require('./src/core/plugin-loader');
const { getInstance: getDatabase } = require('./src/core/knex-database');
const logger = require('./src/utils/logger');

class ClassySyncDaemon {
  constructor() {
    this.syncEngine = null;
    this.scheduler = null;
    this.pluginLoader = null;
    this.db = getDatabase();
    this.isShuttingDown = false;
    this.healthCheckInterval = null;
  }

  async start() {
    try {
      logger.info('Starting Classy Sync Daemon...');
      
      // Initialize core components
      await this.initializeComponents();
      
      // Setup signal handlers for graceful shutdown
      this.setupSignalHandlers();
      
      // Start health check monitoring
      this.startHealthChecks();
      
      // Start the scheduler
      this.scheduler.setupCronJobs();
      this.scheduler.startCronJobs();
      
      logger.info('Classy Sync Daemon started successfully');
      logger.info('Daemon is running. Press Ctrl+C to stop.');
      
    } catch (error) {
      logger.error('Failed to start daemon:', error);
      process.exit(1);
    }
  }

  async initializeComponents() {
    try {
      // Initialize database
      await this.db.connect();
      logger.info('Database connected');
      
      // Initialize sync engine
      this.syncEngine = new SyncEngine();
      await this.syncEngine.initialize();
      logger.info('Sync engine initialized');
      
      // Initialize plugin loader first
      this.pluginLoader = new PluginLoader({
        db: this.db,
        logger: logger,
        queue: null, // Will be set after scheduler initialization
        plugins: this.getPluginConfigs()
      });
      
      await this.pluginLoader.loadAllPlugins();
      logger.info('Plugins loaded');
      
      // Initialize scheduler with plugin loader
      this.scheduler = new SyncScheduler();
      await this.scheduler.initialize();
      await this.scheduler.startWorker(this.syncEngine, this.pluginLoader);
      logger.info('Scheduler initialized with plugin integration');
      
    } catch (error) {
      logger.error('Component initialization failed:', error);
      throw error;
    }
  }

  getPluginConfigs() {
    // Load plugin configurations from environment or config files
    const configs = {};
    
    // MailChimp plugin config
    if (process.env.MAILCHIMP_API_KEY) {
      configs['mailchimp-sync'] = {
        enabled: true,
        apiKey: process.env.MAILCHIMP_API_KEY,
        listId: process.env.MAILCHIMP_LIST_ID,
        syncMode: 'incremental',
        batchSize: 50,
        tagPrefix: 'Classy-',
        requestsPerSecond: 2 // MailChimp rate limit
      };
    }
    
    // Add other plugin configurations here
    
    return configs;
  }

  setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        if (this.isShuttingDown) {
          logger.warn('Force shutdown initiated');
          process.exit(1);
        }
        
        logger.info(`Received ${signal}, starting graceful shutdown...`);
        this.isShuttingDown = true;
        
        try {
          await this.shutdown();
          process.exit(0);
        } catch (error) {
          logger.error('Shutdown failed:', error);
          process.exit(1);
        }
      });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled promise rejection:', { reason, promise });
      process.exit(1);
    });
  }

  startHealthChecks() {
    const interval = parseInt(process.env.HEALTH_CHECK_INTERVAL) || 60000; // 1 minute
    
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getHealthStatus();
        
        if (health.status !== 'ok') {
          logger.warn('Health check failed:', health);
          
          // Trigger plugin event for health issues
          await this.pluginLoader.processEvent({
            type: 'health.warning',
            health: health,
            timestamp: new Date().toISOString()
          });
        } else {
          logger.debug('Health check passed');
        }
        
      } catch (error) {
        logger.error('Health check error:', error);
      }
    }, interval);
  }

  async getHealthStatus() {
    try {
      const checks = {
        database: await this.db.healthCheck(),
        syncEngine: await this.syncEngine.healthCheck(),
        scheduler: await this.scheduler.healthCheck(),
        plugins: await this.pluginLoader.healthCheck()
      };
      
      const allHealthy = Object.values(checks).every(check => 
        check.status === 'ok' || check.status === 'warning'
      );
      
      return {
        status: allHealthy ? 'ok' : 'error',
        checks,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async shutdown() {
    logger.info('Shutting down Classy Sync Daemon...');
    
    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    // Shutdown components in reverse order
    if (this.pluginLoader) {
      await this.pluginLoader.shutdownAllPlugins();
      logger.info('Plugins shut down');
    }
    
    if (this.scheduler) {
      await this.scheduler.shutdown();
      logger.info('Scheduler shut down');
    }
    
    if (this.syncEngine) {
      await this.syncEngine.shutdown();
      logger.info('Sync engine shut down');
    }
    
    logger.info('Classy Sync Daemon shut down complete');
  }

  // API for manual operations
  async triggerManualSync(entityType, syncType = 'incremental', params = {}) {
    if (!this.scheduler) {
      throw new Error('Scheduler not initialized');
    }
    
    const job = await this.scheduler.scheduleManualSync(entityType, syncType, params);
    
    // Trigger plugin event
    await this.pluginLoader.processEvent({
      type: 'sync.manual_triggered',
      entityType,
      syncType,
      jobId: job.id,
      params,
      timestamp: new Date().toISOString()
    });
    
    return job;
  }

  async getSystemStatus() {
    const health = await this.getHealthStatus();
    const queueStats = this.scheduler ? await this.scheduler.getQueueStats() : null;
    const pluginStatus = this.pluginLoader ? this.pluginLoader.getPluginStatus() : {};
    
    return {
      ...health,
      queue: queueStats,
      plugins: pluginStatus
    };
  }
}

// HTTP API for monitoring and control (optional)
function createHttpServer(daemon) {
  const http = require('http');
  const url = require('url');
  
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    try {
      switch (path) {
        case '/health':
          const health = await daemon.getHealthStatus();
          res.statusCode = health.status === 'ok' ? 200 : 503;
          res.end(JSON.stringify(health, null, 2));
          break;
          
        case '/status':
          const status = await daemon.getSystemStatus();
          res.statusCode = 200;
          res.end(JSON.stringify(status, null, 2));
          break;
          
        case '/sync':
          if (req.method === 'POST') {
            // Manual sync trigger
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              try {
                const { entityType, syncType, params } = JSON.parse(body);
                const job = await daemon.triggerManualSync(entityType, syncType, params);
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true, jobId: job.id }));
              } catch (error) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: error.message }));
              }
            });
          } else {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method not allowed' }));
          }
          break;
          
        default:
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  
  const port = process.env.HTTP_PORT || 3000;
  server.listen(port, () => {
    logger.info(`HTTP API listening on port ${port}`);
  });
  
  return server;
}

// Main execution
async function main() {
  const daemon = new ClassySyncDaemon();
  
  // Start HTTP server if enabled
  if (process.env.ENABLE_HTTP_API === 'true') {
    createHttpServer(daemon);
  }
  
  // Start the daemon
  await daemon.start();
  
  // Keep the process running
  process.stdin.resume();
}

if (require.main === module) {
  main().catch(error => {
    logger.error('Daemon startup failed:', error);
    process.exit(1);
  });
}

module.exports = ClassySyncDaemon;