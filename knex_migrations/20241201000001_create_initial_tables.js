/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return Promise.all([
    // Organizations table
    knex.schema.createTable('organizations', function(table) {
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
    }),

    // Campaigns table
    knex.schema.createTable('campaigns', function(table) {
      table.increments('id').primary();
      table.string('classy_id', 255).unique().notNullable();
      table.integer('organization_id').unsigned().references('id').inTable('organizations');
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
      
      table.index('classy_id', 'idx_campaigns_classy_id');
      table.index('status', 'idx_campaigns_status');
      table.index('organization_id', 'idx_campaigns_organization');
    }),

    // Supporters table
    knex.schema.createTable('supporters', function(table) {
      table.increments('id').primary();
      table.string('classy_id', 255).unique().notNullable();
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
      table.decimal('lifetime_donation_amount', 10, 2);
      table.integer('lifetime_donation_count');
      table.timestamp('first_donation_date').nullable();
      table.timestamp('last_donation_date').nullable();
      table.text('custom_fields');
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      table.string('sync_status', 50);
      
      table.index('email_address', 'idx_supporters_email');
      table.index('classy_id', 'idx_supporters_classy_id');
      table.index(['sync_status', 'last_sync_at'], 'idx_supporters_sync_status');
      table.index('last_donation_date', 'idx_supporters_last_donation');
    }),

    // Recurring plans table
    knex.schema.createTable('recurring_plans', function(table) {
      table.increments('id').primary();
      table.string('classy_id', 255).unique().notNullable();
      table.integer('supporter_id').unsigned().references('id').inTable('supporters');
      table.integer('campaign_id').unsigned().references('id').inTable('campaigns');
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
      
      table.index('classy_id', 'idx_recurring_plans_classy_id');
      table.index('status', 'idx_recurring_plans_status');
      table.index('next_payment_date', 'idx_recurring_plans_next_payment');
      table.index('supporter_id', 'idx_recurring_plans_supporter');
      table.index('campaign_id', 'idx_recurring_plans_campaign');
    }),

    // Transactions table
    knex.schema.createTable('transactions', function(table) {
      table.increments('id').primary();
      table.string('classy_id', 255).unique().notNullable();
      table.integer('supporter_id').unsigned().references('id').inTable('supporters');
      table.integer('campaign_id').unsigned().references('id').inTable('campaigns');
      table.integer('recurring_plan_id').unsigned().references('id').inTable('recurring_plans');
      table.string('transaction_type', 50);
      table.string('status', 50);
      table.string('payment_method', 50);
      table.decimal('gross_amount', 10, 2);
      table.decimal('fee_amount', 10, 2);
      table.decimal('net_amount', 10, 2);
      table.string('currency', 3);
      table.timestamp('purchased_at').nullable();
      table.timestamp('refunded_at').nullable();
      table.text('custom_fields');
      table.text('question_responses');
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      
      table.index('classy_id', 'idx_transactions_classy_id');
      table.index('supporter_id', 'idx_transactions_supporter');
      table.index('campaign_id', 'idx_transactions_campaign');
      table.index('purchased_at', 'idx_transactions_purchased_at');
      table.index('status', 'idx_transactions_status');
      table.index('transaction_type', 'idx_transactions_type');
    }),

    // Fundraising teams table
    knex.schema.createTable('fundraising_teams', function(table) {
      table.increments('id').primary();
      table.string('classy_id', 255).unique().notNullable();
      table.integer('campaign_id').unsigned().references('id').inTable('campaigns');
      table.string('name', 255);
      table.text('description');
      table.decimal('goal', 10, 2);
      table.decimal('total_raised', 10, 2);
      table.integer('member_count');
      table.string('status', 50);
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      
      table.index('classy_id', 'idx_fundraising_teams_classy_id');
      table.index('campaign_id', 'idx_fundraising_teams_campaign');
    }),

    // Fundraising pages table
    knex.schema.createTable('fundraising_pages', function(table) {
      table.increments('id').primary();
      table.string('classy_id', 255).unique().notNullable();
      table.integer('campaign_id').unsigned().references('id').inTable('campaigns');
      table.integer('team_id').unsigned().references('id').inTable('fundraising_teams');
      table.integer('supporter_id').unsigned().references('id').inTable('supporters');
      table.string('title', 255);
      table.decimal('goal', 10, 2);
      table.decimal('total_raised', 10, 2);
      table.string('status', 50);
      table.timestamp('created_at').nullable();
      table.timestamp('updated_at').nullable();
      table.timestamp('last_sync_at').nullable();
      
      table.index('classy_id', 'idx_fundraising_pages_classy_id');
      table.index('campaign_id', 'idx_fundraising_pages_campaign');
      table.index('team_id', 'idx_fundraising_pages_team');
      table.index('supporter_id', 'idx_fundraising_pages_supporter');
    }),

    // Sync jobs tracking table
    knex.schema.createTable('sync_jobs', function(table) {
      table.increments('id').primary();
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
    })
  ]);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return Promise.all([
    knex.schema.dropTableIfExists('sync_jobs'),
    knex.schema.dropTableIfExists('fundraising_pages'),
    knex.schema.dropTableIfExists('fundraising_teams'),
    knex.schema.dropTableIfExists('transactions'),
    knex.schema.dropTableIfExists('recurring_plans'),
    knex.schema.dropTableIfExists('supporters'),
    knex.schema.dropTableIfExists('campaigns'),
    knex.schema.dropTableIfExists('organizations')
  ]);
};