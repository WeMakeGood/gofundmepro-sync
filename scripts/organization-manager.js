#!/usr/bin/env node

require('dotenv').config();

const { getInstance: getKnexDatabase } = require('../src/core/knex-database');
const { getInstance: getEncryption } = require('../src/utils/encryption');
const logger = require('../src/utils/logger');
const readline = require('readline');

class OrganizationManager {
  constructor() {
    this.db = getKnexDatabase();
    this.encryption = getEncryption();
  }

  /**
   * Handle errors appropriately for CLI vs test environments
   * @param {Error} error - The error to handle
   * @param {string} message - Optional custom error message
   */
  handleError(error, message = null) {
    const errorMessage = message || error.message;
    console.error('💥', errorMessage);
    logger.error(errorMessage, error);
    
    // Don't exit during tests
    if (process.env.NODE_ENV === 'test') {
      throw error;
    } else {
      process.exit(1);
    }
  }

  async addOrganization(config) {
    console.log('🏢 Adding new organization...');
    
    try {
      await this.db.connect();
      
      // Validate encryption is working
      if (!this.encryption.validateEncryption()) {
        throw new Error('Encryption validation failed. Check ENCRYPTION_HASH in .env file.');
      }
      
      // Validate required fields
      this.validateOrganizationConfig(config);
      
      // Check if organization already exists
      const existing = await this.db.client('organizations')
        .where({ classy_id: config.classy_id })
        .first();
        
      if (existing) {
        throw new Error(`Organization with Classy ID ${config.classy_id} already exists`);
      }
      
      // Encrypt API credentials
      const encryptedCredentials = this.encryption.encryptCredentials({
        classy_client_id: config.classy_client_id,
        classy_client_secret: config.classy_client_secret,
        mailchimp_api_key: config.mailchimp_api_key,
        mailchimp_server_prefix: config.mailchimp_server_prefix,
        mailchimp_audience_id: config.mailchimp_audience_id
      });
      
      // Insert organization
      const [orgId] = await this.db.client('organizations').insert({
        classy_id: config.classy_id,
        name: config.name,
        status: config.status || 'active',
        description: config.description || null,
        website: config.website || null,
        custom_fields: JSON.stringify({
          api_credentials: encryptedCredentials,
          sync_settings: {
            auto_sync_enabled: config.auto_sync_enabled !== false,
            sync_interval_minutes: config.sync_interval_minutes || 60,
            mailchimp_sync_enabled: !!config.mailchimp_api_key
          }
        }),
        created_at: new Date(),
        updated_at: new Date()
      });
      
      // Create default donor segmentation config for this organization
      await this.createDefaultSegmentationConfig(orgId);
      
      console.log(`✅ Organization added successfully!`);
      console.log(`   ID: ${orgId}`);
      console.log(`   Name: ${config.name}`);
      console.log(`   Classy ID: ${config.classy_id}`);
      console.log(`   Status: ${config.status || 'active'}`);
      console.log(`   📊 Donor segmentation config created`);
      
      return orgId;
      
    } catch (error) {
      this.handleError(error, `Failed to add organization: ${error.message}`);
    }
  }

  async listOrganizations() {
    console.log('📋 Organizations:');
    console.log('================');
    
    try {
      await this.db.connect();
      
      const organizations = await this.db.client('organizations')
        .select('id', 'classy_id', 'name', 'status', 'description', 'created_at', 'last_sync_at')
        .orderBy('id');
      
      if (organizations.length === 0) {
        console.log('No organizations found.');
        return;
      }
      
      organizations.forEach(org => {
        console.log(`\n🏢 ${org.name} (ID: ${org.id})`);
        console.log(`   Classy ID: ${org.classy_id}`);
        console.log(`   Status: ${org.status}`);
        if (org.description) {
          console.log(`   Description: ${org.description}`);
        }
        console.log(`   Created: ${org.created_at}`);
        console.log(`   Last Sync: ${org.last_sync_at || 'Never'}`);
      });
      
    } catch (error) {
      this.handleError(error, `Failed to list organizations: ${error.message}`);
    }
  }

