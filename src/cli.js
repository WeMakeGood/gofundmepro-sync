#!/usr/bin/env node

/**
 * Classy Sync CLI
 * 
 * Command-line interface for managing sync operations
 */

const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { database } = require('./config/database');
const { logger } = require('./utils/logger');
const { organizationManager } = require('./services/organization-manager');
const { encryption } = require('./utils/encryption-simple');

// Import entity sync classes
const { supportersSync } = require('./classy/entities/supporters');
const { transactionsSync } = require('./classy/entities/transactions');
const { campaignsSync } = require('./classy/entities/campaigns');
const { recurringPlansSync } = require('./classy/entities/recurring-plans');

// Initialize CLI
const cli = yargs(hideBin(process.argv))
  .scriptName('classy-sync')
  .version(require('../package.json').version)
  .demandCommand(1, 'You need to specify a command')
  .help()
  .alias('h', 'help')
  .recommendCommands()
  .strict();

// Database commands
cli.command({
  command: 'db <action>',
  describe: 'Database management commands',
  builder: (yargs) => {
    return yargs
      .positional('action', {
        describe: 'Database action to perform',
        choices: ['migrate', 'rollback', 'seed', 'reset', 'status', 'stats']
      })
      .option('all', {
        alias: 'a',
        type: 'boolean',
        describe: 'For rollback: rollback all migrations',
        default: false
      });
  },
  handler: async (argv) => {
    try {
      await database.initialize();
      
      switch (argv.action) {
        case 'migrate':
          logger.info('Running database migrations...');
          const migrations = await database.migrate();
          logger.info('Migrations completed', { migrations });
          break;
          
        case 'rollback':
          logger.info(`Rolling back migrations${argv.all ? ' (all)' : ''}...`);
          const rollbacks = await database.rollback(argv.all);
          logger.info('Rollback completed', { rollbacks });
          break;
          
        case 'seed':
          logger.info('Running database seeds...');
          const seeds = await database.seed();
          logger.info('Seeds completed', { seeds });
          break;
          
        case 'reset':
          logger.info('Resetting database...');
          await database.rollback(true);
          await database.migrate();
          await database.seed();
          logger.info('Database reset completed');
          break;
          
        case 'status':
          const health = await database.healthCheck();
          logger.info('Database status', health);
          break;
          
        case 'stats':
          const stats = await database.getStats();
          logger.info('Database statistics', stats);
          break;
      }
      
      await database.close();
      process.exit(0);
    } catch (error) {
      logger.error('Database command failed', error);
      process.exit(1);
    }
  }
});

// Test command for Phase 1 validation
cli.command({
  command: 'test-infrastructure',
  describe: 'Test Phase 1 infrastructure components',
  handler: async () => {
    try {
      logger.info('Testing Phase 1 infrastructure...');
      
      // Test database connection
      logger.info('Testing database connection...');
      await database.initialize();
      const health = await database.healthCheck();
      logger.info('Database health check', health);
      
      // Test database stats
      const stats = await database.getStats();
      logger.info('Database statistics', stats);
      
      // Test logging
      logger.info('Testing logging system...');
      const testLogger = logger.child('test');
      testLogger.debug('Debug message test');
      testLogger.info('Info message test');
      testLogger.warn('Warning message test');
      testLogger.sync('test-sync', { records: 100, duration: 250 });
      testLogger.apiRequest('GET', '/test-endpoint');
      testLogger.database('SELECT', 'supporters', { count: 3 });
      testLogger.performance('test-operation', 150, { success: true });
      
      logger.info('✅ Phase 1 infrastructure test completed successfully');
      
      await database.close();
      process.exit(0);
    } catch (error) {
      logger.error('Infrastructure test failed', error);
      process.exit(1);
    }
  }
});

