#!/usr/bin/env node

require('dotenv').config();

const SyncEngine = require('../src/core/sync-engine');
const logger = require('../src/utils/logger');

async function manualSync() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node manual-sync.js <entity_type> [sync_type] [options]');
    console.log('');
    console.log('Entity Types:');
    console.log('  supporters    - Sync supporter data');
    console.log('  transactions  - Sync transaction data');
    console.log('  recurring     - Sync recurring donation plans');
    console.log('  campaigns     - Sync campaign data');
    console.log('');
    console.log('Sync Types:');
    console.log('  incremental   - Sync only updated records (default)');
    console.log('  full         - Sync all records');
    console.log('  single       - Sync single entity by ID (requires --id option)');
    console.log('');
    console.log('Options:');
    console.log('  --id <id>           - Entity ID for single sync');
    console.log('  --campaign <id>     - Limit sync to specific campaign');
    console.log('  --org <id>          - Organization ID (auto-detected if not provided)');
    console.log('  --since <date>      - Sync records updated since date (YYYY-MM-DD)');
    console.log('  --batch-size <num>  - Number of records per batch');
    console.log('  --dry-run          - Show what would be synced without making changes');
    console.log('');
    console.log('Examples:');
    console.log('  node manual-sync.js supporters');
    console.log('  node manual-sync.js transactions full --campaign 12345');
    console.log('  node manual-sync.js supporters single --id 67890');
    console.log('  node manual-sync.js transactions --since 2024-01-01');
    process.exit(1);
  }

  const entityType = args[0];
  const syncType = args[1] || 'incremental';
  
  // Parse options
  const options = parseOptions(args.slice(2));
  
  try {
    const syncEngine = new SyncEngine();
    await syncEngine.initialize();
    
    // Auto-detect organization ID if not provided
    if (!options.organization_id) {
      try {
        const api = syncEngine.api;
        const orgs = await api.getAvailableOrganizations();
        if (orgs.data && orgs.data.length > 0) {
          options.organization_id = orgs.data[0].id;
          console.log(`Auto-detected organization ID: ${options.organization_id}`);
        }
      } catch (error) {
        console.warn('Could not auto-detect organization ID:', error.message);
      }
    }
    
    logger.info(`Starting manual ${syncType} sync for ${entityType}`, options);
    
    let result;
    
    switch (syncType) {
      case 'incremental':
        result = await syncEngine.runIncrementalSync(entityType, options);
        break;
        
      case 'full':
        result = await syncEngine.runFullSync(entityType, options);
        break;
        
      case 'single':
        if (!options.id) {
          throw new Error('Single sync requires --id option');
        }
        result = await syncEngine.syncSingleEntity(entityType, options.id);
        break;
        
      default:
        throw new Error(`Unknown sync type: ${syncType}`);
    }
    
    console.log('Sync completed successfully:');
    console.log(JSON.stringify(result, null, 2));
    
    await syncEngine.shutdown();
    process.exit(0);
    
  } catch (error) {
    logger.error('Manual sync failed:', error);
    console.error('Error:', error.message);
    process.exit(1);
  }
}

function parseOptions(args) {
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--id':
        options.id = args[++i];
        break;
        
      case '--campaign':
        options.campaign_ids = [args[++i]];
        break;
        
      case '--org':
      case '--organization':
        options.organization_id = parseInt(args[++i]);
        break;
        
      case '--since':
        options.updated_since = new Date(args[++i]);
        break;
        
      case '--batch-size':
        options.batch_size = parseInt(args[++i]);
        break;
        
      case '--dry-run':
        options.dryRun = true;
        break;
        
      default:
        if (arg.startsWith('--')) {
          console.warn(`Unknown option: ${arg}`);
        }
    }
  }
  
  return options;
}

if (require.main === module) {
  manualSync();
}