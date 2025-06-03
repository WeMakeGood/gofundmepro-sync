/**
 * Clean Classy Sync Schema Migration
 * 
 * Creates clean database schema using Classy IDs as primary keys
 * Based on validated API field analysis and live data testing
 */

exports.up = function(knex) {
  return knex.schema
    // Organizations table (internal management only)
    .createTable('organizations', table => {
      table.increments('id').primary();
      table.bigInteger('classy_id').unsigned().unique().notNullable();
      table.string('name', 255).notNullable();
      table.enum('status', ['active', 'inactive']).defaultTo('active');
      table.text('encrypted_credentials'); // Encrypted OAuth credentials
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      
      table.index(['classy_id']);
      table.index(['status']);
    })

    // Supporters (Classy ID as primary key)
    .createTable('supporters', table => {
      table.bigInteger('id').unsigned().primary(); // Classy supporter ID
      table.integer('organization_id').unsigned().notNullable();
      table.string('email_address', 255).notNullable();
      table.string('first_name', 100);
      table.string('last_name', 100);
      table.decimal('lifetime_donation_amount', 12, 2).defaultTo(0);
      table.integer('lifetime_donation_count').defaultTo(0);
      table.decimal('monthly_recurring_amount', 10, 2).defaultTo(0);
      table.boolean('email_opt_in').defaultTo(false);
      table.string('phone', 20);
      table.string('city', 100);
      table.string('state', 100);
      table.string('country', 2);
      table.string('postal_code', 20);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('last_sync_at');
      
      table.foreign('organization_id').references('id').inTable('organizations');
      table.index(['organization_id']);
      table.index(['email_address']);
      table.index(['lifetime_donation_amount']);
      table.index(['last_sync_at']);
    })

    // Campaigns (Classy ID as primary key)
    .createTable('campaigns', table => {
      table.bigInteger('id').unsigned().primary(); // Classy campaign ID
      table.integer('organization_id').unsigned().notNullable();
      table.string('name', 255).notNullable();
      table.enum('status', ['active', 'inactive', 'completed', 'draft']).defaultTo('active');
      table.string('type', 100); // Validated field name
      table.decimal('goal', 12, 2);
      table.decimal('total_raised', 12, 2).defaultTo(0);
      table.integer('donors_count').defaultTo(0); // Validated field name
      table.timestamp('started_at'); // Validated field name
      table.timestamp('ended_at'); // Validated field name
      table.text('description');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('last_sync_at');
      
      table.foreign('organization_id').references('id').inTable('organizations');
      table.index(['organization_id']);
      table.index(['status']);
      table.index(['type']);
      table.index(['started_at']);
      table.index(['last_sync_at']);
    })

    // Transactions (Classy ID as primary key)
    .createTable('transactions', table => {
      table.bigInteger('id').unsigned().primary(); // Classy transaction ID
      table.integer('organization_id').unsigned().notNullable();
      table.bigInteger('supporter_id').unsigned(); // FK to supporters.id (Classy ID)
      table.bigInteger('campaign_id').unsigned(); // FK to campaigns.id (Classy ID)
      table.bigInteger('recurring_plan_id').unsigned(); // FK to recurring_plans.id
      
      // Core amounts (validated field names from live API)
      table.decimal('total_gross_amount', 12, 2).notNullable(); // Primary amount field
      table.decimal('donation_gross_amount', 12, 2); // Donation portion
      table.decimal('fees_amount', 12, 2); // Processing fees
      table.decimal('donation_net_amount', 12, 2); // Net after fees
      table.string('currency', 3).defaultTo('USD');
      
      // Multi-currency support (all available in API)
      table.decimal('raw_total_gross_amount', 12, 2);
      table.string('raw_currency_code', 3);
      table.decimal('charged_total_gross_amount', 12, 2);
      table.string('charged_currency_code', 3);
      
      // Billing information (available for analytics)
      table.string('billing_city', 100);
      table.string('billing_state', 100);
      table.string('billing_country', 2);
      table.string('billing_postal_code', 20);
      
      // Relationship fields (validated)
      table.bigInteger('fundraising_page_id').unsigned();
      table.bigInteger('fundraising_team_id').unsigned();
      
      table.enum('status', ['success', 'failed', 'pending', 'refunded']).defaultTo('success');
      table.timestamp('purchased_at').notNullable(); // When transaction occurred
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('last_sync_at');
      
      table.foreign('organization_id').references('id').inTable('organizations');
      table.foreign('supporter_id').references('id').inTable('supporters');
      table.foreign('campaign_id').references('id').inTable('campaigns');
      
      table.index(['organization_id']);
      table.index(['supporter_id']);
      table.index(['campaign_id']);
      table.index(['status']);
      table.index(['purchased_at']);
      table.index(['last_sync_at']);
    })

    // Recurring Plans (Classy ID as primary key)
    .createTable('recurring_plans', table => {
      table.bigInteger('id').unsigned().primary(); // Classy recurring plan ID
      table.integer('organization_id').unsigned().notNullable();
      table.bigInteger('supporter_id').unsigned().notNullable(); // FK to supporters.id
      table.bigInteger('campaign_id').unsigned(); // FK to campaigns.id
      table.enum('status', ['active', 'cancelled', 'paused', 'completed']).defaultTo('active');
      table.decimal('amount', 10, 2).notNullable();
      table.enum('frequency', ['monthly', 'quarterly', 'yearly']).defaultTo('monthly');
      table.date('next_payment_date');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.timestamp('last_sync_at');
      
      table.foreign('organization_id').references('id').inTable('organizations');
      table.foreign('supporter_id').references('id').inTable('supporters');
      table.foreign('campaign_id').references('id').inTable('campaigns');
      
      table.index(['organization_id']);
      table.index(['supporter_id']);
      table.index(['campaign_id']);
      table.index(['status']);
      table.index(['next_payment_date']);
      table.index(['last_sync_at']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('recurring_plans')
    .dropTableIfExists('transactions')
    .dropTableIfExists('campaigns')
    .dropTableIfExists('supporters')
    .dropTableIfExists('organizations');
};