// Organization management commands
cli.command({
  command: 'org <action>',
  describe: 'Organization management with encrypted Classy credentials',
  builder: (yargs) => {
    return yargs
      .positional('action', {
        describe: 'Organization action to perform',
        choices: ['add', 'list', 'show', 'update', 'delete', 'test']
      })
      .option('name', {
        alias: 'n',
        type: 'string',
        describe: 'Organization name'
      })
      .option('classy-id', {
        alias: 'c',
        type: 'number',
        describe: 'Classy organization ID'
      })
      .option('client-id', {
        type: 'string',
        describe: 'Classy API client ID'
      })
      .option('client-secret', {
        type: 'string',
        describe: 'Classy API client secret'
      })
      .option('id', {
        alias: 'i',
        type: 'number',
        describe: 'Internal organization ID'
      })
      .option('status', {
        alias: 's',
        type: 'string',
        choices: ['active', 'inactive'],
        describe: 'Organization status'
      });
  },
  handler: async (argv) => {
    try {
      await database.initialize();
      
      switch (argv.action) {
        case 'add':
          await handleAddOrganization(argv);
          break;
          
        case 'list':
          await handleListOrganizations(argv);
          break;
          
        case 'show':
          await handleShowOrganization(argv);
          break;
          
        case 'update':
          await handleUpdateOrganization(argv);
          break;
          
        case 'delete':
          await handleDeleteOrganization(argv);
          break;
          
        case 'test':
          await handleTestCredentials(argv);
          break;
      }
      
      await database.close();
      process.exit(0);
    } catch (error) {
      logger.error('Organization command failed', error);
      process.exit(1);
    }
  }
});

// Sync commands (Phase 2)
cli.command({
  command: 'sync <entity> [type]',
  describe: 'Sync data from Classy API using encrypted credentials',
  builder: (yargs) => {
    return yargs
      .positional('entity', {
        describe: 'Entity to sync',
        choices: ['supporters', 'transactions', 'campaigns', 'recurring-plans', 'all']
      })
      .positional('type', {
        describe: 'Sync type',
        choices: ['incremental', 'full'],
        default: 'incremental'
      })
      .option('org-id', {
        alias: 'o',
        type: 'number',
        describe: 'Organization ID to sync'
      })
      .option('limit', {
        alias: 'l',
        type: 'number',
        describe: 'Maximum records to sync'
      })
      .option('since', {
        alias: 's',
        type: 'string',
        describe: 'Only sync records updated since date (YYYY-MM-DD)'
      })
      .option('recalculate-stats', {
        type: 'boolean',
        default: true,
        describe: 'Recalculate lifetime stats after supporter sync'
      })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        describe: 'Show what would be synced without making changes'
      });
  },
  handler: async (argv) => {
    try {
      await database.initialize();
      
      // Get organization to sync
      let orgId = argv.orgId;
      if (!orgId) {
        const orgs = await organizationManager.listOrganizations();
        if (orgs.length === 0) {
          console.log('No organizations found. Add one with: npm run org:add');
          process.exit(1);
        }
        if (orgs.length === 1) {
          orgId = orgs[0].id;
          console.log(`Using organization: ${orgs[0].name} (ID: ${orgId})`);
        } else {
          console.log('Multiple organizations found. Specify with --org-id:');
          orgs.forEach(org => {
            console.log(`  ${org.id}: ${org.name} (Classy ID: ${org.classy_id})`);
          });
          process.exit(1);
        }
      }
      
      // Parse since date if provided
      let sinceDate = null;
      if (argv.since) {
        sinceDate = new Date(argv.since);
        if (isNaN(sinceDate.getTime())) {
          throw new Error('Invalid date format. Use YYYY-MM-DD');
        }
      }
      
      // Prepare sync options
      const syncOptions = {
        syncType: argv.type,
        limit: argv.limit,
        updatedSince: sinceDate,
        recalculateStats: argv.recalculateStats,
        dryRun: argv.dryRun
      };
      
      if (argv.entity === 'all') {
        await handleSyncAll(orgId, syncOptions);
      } else {
        await handleSyncEntity(argv.entity, orgId, syncOptions);
      }
      
      await database.close();
      process.exit(0);
    } catch (error) {
      logger.error('Sync command failed', error);
      process.exit(1);
    }
  }
});

// MailChimp plugin commands (Phase 3)
cli.command({
  command: 'mailchimp <action>',
  describe: 'MailChimp integration for donor segmentation and email marketing',
  builder: (yargs) => {
    return yargs
      .positional('action', {
        describe: 'MailChimp action to perform',
        choices: ['sync', 'test', 'status', 'health']
      })
      .option('org-id', {
        alias: 'o',
        type: 'number',
        describe: 'Organization ID to sync'
      })
      .option('limit', {
        alias: 'l',
        type: 'number',
        describe: 'Maximum supporters to sync'
      })
      .option('batch-size', {
        alias: 'b',
        type: 'number',
        default: 50,
        describe: 'Supporters per batch'
      })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        describe: 'Show what would be synced without making changes'
      })
      .option('wait-completion', {
        type: 'boolean',
        default: false,
        describe: 'Wait for MailChimp batch processing to complete'
      });
  },
  handler: async (argv) => {
    try {
      await database.initialize();
      
      switch (argv.action) {
        case 'sync':
          await handleMailChimpSync(argv);
          break;
          
        case 'test':
          await handleMailChimpTest(argv);
          break;
          
        case 'status':
          await handleMailChimpStatus(argv);
          break;
          
        case 'health':
          await handleMailChimpHealth(argv);
          break;
      }
      
      await database.close();
      process.exit(0);
    } catch (error) {
      logger.error('MailChimp command failed', error);
      process.exit(1);
    }
  }
});

