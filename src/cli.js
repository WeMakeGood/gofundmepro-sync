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

// Placeholder commands for future phases
cli.command({
  command: 'sync <entity>',
  describe: 'Sync data from Classy API (Phase 2)',
  handler: () => {
    logger.warn('Sync commands will be implemented in Phase 2');
  }
});

cli.command({
  command: 'mailchimp <action>',
  describe: 'MailChimp integration (Phase 3)',
  handler: () => {
    logger.warn('MailChimp commands will be implemented in Phase 3');
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

// Parse and execute
cli.parse();