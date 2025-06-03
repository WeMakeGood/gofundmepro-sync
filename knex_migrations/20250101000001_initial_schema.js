/**
 * Initial Clean Database Schema with Classy IDs as Primary Keys
 * 
 * This creates a clean, unified database schema for Classy data synchronization
 * with third-party integration support.
 * 
 * Key Design Principles:
 * - Classy IDs as primary keys for efficient relationships
 * - Direct foreign key references using Classy IDs
 * - Multi-organization support with data isolation
 * - Comprehensive analytical views for donor segmentation
 * - Optimized for third-party tool integration (MailChimp, etc.)
 * 
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.transaction(async (trx) => {
    console.log('🏗️ Creating clean database schema with Classy IDs as primary keys...');
    
    // Drop all existing tables to start fresh (order matters for foreign keys)
    await trx.schema.dropTableIfExists('sync_jobs');
    await trx.schema.dropTableIfExists('fundraising_pages');
    await trx.schema.dropTableIfExists('fundraising_teams');
    await trx.schema.dropTableIfExists('transactions');
    await trx.schema.dropTableIfExists('recurring_plans');
    await trx.schema.dropTableIfExists('supporters');
    await trx.schema.dropTableIfExists('campaigns');
    await trx.schema.dropTableIfExists('donor_segmentation_config'); // Has foreign key to organizations
    await trx.schema.dropTableIfExists('organizations');
    
    // Also drop any leftover tables from previous migrations
    await trx.schema.dropTableIfExists('supporters_new');
    await trx.schema.dropTableIfExists('campaigns_new');
    await trx.schema.dropTableIfExists('recurring_plans_new');
    await trx.schema.dropTableIfExists('transactions_new');
    
    // Organizations table (still uses auto-increment since we control this)
    await trx.schema.createTable('organizations', function(table) {
      table.increments('id').primary();
      table.string('classy_id', 255).unique().notNullable();
      table.string('name', 255);
      table.string('status', 50);
      table.text('description');
      table.string('website', 255);
      table.text('custom_fields');
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      
      table.index('classy_id', 'idx_organizations_classy_id');
      table.index('status', 'idx_organizations_status');
    });

    // Supporters table (Classy supporter ID as primary key)
    await trx.schema.createTable('supporters', function(table) {
      table.bigInteger('id').primary(); // Classy supporter ID
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations');
      table.string('email_address', 255);
      table.string('first_name', 100);
      table.string('last_name', 100);
      table.string('phone', 50);
      table.string('address_line1', 255);
      table.string('address_line2', 255);
      table.string('city', 100);
      table.string('state', 50);
      table.string('postal_code', 20);
      table.string('country', 2);
      
      // Calculated donation statistics
      table.decimal('lifetime_donation_amount', 10, 2).defaultTo(0);
      table.integer('lifetime_donation_count').defaultTo(0);
      table.timestamp('first_donation_date').nullable();
      table.timestamp('last_donation_date').nullable();
      
      // Calculated recurring donation statistics
      table.decimal('monthly_recurring_amount', 10, 2).defaultTo(0);
      table.integer('active_recurring_plans').defaultTo(0);
      
      // Consent and communication fields
      table.boolean('email_opt_in').nullable();
      table.boolean('sms_opt_in').nullable();
      table.timestamp('last_email_consent_date').nullable();
      table.timestamp('last_sms_consent_date').nullable();
      table.timestamp('last_emailed_at').nullable();
      
      table.text('custom_fields');
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      table.string('sync_status', 50);
      
      table.index('email_address', 'idx_supporters_email');
      table.index(['organization_id', 'email_address'], 'idx_supporters_org_email');
      table.index(['sync_status', 'last_sync_at'], 'idx_supporters_sync_status');
      table.index('last_donation_date', 'idx_supporters_last_donation');
      table.index('organization_id', 'idx_supporters_organization');
    });

    // Campaigns table (Classy campaign ID as primary key)
    await trx.schema.createTable('campaigns', function(table) {
      table.bigInteger('id').primary(); // Classy campaign ID
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations');
      table.string('name', 255);
      table.string('status', 50);
      table.decimal('goal', 10, 2);
      table.decimal('total_raised', 10, 2);
      table.integer('donor_count');
      table.string('campaign_type', 50);
      table.timestamp('start_date').nullable();
      table.timestamp('end_date').nullable();
      table.text('custom_fields');
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      
      table.index('status', 'idx_campaigns_status');
      table.index('organization_id', 'idx_campaigns_organization');
    });

    // Recurring donation plans table (Classy recurring plan ID as primary key)
    await trx.schema.createTable('recurring_plans', function(table) {
      table.bigInteger('id').primary(); // Classy recurring plan ID
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations');
      table.bigInteger('supporter_id').notNullable(); // Direct reference to Classy supporter ID
      table.bigInteger('campaign_id').notNullable(); // Direct reference to Classy campaign ID
      table.string('status', 50);
      table.string('frequency', 50);
      table.decimal('amount', 10, 2);
      table.string('currency', 3);
      table.date('next_payment_date');
      table.timestamp('cancellation_date').nullable();
      table.text('cancellation_reason');
      table.decimal('lifetime_value', 10, 2);
      table.integer('payment_count');
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      
      table.index('status', 'idx_recurring_plans_status');
      table.index('next_payment_date', 'idx_recurring_plans_next_payment');
      table.index('supporter_id', 'idx_recurring_plans_supporter');
      table.index('campaign_id', 'idx_recurring_plans_campaign');
      table.index('organization_id', 'idx_recurring_plans_organization');
    });

    // Transactions table (Classy transaction ID as primary key)
    await trx.schema.createTable('transactions', function(table) {
      table.bigInteger('id').primary(); // Classy transaction ID
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations');
      table.bigInteger('supporter_id').nullable(); // Direct reference to Classy supporter ID
      table.bigInteger('campaign_id').nullable(); // Direct reference to Classy campaign ID
      table.bigInteger('recurring_plan_id').nullable(); // Direct reference to Classy recurring plan ID
      
      table.string('transaction_type', 50);
      table.string('status', 50);
      table.string('payment_method', 50);
      
      // Core amounts
      table.decimal('gross_amount', 10, 2);
      table.decimal('fee_amount', 10, 2);
      table.decimal('net_amount', 10, 2);
      table.string('currency', 3);
      
      // Multi-currency support
      table.string('raw_currency_code', 3);
      table.decimal('raw_total_gross_amount', 10, 2);
      table.decimal('raw_donation_gross_amount', 10, 2);
      table.string('charged_currency_code', 3);
      table.decimal('charged_total_gross_amount', 10, 2);
      table.decimal('charged_fees_amount', 10, 2);
      table.timestamp('charged_at').nullable();
      
      // Relationship fields
      table.bigInteger('fundraising_page_id').nullable();
      table.bigInteger('fundraising_team_id').nullable();
      table.bigInteger('designation_id').nullable();
      
      // Fee flags
      table.boolean('fee_on_top').defaultTo(false);
      table.boolean('is_donor_covered_fee').defaultTo(false);
      
      // Payment details
      table.string('payment_type', 50);
      table.string('card_type', 50);
      table.string('card_last_four', 4);
      
      table.timestamp('purchased_at').nullable();
      table.timestamp('refunded_at').nullable();
      table.text('custom_fields');
      table.text('question_responses');
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      
      table.index('supporter_id', 'idx_transactions_supporter');
      table.index('campaign_id', 'idx_transactions_campaign');
      table.index('purchased_at', 'idx_transactions_purchased_at');
      table.index('status', 'idx_transactions_status');
      table.index('transaction_type', 'idx_transactions_type');
      table.index('organization_id', 'idx_transactions_organization');
    });

    // Fundraising teams table (Classy team ID as primary key)
    await trx.schema.createTable('fundraising_teams', function(table) {
      table.bigInteger('id').primary(); // Classy team ID
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations');
      table.bigInteger('campaign_id').notNullable(); // Direct reference to Classy campaign ID
      table.string('name', 255);
      table.text('description');
      table.decimal('goal', 10, 2);
      table.decimal('total_raised', 10, 2);
      table.integer('member_count');
      table.string('status', 50);
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      
      table.index('campaign_id', 'idx_fundraising_teams_campaign');
      table.index('organization_id', 'idx_fundraising_teams_organization');
    });

    // Fundraising pages table (Classy page ID as primary key)
    await trx.schema.createTable('fundraising_pages', function(table) {
      table.bigInteger('id').primary(); // Classy page ID
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations');
      table.bigInteger('campaign_id').notNullable(); // Direct reference to Classy campaign ID
      table.bigInteger('team_id').nullable(); // Direct reference to Classy team ID
      table.bigInteger('supporter_id').notNullable(); // Direct reference to Classy supporter ID
      table.string('title', 255);
      table.decimal('goal', 10, 2);
      table.decimal('total_raised', 10, 2);
      table.string('status', 50);
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      
      table.index('campaign_id', 'idx_fundraising_pages_campaign');
      table.index('team_id', 'idx_fundraising_pages_team');
      table.index('supporter_id', 'idx_fundraising_pages_supporter');
      table.index('organization_id', 'idx_fundraising_pages_organization');
    });

    // Donor segmentation configuration table
    await trx.schema.createTable('donor_segmentation_config', function(table) {
      table.increments('id').primary();
      table.integer('organization_id').unsigned().notNullable().references('id').inTable('organizations');
      table.string('segment_type', 50); // 'value_tier', 'engagement_status', 'frequency_segment'
      table.string('segment_name', 100);
      table.decimal('min_amount', 10, 2).nullable();
      table.decimal('max_amount', 10, 2).nullable();
      table.integer('min_days').nullable();
      table.integer('max_days').nullable();
      table.integer('min_count').nullable();
      table.integer('max_count').nullable();
      table.integer('sort_order').defaultTo(0);
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      
      table.index(['organization_id', 'segment_type'], 'idx_donor_segmentation_org_type');
      table.index('is_active', 'idx_donor_segmentation_active');
    });

    // Sync jobs tracking table (keeps auto-increment for our internal tracking)
    await trx.schema.createTable('sync_jobs', function(table) {
      table.increments('id').primary();
      table.integer('organization_id').unsigned().nullable().references('id').inTable('organizations');
      table.string('job_type', 50);
      table.string('entity_type', 50);
      table.string('status', 50);
      table.timestamp('started_at').nullable();
      table.timestamp('completed_at').nullable();
      table.integer('records_processed');
      table.integer('records_failed');
      table.text('error_message');
      table.text('metadata');
      
      table.index(['status', 'started_at'], 'idx_sync_jobs_status');
      table.index('entity_type', 'idx_sync_jobs_entity_type');
      table.index('completed_at', 'idx_sync_jobs_completed');
      table.index('organization_id', 'idx_sync_jobs_organization');
    });

    // Create analytical views for reporting and donor segmentation
    const client = trx.client.config.client;
    
    // Different date functions for different databases
    const dateDiff = client === 'mysql2' || client === 'mysql' 
      ? 'DATEDIFF(NOW(), s.last_donation_date)'
      : "(julianday('now') - julianday(s.last_donation_date))";
      
    const now = client === 'mysql2' || client === 'mysql' ? 'NOW()' : "datetime('now')";

    // Campaign Performance View
    await trx.raw(`
      CREATE VIEW campaign_performance AS
      SELECT 
          c.id,
          c.id as classy_id,
          c.name,
          c.status,
          c.campaign_type,
          c.goal,
          c.start_date,
          c.end_date,
          COALESCE(SUM(CASE WHEN t.status = 'success' THEN t.gross_amount ELSE 0 END), 0) as actual_raised,
          COALESCE(COUNT(CASE WHEN t.status = 'success' THEN t.id END), 0) as successful_transactions,
          COALESCE(COUNT(DISTINCT CASE WHEN t.status = 'success' THEN t.supporter_id END), 0) as unique_donors,
          ROUND(COALESCE(SUM(CASE WHEN t.status = 'success' THEN t.gross_amount ELSE 0 END), 0) * 100.0 / NULLIF(c.goal, 0), 2) as goal_percentage,
          COALESCE(AVG(CASE WHEN t.status = 'success' THEN t.gross_amount END), 0) as avg_donation_amount,
          c.created_at,
          c.updated_at
      FROM campaigns c
      LEFT JOIN transactions t ON c.id = t.campaign_id
      GROUP BY c.id, c.name, c.status, c.campaign_type, c.goal, c.start_date, c.end_date, c.created_at, c.updated_at
    `);

    // Supporter Summary View
    await trx.raw(`
      CREATE VIEW supporter_summary AS
      SELECT 
          s.id,
          s.id as classy_id,
          s.email_address,
          s.first_name,
          s.last_name,
          s.phone,
          s.email_opt_in,
          s.sms_opt_in,
          s.lifetime_donation_amount,
          s.lifetime_donation_count,
          s.last_donation_date,
          s.first_donation_date,
          
          -- Recurring plan metrics
          COALESCE(rp_stats.active_recurring_plans, 0) as active_recurring_plans,
          COALESCE(rp_stats.total_monthly_recurring, 0) as monthly_recurring_amount,
          
          -- Value-based segmentation
          COALESCE(value_seg.segment_name, 'Unclassified') as donor_value_tier,
          
          -- Engagement-based segmentation (recency)
          CASE 
              WHEN s.last_donation_date IS NULL THEN 'Never Donated'
              WHEN ${dateDiff} <= 30 THEN 'Recent'
              WHEN ${dateDiff} <= 90 THEN 'Active'
              WHEN ${dateDiff} <= 180 THEN 'Warm'
              WHEN ${dateDiff} <= 365 THEN 'Cooling'
              WHEN ${dateDiff} <= 730 THEN 'Lapsed'
              ELSE 'Dormant'
          END as engagement_status,
          
          -- Frequency-based segmentation
          CASE 
              WHEN s.lifetime_donation_count = 0 THEN 'No Donations'
              WHEN s.lifetime_donation_count = 1 THEN 'One-Time'
              WHEN s.lifetime_donation_count BETWEEN 2 AND 3 THEN 'Repeat'
              WHEN s.lifetime_donation_count BETWEEN 4 AND 10 THEN 'Regular'
              WHEN s.lifetime_donation_count BETWEEN 11 AND 25 THEN 'Loyal'
              ELSE 'Champion'
          END as frequency_segment,
          
          -- Calculated metrics
          CASE 
              WHEN s.last_donation_date IS NOT NULL THEN ${dateDiff}
              ELSE NULL 
          END as days_since_last_donation,
          
          s.created_at,
          s.last_sync_at

      FROM supporters s

      -- Recurring plan statistics
      LEFT JOIN (
          SELECT 
              rp.supporter_id,
              COUNT(CASE WHEN rp.status = 'active' THEN 1 END) as active_recurring_plans,
              SUM(CASE WHEN rp.status = 'active' THEN rp.amount ELSE 0 END) as total_monthly_recurring
          FROM recurring_plans rp
          GROUP BY rp.supporter_id
      ) rp_stats ON s.id = rp_stats.supporter_id

      -- Value-based segmentation
      LEFT JOIN donor_segmentation_config value_seg ON (
          value_seg.segment_type = 'value_tier' 
          AND value_seg.organization_id = s.organization_id
          AND s.lifetime_donation_amount >= COALESCE(value_seg.min_amount, 0)
          AND (value_seg.max_amount IS NULL OR s.lifetime_donation_amount <= value_seg.max_amount)
      )
    `);

    // Donor Value Distribution View
    await trx.raw(`
      CREATE VIEW donor_value_distribution AS
      SELECT 
          dsc.segment_name,
          dsc.min_amount,
          dsc.max_amount,
          COUNT(ss.id) as supporter_count,
          ROUND(SUM(ss.lifetime_donation_amount), 2) as total_lifetime_value,
          ROUND(AVG(ss.lifetime_donation_amount), 2) as avg_lifetime_value,
          ROUND(SUM(ss.monthly_recurring_amount), 2) as total_monthly_recurring,
          ROUND(COUNT(ss.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM supporter_summary), 0), 1) as percentage_of_base
      FROM donor_segmentation_config dsc
      LEFT JOIN supporter_summary ss ON ss.donor_value_tier = dsc.segment_name
      WHERE dsc.segment_type = 'value_tier'
      GROUP BY dsc.segment_name, dsc.sort_order, dsc.min_amount, dsc.max_amount
      ORDER BY dsc.sort_order
    `);

    // Donor Engagement Distribution View
    await trx.raw(`
      CREATE VIEW donor_engagement_distribution AS
      SELECT 
          engagement_status as segment_name,
          CASE engagement_status
              WHEN 'Never Donated' THEN 'No donations recorded'
              WHEN 'Recent' THEN 'Donated in last 30 days'
              WHEN 'Active' THEN 'Donated in last 31-90 days'
              WHEN 'Warm' THEN 'Donated in last 91-180 days'
              WHEN 'Cooling' THEN 'Donated in last 181-365 days'
              WHEN 'Lapsed' THEN 'Donated 1-2 years ago'
              WHEN 'Dormant' THEN 'Donated 2+ years ago'
              ELSE 'Unknown'
          END as description,
          COUNT(*) as supporter_count,
          ROUND(SUM(lifetime_donation_amount), 2) as total_lifetime_value,
          ROUND(AVG(CASE WHEN days_since_last_donation IS NOT NULL THEN days_since_last_donation END), 1) as avg_days_since_last_gift,
          ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM supporter_summary), 0), 1) as percentage_of_base
      FROM supporter_summary
      GROUP BY engagement_status
      ORDER BY 
          CASE engagement_status
              WHEN 'Recent' THEN 1
              WHEN 'Active' THEN 2
              WHEN 'Warm' THEN 3
              WHEN 'Cooling' THEN 4
              WHEN 'Lapsed' THEN 5
              WHEN 'Dormant' THEN 6
              WHEN 'Never Donated' THEN 7
              ELSE 8
          END
    `);

    console.log('✅ Fresh database schema created with Classy IDs as primary keys');
    console.log('   - supporters.id = Classy supporter ID');
    console.log('   - campaigns.id = Classy campaign ID');
    console.log('   - transactions.supporter_id directly references Classy supporter IDs');
    console.log('   - No more lookup queries needed for foreign key relationships');
    console.log('   - Sync order is now irrelevant - transactions can reference supporters that don\'t exist yet');
    console.log('   - Analytical views created for donor segmentation and reporting');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.transaction(async (trx) => {
    console.log('⚠️  Rolling back fresh schema design');
    
    // Drop views first
    await trx.raw('DROP VIEW IF EXISTS donor_engagement_distribution');
    await trx.raw('DROP VIEW IF EXISTS donor_value_distribution');
    await trx.raw('DROP VIEW IF EXISTS supporter_summary');
    await trx.raw('DROP VIEW IF EXISTS campaign_performance');
    
    // Drop all tables in correct order (respect foreign key constraints)
    await trx.schema.dropTableIfExists('sync_jobs');
    await trx.schema.dropTableIfExists('fundraising_pages');
    await trx.schema.dropTableIfExists('fundraising_teams');
    await trx.schema.dropTableIfExists('transactions');
    await trx.schema.dropTableIfExists('recurring_plans');
    await trx.schema.dropTableIfExists('supporters');
    await trx.schema.dropTableIfExists('campaigns');
    await trx.schema.dropTableIfExists('donor_segmentation_config'); // Drop this before organizations
    await trx.schema.dropTableIfExists('organizations');
    
    console.log('❌ All tables dropped - database is empty');
  });
};