// Health monitoring commands
cli.command({
  command: 'health [component]',
  describe: 'System health monitoring commands',
  builder: (yargs) => {
    return yargs
      .positional('component', {
        describe: 'Specific component to check (optional)',
        type: 'string'
      })
      .option('detailed', {
        alias: 'd',
        type: 'boolean',
        describe: 'Show detailed health report',
        default: false
      })
      .option('watch', {
        alias: 'w',
        type: 'boolean', 
        describe: 'Continuously monitor health',
        default: false
      })
      .option('interval', {
        alias: 'i',
        type: 'number',
        describe: 'Watch interval in seconds',
        default: 30
      });
  },
  handler: async (argv) => {
    try {
      await handleHealthCheck(argv);
    } catch (error) {
      logger.error('Health check failed', { error: error.message });
      process.exit(1);
    }
  }
});

cli.command({
  command: 'status',
  describe: 'Quick system status overview',
  builder: (yargs) => {
    return yargs
      .option('json', {
        alias: 'j',
        type: 'boolean',
        describe: 'Output as JSON',
        default: false
      });
  },
  handler: async (argv) => {
    try {
      await handleSystemStatus(argv);
    } catch (error) {
      logger.error('Status check failed', { error: error.message });
      process.exit(1);
    }
  }
});

// Handle unknown commands
cli.command({
  command: '*',
  handler: () => {
    logger.error('Unknown command. Use --help for available commands.');
    process.exit(1);
  }
});

// Organization management handlers
async function handleAddOrganization(argv) {
  // Interactive mode if no arguments provided
  if (!argv.name || !argv.classyId || !argv.clientId || !argv.clientSecret) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const prompt = (question) => new Promise((resolve) => {
      rl.question(question, resolve);
    });
    
    try {
      logger.info('🏢 Adding new organization with encrypted Classy credentials');
      logger.info('   Credentials will be stored securely in the database\n');
      
      const name = argv.name || await prompt('Organization name: ');
      const classyId = argv.classyId || parseInt(await prompt('Classy organization ID: '));
      const clientId = argv.clientId || await prompt('Classy API client ID: ');
      const clientSecret = argv.clientSecret || await prompt('Classy API client secret: ');
      
      rl.close();
      
      const organization = await organizationManager.createOrganization({
        name,
        classyId,
        credentials: {
          clientId,
          clientSecret
        }
      });
      
      logger.info('✅ Organization added successfully', {
        id: organization.id,
        name: organization.name,
        classyId: organization.classy_id
      });
      
    } catch (error) {
      rl.close();
      throw error;
    }
  } else {
    const organization = await organizationManager.createOrganization({
      name: argv.name,
      classyId: argv.classyId,
      credentials: {
        clientId: argv.clientId,
        clientSecret: argv.clientSecret
      }
    });
    
    logger.info('✅ Organization added successfully', {
      id: organization.id,
      name: organization.name,
      classyId: organization.classy_id
    });
  }
}

async function handleListOrganizations(argv) {
  const organizations = await organizationManager.listOrganizations();
  
  if (organizations.length === 0) {
    console.log('No organizations found. Use "npm run org:add" to add one.');
    return;
  }
  
  console.log(`Found ${organizations.length} organization(s):`);
  
  organizations.forEach((org, index) => {
    console.log(`${index + 1}. ${org.name} (ID: ${org.id}, Classy ID: ${org.classy_id}, Status: ${org.status})`);
  });
}

