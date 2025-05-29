const cron = require('node-cron');
const { Queue, Worker } = require('bullmq');
const Redis = require('redis');
const logger = require('../utils/logger');

class SyncScheduler {
  constructor(config = {}) {
    this.redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      ...config.redis
    };
    
    this.syncIntervalMinutes = process.env.SYNC_INTERVAL_MINUTES || 15;
    this.fullSyncHour = process.env.FULL_SYNC_HOUR || 2;
    
    this.redis = null;
    this.syncQueue = null;
    this.worker = null;
    this.cronJobs = [];
  }

  async initialize() {
    try {
      // Initialize Redis connection
      this.redis = Redis.createClient(this.redisConfig);
      await this.redis.connect();
      
      // Initialize BullMQ queue
      this.syncQueue = new Queue('sync-jobs', {
        connection: this.redis
      });

      logger.info('Scheduler initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize scheduler:', error);
      throw error;
    }
  }

  async startWorker(syncEngine) {
    this.worker = new Worker('sync-jobs', async (job) => {
      const { type, entityType, params = {} } = job.data;
      
      logger.syncEvent('job_started', {
        jobId: job.id,
        type,
        entityType,
        params
      });

      try {
        let result;
        
        switch (type) {
          case 'incremental':
            result = await syncEngine.runIncrementalSync(entityType, params);
            break;
          case 'full':
            result = await syncEngine.runFullSync(entityType, params);
            break;
          case 'single':
            result = await syncEngine.syncSingleEntity(entityType, params.id);
            break;
          default:
            throw new Error(`Unknown sync type: ${type}`);
        }

        logger.syncEvent('job_completed', {
          jobId: job.id,
          type,
          entityType,
          result
        });

        return result;
      } catch (error) {
        logger.error('Sync job failed:', {
          jobId: job.id,
          type,
          entityType,
          error: error.message
        });
        throw error;
      }
    }, {
      connection: this.redis,
      concurrency: 1 // Process one sync job at a time
    });

    this.worker.on('completed', (job, result) => {
      logger.info(`Job ${job.id} completed`, result);
    });

    this.worker.on('failed', (job, err) => {
      logger.error(`Job ${job.id} failed:`, err);
    });

    logger.info('Sync worker started');
  }

  setupCronJobs() {
    // Incremental sync every X minutes
    const incrementalCron = cron.schedule(`*/${this.syncIntervalMinutes} * * * *`, async () => {
      await this.scheduleIncrementalSyncs();
    }, {
      scheduled: false
    });

    // Full sync daily at specified hour
    const fullSyncCron = cron.schedule(`0 ${this.fullSyncHour} * * *`, async () => {
      await this.scheduleFullSyncs();
    }, {
      scheduled: false
    });

    // Weekly supporter profile refresh
    const weeklyRefreshCron = cron.schedule('0 3 * * 0', async () => {
      await this.scheduleWeeklyRefresh();
    }, {
      scheduled: false
    });

    // Monthly campaign metadata sync
    const monthlyCron = cron.schedule('0 4 1 * *', async () => {
      await this.scheduleMonthlySyncs();
    }, {
      scheduled: false
    });

    this.cronJobs = [
      { name: 'incremental', job: incrementalCron },
      { name: 'full_sync', job: fullSyncCron },
      { name: 'weekly_refresh', job: weeklyRefreshCron },
      { name: 'monthly', job: monthlyCron }
    ];

    logger.info('Cron jobs configured', {
      incrementalInterval: `${this.syncIntervalMinutes} minutes`,
      fullSyncHour: this.fullSyncHour
    });
  }

  startCronJobs() {
    this.cronJobs.forEach(({ name, job }) => {
      job.start();
      logger.info(`Started cron job: ${name}`);
    });
  }

  stopCronJobs() {
    this.cronJobs.forEach(({ name, job }) => {
      job.stop();
      logger.info(`Stopped cron job: ${name}`);
    });
  }

  async scheduleIncrementalSyncs() {
    const jobs = [
      { type: 'incremental', entityType: 'transactions' },
      { type: 'incremental', entityType: 'recurring_plans' },
      { type: 'incremental', entityType: 'supporters' }
    ];

    for (const jobData of jobs) {
      await this.syncQueue.add('sync', jobData, {
        priority: 10,
        removeOnComplete: 10,
        removeOnFail: 50
      });
    }

    logger.syncEvent('incremental_syncs_scheduled', { jobCount: jobs.length });
  }

  async scheduleFullSyncs() {
    const jobs = [
      { type: 'full', entityType: 'organizations' },
      { type: 'full', entityType: 'campaigns' },
      { type: 'full', entityType: 'transactions' },
      { type: 'full', entityType: 'recurring_plans' },
      { type: 'full', entityType: 'supporters' }
    ];

    for (const jobData of jobs) {
      await this.syncQueue.add('sync', jobData, {
        priority: 5,
        removeOnComplete: 5,
        removeOnFail: 20
      });
    }

    logger.syncEvent('full_syncs_scheduled', { jobCount: jobs.length });
  }

  async scheduleWeeklyRefresh() {
    await this.syncQueue.add('sync', {
      type: 'full',
      entityType: 'supporters',
      params: { refreshProfiles: true }
    }, {
      priority: 3,
      removeOnComplete: 5,
      removeOnFail: 10
    });

    logger.syncEvent('weekly_refresh_scheduled');
  }

  async scheduleMonthlySyncs() {
    const jobs = [
      { type: 'full', entityType: 'campaigns' },
      { type: 'full', entityType: 'organizations' },
      { type: 'full', entityType: 'fundraising_teams' },
      { type: 'full', entityType: 'fundraising_pages' }
    ];

    for (const jobData of jobs) {
      await this.syncQueue.add('sync', jobData, {
        priority: 1,
        removeOnComplete: 3,
        removeOnFail: 10
      });
    }

    logger.syncEvent('monthly_syncs_scheduled', { jobCount: jobs.length });
  }

  async scheduleManualSync(entityType, syncType = 'incremental', params = {}) {
    const job = await this.syncQueue.add('sync', {
      type: syncType,
      entityType,
      params
    }, {
      priority: 20, // High priority for manual syncs
      removeOnComplete: 5,
      removeOnFail: 10
    });

    logger.syncEvent('manual_sync_scheduled', {
      jobId: job.id,
      entityType,
      syncType,
      params
    });

    return job;
  }

  async getQueueStats() {
    const waiting = await this.syncQueue.getWaiting();
    const active = await this.syncQueue.getActive();
    const completed = await this.syncQueue.getCompleted();
    const failed = await this.syncQueue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      timestamp: new Date().toISOString()
    };
  }

  async healthCheck() {
    try {
      await this.redis.ping();
      const stats = await this.getQueueStats();
      
      return {
        status: 'ok',
        redis: 'connected',
        queue: stats,
        timestamp: new Date().toISOString()
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
    logger.info('Shutting down scheduler...');
    
    this.stopCronJobs();
    
    if (this.worker) {
      await this.worker.close();
    }
    
    if (this.redis) {
      await this.redis.quit();
    }
    
    logger.info('Scheduler shutdown complete');
  }
}

module.exports = SyncScheduler;