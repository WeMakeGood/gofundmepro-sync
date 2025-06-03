/**
 * MailChimp Bulk Member Sync
 * 
 * Efficiently syncs all consented supporters from Classy to MailChimp in batches
 * with progress tracking and error handling.
 */

const { MailChimpClient } = require('../src/integrations/mailchimp-client');
const { database } = require('../src/config/database');
const { createLogger } = require('../src/utils/logger');

const logger = createLogger('mailchimp-bulk-sync');

class MailChimpBulkSync {
  constructor() {
    this.mailchimpClient = null;
    this.batchSize = 100;
    this.delayBetweenBatches = 1000; // 1 second delay
    this.results = {
      totalProcessed: 0,
      successful: 0,
      errors: 0,
      batches: 0,
      startTime: null,
      endTime: null,
      errorDetails: []
    };
  }

  /**
   * Run bulk sync of all consented supporters
   */
  async runBulkSync(options = {}) {
    const { dryRun = false, limit = null } = options;

    try {
      await database.initialize();
      
      console.log('🔄 Starting MailChimp bulk member sync...');
      console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE EXECUTION'}`);
      if (limit) console.log(`   Limit: ${limit} supporters`);
      console.log('');

      this.results.startTime = new Date();

      // Initialize MailChimp client
      await this.initializeMailChimpClient();

      // Get total count
      let query = database.getKnex()('supporters')
        .whereNotNull('email_address')
        .where('email_address', '!=', '')
        .where('email_opt_in', true);

      if (limit) {
        query = query.limit(limit);
      }

      const totalCount = await database.getKnex()('supporters')
        .whereNotNull('email_address')
        .where('email_address', '!=', '')
        .where('email_opt_in', true)
        .count('* as count').first();

      const actualLimit = limit || totalCount.count;
      console.log(`📊 Total consented supporters: ${totalCount.count.toLocaleString()}`);
      console.log(`📊 Will process: ${actualLimit.toLocaleString()}`);
      console.log(`📦 Batch size: ${this.batchSize}`);
      console.log(`⏱️  Estimated batches: ${Math.ceil(actualLimit / this.batchSize)}\n`);

      // Process in batches
      let offset = 0;
      let batchNumber = 1;

      while (offset < actualLimit) {
        const remainingCount = actualLimit - offset;
        const currentBatchSize = Math.min(this.batchSize, remainingCount);

        console.log(`🔄 Processing batch ${batchNumber}/${Math.ceil(actualLimit / this.batchSize)} (${currentBatchSize} supporters)`);

        // Get batch of supporters
        const supporters = await database.getKnex()('supporters')
          .whereNotNull('email_address')
          .where('email_address', '!=', '')
          .where('email_opt_in', true)
          .limit(currentBatchSize)
          .offset(offset)
          .select('*');

        if (supporters.length === 0) {
          console.log('   No more supporters to process');
          break;
        }

        // Process batch
        const batchResults = await this.processBatch(supporters, dryRun);
        
        // Update totals
        this.results.totalProcessed += batchResults.processed;
        this.results.successful += batchResults.successful;
        this.results.errors += batchResults.errors;
        this.results.batches++;

        // Progress update
        const progress = ((offset + supporters.length) / actualLimit * 100).toFixed(1);
        console.log(`   ✅ Batch completed: ${batchResults.successful}/${batchResults.processed} successful (${progress}% total progress)`);

        if (batchResults.errors > 0) {
          console.log(`   ⚠️  Errors in batch: ${batchResults.errors}`);
        }

        offset += supporters.length;
        batchNumber++;

        // Delay between batches to respect rate limits
        if (offset < actualLimit && !dryRun) {
          console.log(`   ⏸️  Waiting ${this.delayBetweenBatches}ms before next batch...`);
          await this.delay(this.delayBetweenBatches);
        }

        console.log('');
      }

      this.results.endTime = new Date();
      const duration = this.results.endTime - this.results.startTime;

      console.log('✅ Bulk sync completed!');
      this.printSummary(duration);

      await database.close();

    } catch (error) {
      logger.error('Bulk sync failed', { error: error.message });
      console.error('❌ Bulk sync failed:', error.message);
      process.exit(1);
    }
  }

  /**
   * Initialize MailChimp client
   */
  async initializeMailChimpClient() {
    if (!process.env.MAILCHIMP_API_KEY || !process.env.MAILCHIMP_LIST_ID) {
      throw new Error('MailChimp configuration missing. Set MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID.');
    }

    this.mailchimpClient = new MailChimpClient({
      apiKey: process.env.MAILCHIMP_API_KEY,
      listId: process.env.MAILCHIMP_LIST_ID,
      batchSize: this.batchSize
    });

    const health = await this.mailchimpClient.healthCheck();
    if (health.status !== 'healthy') {
      throw new Error(`MailChimp API health check failed: ${health.error}`);
    }

    console.log(`🔗 Connected to MailChimp list: ${health.listName}`);
    console.log(`📊 Current members: ${health.memberCount.toLocaleString()}\n`);
  }