async function handleShowOrganization(argv) {
  if (!argv.id) {
    throw new Error('Organization ID required. Use --id <id>');
  }
  
  const organization = await organizationManager.getOrganization(argv.id);
  const hasCredentials = await organizationManager.testCredentials(argv.id);
  
  console.log('Organization details:');
  console.log(`  ID: ${organization.id}`);
  console.log(`  Name: ${organization.name}`);
  console.log(`  Classy ID: ${organization.classy_id}`);
  console.log(`  Status: ${organization.status}`);
  console.log(`  Has Valid Credentials: ${hasCredentials ? 'Yes' : 'No'}`);
  console.log(`  Created: ${organization.created_at}`);
  console.log(`  Updated: ${organization.updated_at}`);
}

async function handleUpdateOrganization(argv) {
  if (!argv.id) {
    throw new Error('Organization ID required. Use --id <id>');
  }
  
  if (argv.status) {
    const organization = await organizationManager.updateStatus(argv.id, argv.status);
    logger.info('✅ Organization status updated', {
      id: organization.id,
      name: organization.name,
      status: organization.status
    });
  }
  
  if (argv.clientId && argv.clientSecret) {
    const organization = await organizationManager.updateCredentials(argv.id, {
      clientId: argv.clientId,
      clientSecret: argv.clientSecret
    });
    logger.info('✅ Organization credentials updated', {
      id: organization.id,
      name: organization.name
    });
  }
}

async function handleDeleteOrganization(argv) {
  if (!argv.id) {
    throw new Error('Organization ID required. Use --id <id>');
  }
  
  const organization = await organizationManager.deleteOrganization(argv.id);
  logger.info('✅ Organization deactivated', {
    id: organization.id,
    name: organization.name,
    status: organization.status
  });
}

async function handleTestCredentials(argv) {
  if (!argv.id) {
    throw new Error('Organization ID required. Use --id <id>');
  }
  
  logger.info('Testing encrypted credentials...');
  
  // Test encryption/decryption
  const encryptionTest = encryption.testEncryption();
  logger.info(`Encryption system: ${encryptionTest ? '✅ Working' : '❌ Failed'}`);
  
  // Test credentials retrieval
  const credentialsValid = await organizationManager.testCredentials(argv.id);
  logger.info(`Credentials retrieval: ${credentialsValid ? '✅ Valid' : '❌ Invalid'}`);
  
  if (credentialsValid) {
    const credentials = await organizationManager.getClassyCredentials(argv.id);
    logger.info('Credential details:', {
      hasClientId: !!credentials.clientId,
      hasClientSecret: !!credentials.clientSecret,
      organizationId: credentials.organizationId,
      createdAt: credentials.createdAt
    });
  }
}

// Sync handler functions
async function handleSyncEntity(entityName, orgId, options) {
  const { syncType, dryRun } = options;
  
  console.log(`🔄 Starting ${syncType} sync for ${entityName}...`);
  
  if (dryRun) {
    console.log('🏃 DRY RUN - No changes will be made');
  }
  
  try {
    // Get organization details
    const org = await organizationManager.getOrganization(orgId);
    console.log(`Organization: ${org.name} (Classy ID: ${org.classy_id})`);
    
    // Get sync class
    const syncClass = getSyncClass(entityName);
    if (!syncClass) {
      throw new Error(`Unknown entity: ${entityName}`);
    }
    
    if (dryRun) {
      // For dry run, just test API connectivity
      const health = await syncClass.healthCheck(orgId);
      console.log('API Health:', health.api?.status || 'unknown');
      console.log('Current records:', health.database?.recordCount || 0);
      console.log('Would sync from Classy API...');
      return;
    }
    
    // Perform actual sync
    let results;
    if (entityName === 'supporters' || entityName === 'transactions' || entityName === 'recurring-plans') {
      // Use special sync method with automatic stats recalculation
      results = await syncClass.sync(orgId, org.classy_id, options);
    } else {
      // Use standard sync methods
      if (syncType === 'full') {
        results = await syncClass.fullSync(orgId, org.classy_id, options);
      } else {
        results = await syncClass.incrementalSync(orgId, org.classy_id, options);
      }
    }
    
    // Display results
    console.log(`\n✅ ${entityName} sync completed:`);
    console.log(`   Type: ${results.type}`);
    console.log(`   Total processed: ${results.totalProcessed}`);
    console.log(`   Successful: ${results.successful}`);
    console.log(`   Errors: ${results.errors}`);
    console.log(`   Duration: ${(results.duration / 1000).toFixed(1)}s`);
    
    if (results.lastSyncTime) {
      console.log(`   Last sync time: ${results.lastSyncTime.toISOString()}`);
    }
    
    if (results.lifetimeStats) {
      if (entityName === 'supporters') {
        console.log(`   Lifetime stats: ${results.lifetimeStats.supportersUpdated} supporters updated`);
        console.log(`   Total lifetime value: $${results.lifetimeStats.totalLifetimeAmount.toFixed(2)}`);
      } else if (entityName === 'transactions') {
        console.log(`   Lifetime stats: ${results.lifetimeStats.affectedSupporters} supporters updated`);
        console.log(`   Total lifetime value: $${results.lifetimeStats.totalLifetimeAmount.toFixed(2)}`);
      }
    }
    
    if (results.recurringStats) {
      console.log(`   Recurring stats: ${results.recurringStats.affectedSupporters} supporters updated`);
      if (results.recurringStats.totalMonthlyRecurring !== undefined) {
        console.log(`   Total monthly recurring: $${results.recurringStats.totalMonthlyRecurring.toFixed(2)}`);
      }
    }
    
  } catch (error) {
    console.error(`❌ ${entityName} sync failed:`, error.message);
    throw error;
  }
}