  async getOrganization(orgId) {
    try {
      await this.db.connect();
      
      const org = await this.db.client('organizations')
        .where({ id: orgId })
        .first();
        
      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }
      
      // Parse and decrypt credentials if they exist
      let api_config;
      let sync_settings;
      
      if (org.custom_fields) {
        try {
          const customFields = JSON.parse(org.custom_fields);
          
          if (customFields.api_credentials) {
            const decryptedCredentials = this.encryption.decryptCredentials(customFields.api_credentials);
            api_config = {
              has_classy_credentials: !!(decryptedCredentials.classy_client_id && decryptedCredentials.classy_client_secret),
              has_mailchimp_credentials: !!(decryptedCredentials.mailchimp_api_key && decryptedCredentials.mailchimp_server_prefix)
            };
          }
          
          sync_settings = customFields.sync_settings || {
            auto_sync_enabled: true,
            sync_interval_minutes: 60,
            mailchimp_sync_enabled: false
          };
          
        } catch (parseError) {
          logger.warn('Failed to parse organization custom fields:', parseError);
        }
      }
      
      return {
        ...org,
        api_config,
        sync_settings
      };
      
    } catch (error) {
      this.handleError(error, `Failed to get organization: ${error.message}`);
    }
  }

  async syncOrganization(orgId, options = {}) {
    console.log(`🔄 Starting sync for organization ID: ${orgId}`);
    if (options.dry_run) {
      console.log('🧪 DRY RUN MODE - No data will be modified');
    }
    if (options.limit) {
      console.log(`📊 LIMIT: ${options.limit} records per entity type`);
    }
    
    try {
      await this.db.connect();
      
      // Get organization and credentials
      const org = await this.db.client('organizations')
        .where({ id: orgId })
        .first();
        
      if (!org) {
        throw new Error(`Organization with ID ${orgId} not found`);
      }
      
      console.log(`📋 Syncing: ${org.name} (Classy ID: ${org.classy_id})`);
      
      // Parse and decrypt credentials
      const customFields = JSON.parse(org.custom_fields || '{}');
      const credentials = this.encryption.decryptCredentials(customFields.api_credentials || {});
      
      // Validate required credentials
      if (!credentials.classy_client_id || !credentials.classy_client_secret) {
        throw new Error('Missing Classy API credentials for this organization');
      }
      
      // Store original environment variables
      const originalEnv = {
        CLASSY_CLIENT_ID: process.env.CLASSY_CLIENT_ID,
        CLASSY_CLIENT_SECRET: process.env.CLASSY_CLIENT_SECRET,
        CLASSY_ORGANIZATION_ID: process.env.CLASSY_ORGANIZATION_ID,
        MAILCHIMP_API_KEY: process.env.MAILCHIMP_API_KEY,
        MAILCHIMP_SERVER_PREFIX: process.env.MAILCHIMP_SERVER_PREFIX,
        MAILCHIMP_AUDIENCE_ID: process.env.MAILCHIMP_AUDIENCE_ID
      };
      
      try {
        // Set environment variables for this sync
        process.env.CLASSY_CLIENT_ID = credentials.classy_client_id;
        process.env.CLASSY_CLIENT_SECRET = credentials.classy_client_secret;
        process.env.CLASSY_ORGANIZATION_ID = org.classy_id;
        
        if (credentials.mailchimp_api_key) {
          process.env.MAILCHIMP_API_KEY = credentials.mailchimp_api_key;
          process.env.MAILCHIMP_SERVER_PREFIX = credentials.mailchimp_server_prefix;
          process.env.MAILCHIMP_AUDIENCE_ID = credentials.mailchimp_audience_id;
        }
        
        // Initialize sync engine with organization context
        const SyncEngine = require('../src/core/sync-engine');
        const syncEngine = new SyncEngine({ organizationId: orgId });
        await syncEngine.initialize();
        
        // Check if this is the first sync
        const lastSync = org.last_sync_at;
        const isFirstSync = !lastSync || lastSync === null;
        
        // Prepare sync parameters with CLI options
        const syncParams = {
          ...options,
          syncType: (isFirstSync || options.full) ? 'full' : 'incremental'
        };
        
        if (isFirstSync && !options.full) {
          console.log('   🆕 First sync detected - running full sync for all entities');
        } else if (options.full) {
          console.log('   🔄 Running full sync (forced)');
        } else {
          console.log('   🔄 Running incremental sync');
        }
        
        // Run sync with options
        const results = await syncEngine.syncAll(syncParams);
        
        // Don't update last sync time in dry run mode
        if (!options.dry_run) {
          await this.db.client('organizations')
            .where({ id: orgId })
            .update({ 
              last_sync_at: new Date(),
              updated_at: new Date() 
            });
        }
        
        // Display results summary
        this.displaySyncResults(results);
        
        console.log(`✅ Sync completed for organization ${org.name}`);
        
      } finally {
        // Restore original environment variables
        for (const [key, originalValue] of Object.entries(originalEnv)) {
          if (originalValue === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = originalValue;
          }
        }
      }
      
    } catch (error) {
      this.handleError(error, `Sync failed for organization ${orgId}: ${error.message}`);
    }
  }

  /**
   * Parse CLI sync options
   * @param {string[]} args - CLI arguments array
   * @returns {Object} Parsed options
   */
  parseSyncOptions(args) {
    const options = {};
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      switch (arg) {
        case '--dry-run':
          options.dry_run = true;
          break;
        case '--limit':
          const limitValue = parseInt(args[i + 1]);
          if (isNaN(limitValue) || limitValue <= 0) {
            throw new Error('--limit must be followed by a positive number');
          }
          options.limit = limitValue;
          i++; // Skip the next argument since we consumed it
          break;
        case '--full':
          options.full = true;
          break;
        case '--incremental':
          options.incremental = true;
          break;
        case '--verbose':
          options.verbose = true;
          break;
        default:
          console.warn(`⚠️  Unknown option: ${arg}`);
          break;
      }
    }
    
    // Validate conflicting options
    if (options.full && options.incremental) {
      throw new Error('Cannot specify both --full and --incremental');
    }
    
    return options;
  }

  /**
   * Display sync results summary
   * @param {Object} results - Sync results from sync engine
   */
  displaySyncResults(results) {
    console.log('\n📊 Sync Results Summary:');
    console.log('========================');
    
    let totalRecords = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    
    for (const [entityType, result] of Object.entries(results)) {
      if (result.error) {
        console.log(`❌ ${entityType}: ERROR - ${result.error}`);
      } else if (result.skipped) {
        console.log(`⏭️  ${entityType}: SKIPPED - ${result.reason}`);
      } else if (result.dryRun) {
        console.log(`🧪 ${entityType}: DRY RUN - ${result.message}`);
        totalRecords += result.totalRecords || 0;
      } else {
        console.log(`✅ ${entityType}: ${result.successfulRecords || 0} successful, ${result.failedRecords || 0} failed (${result.totalRecords || 0} total)`);
        totalRecords += result.totalRecords || 0;
        totalSuccessful += result.successfulRecords || 0;
        totalFailed += result.failedRecords || 0;
      }
    }
    
    console.log('------------------------');
    console.log(`📊 TOTAL: ${totalSuccessful} successful, ${totalFailed} failed (${totalRecords} total)`);
    
    if (totalFailed > 0) {
      console.log('⚠️  Some records failed to sync. Check logs for details.');
    }
  }

  /**
   * Create default donor segmentation configuration for a new organization
   * @param {number} organizationId - The local organization ID
   */
  async createDefaultSegmentationConfig(organizationId) {
    try {
      // Insert donor value tiers (matching actual database schema)
      await this.db.client('donor_segmentation_config').insert([
        {
          organization_id: organizationId,
          segment_type: 'donor_value',
          segment_name: 'Prospect',
          min_amount: 0,
          max_amount: 0,
          sort_order: 1
        },
        {
          organization_id: organizationId,
          segment_type: 'donor_value',
          segment_name: 'First-Time',
          min_amount: 0.01,
          max_amount: 24.99,
          sort_order: 2
        },
        {
          organization_id: organizationId,
          segment_type: 'donor_value',
          segment_name: 'Small Donor',
          min_amount: 25,
          max_amount: 99.99,
          sort_order: 3
        },
        {
          organization_id: organizationId,
          segment_type: 'donor_value',
          segment_name: 'Regular Donor',
          min_amount: 100,
          max_amount: 499.99,
          sort_order: 4
        },
        {
          organization_id: organizationId,
          segment_type: 'donor_value',
          segment_name: 'Committed Donor',
          min_amount: 500,
          max_amount: 999.99,
          sort_order: 5
        },
        {
          organization_id: organizationId,
          segment_type: 'donor_value',
          segment_name: 'Major Donor',
          min_amount: 1000,
          max_amount: 4999.99,
          sort_order: 6
        },
        {
          organization_id: organizationId,
          segment_type: 'donor_value',
          segment_name: 'Principal Donor',
          min_amount: 5000,
          max_amount: 9999.99,
          sort_order: 7
        },
        {
          organization_id: organizationId,
          segment_type: 'donor_value',
          segment_name: 'Transformational',
          min_amount: 10000,
          max_amount: null,
          sort_order: 8
        }
      ]);
      
      logger.info('Created default donor segmentation config', { organizationId });
      console.log('   📊 Donor segmentation config created (8 value tiers)');
    } catch (error) {
      logger.error('Failed to create default segmentation config:', error);
      throw error;
    }
  }

  validateOrganizationConfig(config) {
    const required = ['name', 'classy_id', 'classy_client_id', 'classy_client_secret'];
    const missing = required.filter(field => !config[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }
    
    if (isNaN(parseInt(config.classy_id))) {
      throw new Error('classy_id must be a valid number');
    }
  }

  async close() {
    await this.db.close();
  }

  /**
   * Interactive wizard for adding organizations
   */
  async interactiveAddOrganization() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (prompt) => {
      return new Promise((resolve) => {
        rl.question(prompt, resolve);
      });
    };

    try {
      console.log('🏢 Interactive Organization Setup Wizard');
      console.log('==========================================');
      console.log('This wizard will help you add a new organization to the sync system.');
      console.log('You\'ll need your Classy API credentials and optionally MailChimp credentials.\n');

      // Required fields
      const name = await question('📝 Organization Name: ');
      if (!name.trim()) {
        throw new Error('Organization name is required');
      }

      const classyIdInput = await question('🆔 Classy Organization ID: ');
      const classy_id = parseInt(classyIdInput);
      if (isNaN(classy_id) || classy_id <= 0) {
        throw new Error('Valid Classy Organization ID (number) is required');
      }

      console.log('\n🔑 Classy API Credentials (Required)');
      console.log('You can find these in your Classy account under API settings.');
      
      const classy_client_id = await question('   Client ID: ');
      if (!classy_client_id.trim()) {
        throw new Error('Classy Client ID is required');
      }

      const classy_client_secret = await question('   Client Secret: ');
      if (!classy_client_secret.trim()) {
        throw new Error('Classy Client Secret is required');
      }

      // Optional MailChimp fields
      console.log('\n📧 MailChimp Integration (Optional)');
      console.log('Leave blank to skip MailChimp integration for now.');
      
      const mailchimp_api_key = await question('   MailChimp API Key (optional): ');
      let mailchimp_server_prefix = '';
      let mailchimp_audience_id = '';

      if (mailchimp_api_key.trim()) {
        mailchimp_server_prefix = await question('   MailChimp Server Prefix (e.g., us15): ');
        mailchimp_audience_id = await question('   MailChimp Audience ID (optional): ');
      }

      // Optional organization details
      console.log('\n📋 Additional Details (Optional)');
      const description = await question('   Description: ');
      const website = await question('   Website URL: ');

      // Optional sync settings
      console.log('\n⚙️ Sync Settings');
      const autoSyncInput = await question('   Enable automatic sync? (y/N): ');
      const auto_sync_enabled = autoSyncInput.toLowerCase().startsWith('y');

      let sync_interval_minutes = 60;
      if (auto_sync_enabled) {
        const intervalInput = await question('   Sync interval in minutes (default: 60): ');
        const interval = parseInt(intervalInput);
        if (!isNaN(interval) && interval > 0) {
          sync_interval_minutes = interval;
        }
      }

      // Summary
      console.log('\n📋 Configuration Summary:');
      console.log('=========================');
      console.log(`Name: ${name}`);
      console.log(`Classy ID: ${classy_id}`);
      console.log(`Classy Credentials: ✅ Provided`);
      console.log(`MailChimp Integration: ${mailchimp_api_key.trim() ? '✅ Enabled' : '❌ Disabled'}`);
      if (description.trim()) console.log(`Description: ${description}`);
      if (website.trim()) console.log(`Website: ${website}`);
      console.log(`Auto Sync: ${auto_sync_enabled ? '✅ Enabled' : '❌ Disabled'}`);
      if (auto_sync_enabled) console.log(`Sync Interval: ${sync_interval_minutes} minutes`);

      const confirm = await question('\n✅ Create this organization? (Y/n): ');
      if (confirm.toLowerCase().startsWith('n')) {
        console.log('❌ Organization creation cancelled.');
        return;
      }

      // Create the organization
      const config = {
        name: name.trim(),
        classy_id,
        classy_client_id: classy_client_id.trim(),
        classy_client_secret: classy_client_secret.trim(),
        mailchimp_api_key: mailchimp_api_key.trim() || undefined,
        mailchimp_server_prefix: mailchimp_server_prefix.trim() || undefined,
        mailchimp_audience_id: mailchimp_audience_id.trim() || undefined,
        description: description.trim() || undefined,
        website: website.trim() || undefined,
        auto_sync_enabled,
        sync_interval_minutes
      };

      console.log('\n🔄 Creating organization...');
      const orgId = await this.addOrganization(config);
      
      console.log('\n🎉 Organization created successfully!');
      console.log(`\nNext steps:`);
      console.log(`• View details: npm run org:show ${orgId}`);
      console.log(`• Start sync: npm run org:sync ${orgId}`);
      console.log(`• List all orgs: npm run org:list`);

    } catch (error) {
      if (process.env.NODE_ENV === 'test') {
        throw error;
      } else {
        console.error('\n💥 Setup failed:', error.message);
        process.exit(1);
      }
    } finally {
      rl.close();
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  const manager = new OrganizationManager();
  
  try {
    switch (command) {
      case 'add':
        // Check if command line arguments are provided
        if (args.length >= 4) {
          // Use command line mode
          console.log('🏢 Organization Setup (Command Line Mode)');
          console.log('==========================================');
          
          const config = {
            name: args[1],
            classy_id: parseInt(args[2]),
            classy_client_id: args[3],
            classy_client_secret: args[4],
            mailchimp_api_key: args[5],
            mailchimp_server_prefix: args[6],
            mailchimp_audience_id: args[7],
            description: args[8],
            website: args[9]
          };
          
          if (!config.classy_client_id || !config.classy_client_secret) {
            console.error('💥 Usage: npm run org:add <name> <classy_id> <client_id> <client_secret> [mailchimp_key] [server_prefix] [audience_id] [description] [website]');
            throw new Error('Missing required API credentials');
          }
          
          await manager.addOrganization(config);
        } else {
          // Use interactive mode
          await manager.interactiveAddOrganization();
        }
        break;
        
      case 'list':
        await manager.listOrganizations();
        break;
        
      case 'show':
        const showOrgId = parseInt(args[1]);
        if (!showOrgId) {
          throw new Error('Usage: npm run org:show <organization_id>');
        }
        
        const org = await manager.getOrganization(showOrgId);
        console.log('🏢 Organization Details:');
        console.log('========================');
        console.log(`ID: ${org.id}`);
        console.log(`Name: ${org.name}`);
        console.log(`Classy ID: ${org.classy_id}`);
        console.log(`Status: ${org.status}`);
        if (org.description) console.log(`Description: ${org.description}`);
        if (org.website) console.log(`Website: ${org.website}`);
        console.log(`Created: ${org.created_at}`);
        console.log(`Last Sync: ${org.last_sync_at || 'Never'}`);
        
        if (org.api_config) {
          console.log('\n🔑 API Configuration:');
          console.log(`Classy Credentials: ${org.api_config.has_classy_credentials ? '✅' : '❌'}`);
          console.log(`MailChimp Credentials: ${org.api_config.has_mailchimp_credentials ? '✅' : '❌'}`);
        }
        
        if (org.sync_settings) {
          console.log('\n⚙️ Sync Settings:');
          console.log(`Auto Sync: ${org.sync_settings.auto_sync_enabled ? '✅ Enabled' : '❌ Disabled'}`);
          console.log(`Sync Interval: ${org.sync_settings.sync_interval_minutes} minutes`);
          console.log(`MailChimp Sync: ${org.sync_settings.mailchimp_sync_enabled ? '✅ Enabled' : '❌ Disabled'}`);
        }
        break;
        
      case 'sync':
        const syncOrgId = parseInt(args[1]);
        if (!syncOrgId) {
          throw new Error('Usage: npm run org:sync <organization_id> [options]');
        }
        
        // Parse CLI options
        const syncOptions = manager.parseSyncOptions(args.slice(2));
        
        await manager.syncOrganization(syncOrgId, syncOptions);
        break;
        
      default:
        console.log('📖 Organization Manager Commands:');
        console.log('=================================');
        console.log('');
        console.log('🏢 Add Organization:');
        console.log('  npm run org:setup                            # Interactive wizard (recommended)');
        console.log('  npm run org:add                              # Interactive wizard (same as org:setup)');
        console.log('  npm run org:add <name> <classy_id> <client_id> <client_secret> [options...]  # Command line mode');
        console.log('');
        console.log('📋 Manage Organizations:');
        console.log('  npm run org:list                             # List all organizations');
        console.log('  npm run org:show <organization_id>           # Show organization details');
        console.log('  npm run org:sync <organization_id> [options] # Sync organization data');
        console.log('');
        console.log('🔄 Sync Options:');
        console.log('  --dry-run                                    # Show what would be synced without making changes');
        console.log('  --limit <number>                             # Limit records per entity type');
        console.log('  --full                                       # Force full sync');
        console.log('  --incremental                                # Force incremental sync');
        console.log('  --verbose                                    # Enable verbose logging');
        console.log('');
        console.log('💡 Tip: Use the interactive wizard for easy setup with guided prompts!');
        throw new Error('Unknown command');
    }
    
  } finally {
    await manager.close();
  }
}

// Export for testing
module.exports = OrganizationManager;

// Run CLI if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Command failed:', error.message);
    logger.error('Organization manager command failed:', error);
    process.exit(1);
  });
}