  /**
   * Process a batch of supporters
   */
  async processBatch(supporters, dryRun) {
    const results = {
      processed: supporters.length,
      successful: 0,
      errors: 0
    };

    for (const supporter of supporters) {
      try {
        if (dryRun) {
          // Just validate data in dry run
          const memberData = this.buildMemberData(supporter);
          results.successful++;
        } else {
          // Sync to MailChimp
          const memberData = this.buildMemberData(supporter);
          await this.mailchimpClient.upsertMember(memberData);
          results.successful++;
        }
      } catch (error) {
        results.errors++;
        this.results.errorDetails.push({
          email: supporter.email_address,
          supporterId: supporter.id,
          error: error.message
        });
        
        logger.error('Member sync failed', {
          email: supporter.email_address,
          supporterId: supporter.id,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Build MailChimp member data from supporter
   */
  buildMemberData(supporter) {
    return {
      email: supporter.email_address,
      mergeFields: {
        FNAME: supporter.first_name || '',
        LNAME: supporter.last_name || '',
        TOTALAMT: parseFloat(supporter.lifetime_donation_amount || 0),
        DONCNT: parseInt(supporter.lifetime_donation_count || 0),
        RECAMT: parseFloat(supporter.monthly_recurring_amount || 0),
        ACTIVESUB: supporter.monthly_recurring_amount > 0 ? 'Yes' : 'No'
      },
      tags: this.generateTags(supporter)
    };
  }

  /**
   * Generate Classy tags for supporter
   */
  generateTags(supporter) {
    const tags = [];
    const lifetimeAmount = parseFloat(supporter.lifetime_donation_amount || 0);
    const donationCount = parseInt(supporter.lifetime_donation_count || 0);
    const monthlyRecurring = parseFloat(supporter.monthly_recurring_amount || 0);

    // Value tiers
    if (lifetimeAmount >= 10000) {
      tags.push('Classy-Transformational');
    } else if (lifetimeAmount >= 5000) {
      tags.push('Classy-Principal Donor');
    } else if (lifetimeAmount >= 1000) {
      tags.push('Classy-Major Donor');
    } else if (lifetimeAmount >= 100) {
      tags.push('Classy-Regular Donor');
    } else if (lifetimeAmount >= 25) {
      tags.push('Classy-Small Donor');
    } else if (lifetimeAmount > 0) {
      tags.push('Classy-First-Time');
    }

    // Frequency
    if (donationCount >= 26) {
      tags.push('Classy-Champion Donor');
    } else if (donationCount >= 11) {
      tags.push('Classy-Loyal Donor');
    } else if (donationCount >= 4) {
      tags.push('Classy-Regular Donor');
    } else if (donationCount >= 2) {
      tags.push('Classy-Repeat Donor');
    } else if (donationCount === 1) {
      tags.push('Classy-One-Time Donor');
    }

    // Recurring
    if (monthlyRecurring > 0) {
      tags.push('Classy-Monthly Recurring');
      if (monthlyRecurring >= 100) {
        tags.push('Classy-$100+ Monthly');
      }
    }

    // Special value tags
    if (lifetimeAmount >= 1000) {
      tags.push('Classy-$1K+ Lifetime');
    }
    if (lifetimeAmount >= 5000) {
      tags.push('Classy-$5K+ Lifetime');
    }

    return tags;
  }

  /**
   * Delay helper
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Print final summary
   */
  printSummary(duration) {
    const successRate = this.results.totalProcessed > 0 
      ? ((this.results.successful / this.results.totalProcessed) * 100).toFixed(1)
      : '0';

    console.log('\n' + '='.repeat(60));
    console.log('📊 MAILCHIMP BULK SYNC SUMMARY');
    console.log('='.repeat(60));
    
    console.log(`📈 Total Processed: ${this.results.totalProcessed.toLocaleString()}`);
    console.log(`✅ Successful: ${this.results.successful.toLocaleString()}`);
    console.log(`❌ Errors: ${this.results.errors.toLocaleString()}`);
    console.log(`📦 Batches: ${this.results.batches}`);
    console.log(`📈 Success Rate: ${successRate}%`);
    console.log(`⏱️  Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`🚀 Rate: ${(this.results.successful / (duration / 1000)).toFixed(1)} members/second`);

    if (this.results.errors > 0) {
      console.log('\n❌ ERROR SUMMARY:');
      const errorCounts = {};
      this.results.errorDetails.forEach(error => {
        const key = error.error.substring(0, 50);
        errorCounts[key] = (errorCounts[key] || 0) + 1;
      });
      
      Object.entries(errorCounts).forEach(([error, count]) => {
        console.log(`   ${count}x: ${error}...`);
      });
    }

    console.log('='.repeat(60));
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: true, // Default to dry run for safety
    limit: null
  };
  
  // Parse command line arguments
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--live':
        options.dryRun = false;
        break;
      case '--limit':
        options.limit = parseInt(args[++i]);
        break;
    }
  }
  
  console.log('MailChimp Bulk Member Sync');
  console.log('==========================');
  console.log('Flags: --dry-run (default), --live, --limit <number>');
  console.log('');
  
  const sync = new MailChimpBulkSync();
  await sync.runBulkSync(options);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Bulk sync failed:', error.message);
    process.exit(1);
  });
}

module.exports = { MailChimpBulkSync };