async function handleSyncAll(orgId, options) {
  const entities = ['campaigns', 'supporters', 'transactions', 'recurring-plans'];
  const { syncType } = options;
  
  console.log(`🔄 Starting ${syncType} sync for all entities...`);
  
  const results = {
    successful: [],
    failed: [],
    totalDuration: 0
  };
  
  for (const entity of entities) {
    try {
      console.log(`\n📊 Syncing ${entity}...`);
      const startTime = Date.now();
      
      await handleSyncEntity(entity, orgId, { ...options, entity });
      
      const duration = Date.now() - startTime;
      results.successful.push({ entity, duration });
      results.totalDuration += duration;
      
    } catch (error) {
      results.failed.push({ entity, error: error.message });
      console.error(`Failed to sync ${entity}:`, error.message);
      // Continue with other entities
    }
  }
  
  // Summary
  console.log(`\n🎉 Sync all completed:`);
  console.log(`   Successful entities: ${results.successful.length}`);
  console.log(`   Failed entities: ${results.failed.length}`);
  console.log(`   Total duration: ${(results.totalDuration / 1000).toFixed(1)}s`);
  
  if (results.failed.length > 0) {
    console.log(`\n❌ Failed entities:`);
    results.failed.forEach(fail => {
      console.log(`   - ${fail.entity}: ${fail.error}`);
    });
  }
}

function getSyncClass(entityName) {
  const syncClasses = {
    'supporters': supportersSync,
    'transactions': transactionsSync,
    'campaigns': campaignsSync,
    'recurring-plans': recurringPlansSync
  };
  
  return syncClasses[entityName];
}

// MailChimp plugin handlers
async function handleMailChimpSync(argv) {
  const { PluginManager } = require('./core/plugin-manager');
  
  // Get organization to sync
  let orgId = argv.orgId;
  if (!orgId) {
    const orgs = await organizationManager.listOrganizations();
    if (orgs.length === 0) {
      console.log('No organizations found. Add one with: npm run org:add');
      process.exit(1);
    }
    if (orgs.length === 1) {
      orgId = orgs[0].id;
      console.log(`Using organization: ${orgs[0].name} (ID: ${orgId})`);
    } else {
      console.log('Multiple organizations found. Specify with --org-id:');
      orgs.forEach(org => {
        console.log(`  ${org.id}: ${org.name} (Classy ID: ${org.classy_id})`);
      });
      process.exit(1);
    }
  }

  // Check for MailChimp configuration
  if (!process.env.MAILCHIMP_API_KEY || !process.env.MAILCHIMP_LIST_ID) {
    console.error('❌ MailChimp not configured. Set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID environment variables.');
    process.exit(1);
  }

  console.log(`📧 Starting MailChimp sync...`);
  
  if (argv.dryRun) {
    console.log('🏃 DRY RUN - No changes will be made');
  }

  try {
    // Create and configure plugin manager
    const manager = await PluginManager.createDefault({
      mailchimp: {
        apiKey: process.env.MAILCHIMP_API_KEY,
        listId: process.env.MAILCHIMP_LIST_ID,
        batchSize: argv.batchSize,
        tagPrefix: 'Classy-',
        waitForBatchCompletion: argv.waitCompletion
      }
    });

    // Initialize plugins
    const initResults = await manager.initializeAll();
    if (initResults.failed.length > 0) {
      console.error(`Failed to initialize plugins: ${initResults.failed.map(f => f.name).join(', ')}`);
      process.exit(1);
    }

    const org = await organizationManager.getOrganization(orgId);
    console.log(`Organization: ${org.name} (Classy ID: ${org.classy_id})`);

    if (argv.dryRun) {
      // For dry run, show what would be synced (CONSENT COMPLIANT)
      const supporters = await database.getKnex()('supporters')
        .where('organization_id', orgId)
        .whereNotNull('email_address')
        .where('email_address', '!=', '')
        .where('email_opt_in', true) // CRITICAL: Only show opted-in supporters
        .limit(argv.limit || 10);

      const totalWithEmails = await database.getKnex()('supporters')
        .where('organization_id', orgId)
        .whereNotNull('email_address')
        .where('email_address', '!=', '')
        .count('* as count')
        .first();

      console.log(`Would sync ${supporters.length} supporters to MailChimp (with email consent)`);
      console.log(`Total supporters with emails: ${totalWithEmails.count}`);
      console.log(`Supporters with email consent: ${supporters.length}`);
      console.log(`Consent rate: ${((supporters.length / totalWithEmails.count) * 100).toFixed(1)}%`);
      console.log('\nSample opted-in supporter data:');
      
      supporters.slice(0, 3).forEach((supporter, index) => {
        console.log(`  ${index + 1}. ${supporter.first_name} ${supporter.last_name} (${supporter.email_address})`);
        console.log(`     Lifetime: $${supporter.lifetime_donation_amount || 0}, Count: ${supporter.lifetime_donation_count || 0}`);
        console.log(`     Monthly recurring: $${supporter.monthly_recurring_amount || 0}`);
        console.log(`     Email opt-in: ${supporter.email_opt_in ? '✅ YES' : '❌ NO'}`);
      });
      
      return;
    }

    // Perform actual sync
    const startTime = Date.now();
    const results = await manager.processWithPlugin('mailchimp', {
      type: 'supporters.full',
      organizationId: orgId
    }, {
      organizationId: orgId,
      limit: argv.limit,
      waitForCompletion: argv.waitCompletion
    });

    const duration = Date.now() - startTime;

    // Display results
    if (results.success) {
      console.log(`\n✅ MailChimp sync completed:`);
      console.log(`   Total supporters: ${results.totalSupporters || 0}`);
      console.log(`   With email addresses: ${results.supportersWithEmail || 0}`);
      console.log(`   Successfully synced: ${results.processed || 0}`);
      console.log(`   Errors: ${results.errors || 0}`);
      console.log(`   Skipped: ${results.skipped || 0}`);
      console.log(`   Batches: ${results.batches || 0}`);
      console.log(`   Duration: ${(duration / 1000).toFixed(1)}s`);
    } else {
      console.error(`❌ MailChimp sync failed: ${results.error}`);
    }

    // Cleanup
    await manager.shutdownAll();

  } catch (error) {
    console.error(`❌ MailChimp sync failed:`, error.message);
    throw error;
  }
}

async function handleMailChimpTest(argv) {
  const { PluginManager } = require('./core/plugin-manager');

  // Check for MailChimp configuration
  if (!process.env.MAILCHIMP_API_KEY || !process.env.MAILCHIMP_LIST_ID) {
    console.error('❌ MailChimp not configured. Set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID environment variables.');
    process.exit(1);
  }

  console.log('🧪 Testing MailChimp integration...');

  try {
    // Create and configure plugin manager
    const manager = await PluginManager.createDefault({
      mailchimp: {
        apiKey: process.env.MAILCHIMP_API_KEY,
        listId: process.env.MAILCHIMP_LIST_ID,
        batchSize: 50,
        tagPrefix: 'Classy-'
      }
    });

    // Initialize plugins
    console.log('Initializing MailChimp plugin...');
    const initResults = await manager.initializeAll();
    
    if (initResults.failed.length > 0) {
      console.error(`❌ Plugin initialization failed: ${initResults.failed.map(f => f.name).join(', ')}`);
      return;
    }

    // Get health status
    console.log('Checking MailChimp API connectivity...');
    const health = await manager.getHealthStatus();
    
    if (health.plugins.mailchimp?.status === 'healthy') {
      console.log('✅ MailChimp API connection successful');
      console.log(`   List: ${health.plugins.mailchimp.mailchimp.listName}`);
      console.log(`   Current members: ${health.plugins.mailchimp.mailchimp.memberCount}`);
      console.log(`   Datacenter: ${health.plugins.mailchimp.mailchimp.datacenter}`);
    } else {
      console.error('❌ MailChimp API connection failed');
      console.error(`   Error: ${health.plugins.mailchimp?.error || 'Unknown error'}`);
    }

    // Cleanup
    await manager.shutdownAll();

  } catch (error) {
    console.error(`❌ MailChimp test failed:`, error.message);
    throw error;
  }
}

async function handleMailChimpStatus(argv) {
  const { PluginManager } = require('./core/plugin-manager');

  if (!process.env.MAILCHIMP_API_KEY || !process.env.MAILCHIMP_LIST_ID) {
    console.log('MailChimp not configured');
    return;
  }

  try {
    const manager = await PluginManager.createDefault({
      mailchimp: {
        apiKey: process.env.MAILCHIMP_API_KEY,
        listId: process.env.MAILCHIMP_LIST_ID
      }
    });

    const status = manager.getStatus();
    
    console.log('MailChimp Plugin Status:');
    console.log(`  Manager initialized: ${status.manager.initialized}`);
    console.log(`  Plugin count: ${status.manager.pluginCount}`);
    
    if (status.plugins.mailchimp) {
      const plugin = status.plugins.mailchimp;
      console.log(`  MailChimp plugin: ${plugin.initialized ? 'Initialized' : 'Not initialized'}`);
      console.log(`  Health status: ${plugin.healthStatus || 'Unknown'}`);
      console.log(`  Configuration:`);
      console.log(`    API Key: ${plugin.config.apiKey ? '***' : 'Not set'}`);
      console.log(`    List ID: ${plugin.config.listId || 'Not set'}`);
      console.log(`    Batch size: ${plugin.config.batchSize || 50}`);
      console.log(`    Tag prefix: ${plugin.config.tagPrefix || 'Classy-'}`);
    }

  } catch (error) {
    console.error(`Failed to get MailChimp status:`, error.message);
  }
}

async function handleMailChimpHealth(argv) {
  const { PluginManager } = require('./core/plugin-manager');

  if (!process.env.MAILCHIMP_API_KEY || !process.env.MAILCHIMP_LIST_ID) {
    console.log('MailChimp not configured');
    return;
  }

  try {
    const manager = await PluginManager.createDefault({
      mailchimp: {
        apiKey: process.env.MAILCHIMP_API_KEY,
        listId: process.env.MAILCHIMP_LIST_ID
      }
    });

    await manager.initializeAll();
    const health = await manager.getHealthStatus();
    
    console.log('MailChimp Health Check:');
    console.log(`  Overall status: ${health.manager.status}`);
    
    if (health.plugins.mailchimp) {
      const mailchimp = health.plugins.mailchimp;
      console.log(`  MailChimp status: ${mailchimp.status}`);
      
      if (mailchimp.mailchimp) {
        console.log(`    API connected: ${mailchimp.mailchimp.apiConnected}`);
        console.log(`    List access: ${mailchimp.mailchimp.listAccess}`);
        console.log(`    List name: ${mailchimp.mailchimp.listName || 'Unknown'}`);
        console.log(`    Member count: ${mailchimp.mailchimp.memberCount || 0}`);
        console.log(`    Datacenter: ${mailchimp.mailchimp.datacenter || 'Unknown'}`);
      }
      
      if (mailchimp.error) {
        console.error(`    Error: ${mailchimp.error}`);
      }
    }

    await manager.shutdownAll();

  } catch (error) {
    console.error(`Health check failed:`, error.message);
  }
}

// Health monitoring handler functions
async function handleHealthCheck(argv) {
  const { healthMonitor } = require('./core/health-monitor');
  
  console.log('🏥 System Health Check');
  console.log('=====================');
  
  try {
    // Initialize standard components
    await healthMonitor.initializeStandardComponents();
    
    if (argv.component) {
      // Check specific component
      console.log(`Checking component: ${argv.component}\n`);
      
      const result = await healthMonitor.checkComponent(argv.component);
      displayComponentHealth(result, argv.detailed);
    } else {
      // Check all components
      if (argv.watch) {
        console.log(`Starting continuous monitoring (${argv.interval}s intervals)`);
        console.log('Press Ctrl+C to stop\n');
        
        // Initial check
        await performFullHealthCheck(healthMonitor, argv.detailed);
        
        // Start watching
        const intervalId = setInterval(async () => {
          console.clear();
          console.log('🏥 System Health Check - Live Monitoring');
          console.log('======================================');
          console.log(`Updated: ${new Date().toLocaleTimeString()}\n`);
          
          await performFullHealthCheck(healthMonitor, argv.detailed);
        }, argv.interval * 1000);
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
          clearInterval(intervalId);
          console.log('\n👋 Health monitoring stopped');
          process.exit(0);
        });
        
      } else {
        await performFullHealthCheck(healthMonitor, argv.detailed);
      }
    }
    
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    process.exit(1);
  }
}

async function performFullHealthCheck(healthMonitor, detailed) {
  const systemHealth = await healthMonitor.checkAllComponents({ parallel: true });
  
  // Overall status
  console.log(`🔍 Overall Status: ${getStatusIcon(systemHealth.status)} ${systemHealth.status.toUpperCase()}`);
  console.log(`⏱️  Check Duration: ${systemHealth.duration}ms`);
  console.log(`📊 Components: ${systemHealth.summary.healthy}/${systemHealth.summary.total} healthy\n`);
  
  // Component details
  systemHealth.components.forEach(component => {
    displayComponentHealth(component, detailed);
  });
  
  // Recommendations
  if (detailed && systemHealth.status !== 'healthy') {
    const report = await healthMonitor.generateHealthReport();
    if (report.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach(rec => {
        console.log(`   ${rec.type.toUpperCase()}: ${rec.message}`);
        console.log(`   Action: ${rec.action}\n`);
      });
    }
  }
}

function displayComponentHealth(component, detailed) {
  const icon = getStatusIcon(component.status);
  console.log(`${icon} ${component.component}: ${component.status.toUpperCase()}`);
  
  if (component.critical && component.status === 'error') {
    console.log('   ⚠️  CRITICAL COMPONENT');
  }
  
  if (component.duration) {
    console.log(`   Response time: ${component.duration}ms`);
  }
  
  if (detailed) {
    // Show additional details based on component type
    if (component.database) {
      console.log(`   Database: ${component.database}`);
      if (component.connections) {
        console.log(`   Connections: ${component.connections.used}/${component.connections.max} used`);
      }
    }
    
    if (component.listName) {
      console.log(`   List: ${component.listName}`);
      console.log(`   Members: ${component.memberCount?.toLocaleString() || 0}`);
      console.log(`   Datacenter: ${component.datacenter || 'Unknown'}`);
    }
    
    if (component.pluginCount !== undefined) {
      console.log(`   Plugins: ${component.pluginCount}`);
    }
  }
  
  if (component.error) {
    console.log(`   Error: ${component.error}`);
  }
  
  console.log('');
}

function getStatusIcon(status) {
  switch (status) {
    case 'healthy': return '✅';
    case 'degraded': return '⚠️';
    case 'critical': return '🔴';
    case 'error': return '❌';
    case 'disabled': return '⏸️';
    default: return '❓';
  }
}

async function handleSystemStatus(argv) {
  const { healthMonitor } = require('./core/health-monitor');
  
  try {
    // Initialize standard components
    await healthMonitor.initializeStandardComponents();
    
    // Get quick status
    const status = healthMonitor.getSystemStatus();
    
    if (argv.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    
    console.log('📊 System Status');
    console.log('===============');
    console.log(`Status: ${getStatusIcon(status.status)} ${status.status.toUpperCase()}`);
    
    if (status.lastCheck) {
      console.log(`Last Check: ${new Date(status.lastCheck).toLocaleString()}`);
    } else {
      console.log('Last Check: Never');
    }
    
    console.log(`Components: ${status.summary.healthy}/${status.summary.total} healthy`);
    
    if (status.summary.errors > 0) {
      console.log(`Errors: ${status.summary.errors} (${status.summary.criticalErrors} critical)`);
    }
    
    console.log('\nComponent Summary:');
    status.components.forEach(comp => {
      const icon = getStatusIcon(comp.status);
      const critical = comp.critical ? ' (CRITICAL)' : '';
      console.log(`  ${icon} ${comp.name}${critical}`);
    });
    
  } catch (error) {
    console.error('❌ Status check failed:', error.message);
    process.exit(1);
  }
}

// Parse and execute
cli.parse();