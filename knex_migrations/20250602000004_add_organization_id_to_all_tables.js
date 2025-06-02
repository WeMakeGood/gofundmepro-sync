/**
 * Add organization_id to all tables and enforce foreign key constraints
 * 
 * This migration adds organization_id columns to all tables that need them
 * and creates proper foreign key relationships for multi-organization support.
 */

exports.up = function(knex) {
  return Promise.all([
    // Add organization_id to supporters table
    knex.schema.alterTable('supporters', function(table) {
      table.integer('organization_id').unsigned().notNullable().defaultTo(1);
      table.foreign('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
      table.index('organization_id');
    }),

    // Add organization_id to transactions table
    knex.schema.alterTable('transactions', function(table) {
      table.integer('organization_id').unsigned().notNullable().defaultTo(1);
      table.foreign('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
      table.index('organization_id');
    }),

    // Add organization_id to recurring_plans table
    knex.schema.alterTable('recurring_plans', function(table) {
      table.integer('organization_id').unsigned().notNullable().defaultTo(1);
      table.foreign('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
      table.index('organization_id');
    }),

    // Add organization_id to fundraising_teams table
    knex.schema.alterTable('fundraising_teams', function(table) {
      table.integer('organization_id').unsigned().notNullable().defaultTo(1);
      table.foreign('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
      table.index('organization_id');
    }),

    // Add organization_id to fundraising_pages table
    knex.schema.alterTable('fundraising_pages', function(table) {
      table.integer('organization_id').unsigned().notNullable().defaultTo(1);
      table.foreign('organization_id').references('id').inTable('organizations').onDelete('CASCADE');
      table.index('organization_id');
    }),

    // Add organization_id to sync_jobs table  
    knex.schema.alterTable('sync_jobs', function(table) {
      table.integer('organization_id').unsigned().nullable();
      table.foreign('organization_id').references('id').inTable('organizations').onDelete('SET NULL');
      table.index('organization_id');
    }),

    // Update campaigns table to make organization_id not null (foreign key already exists)
    knex.raw('UPDATE campaigns SET organization_id = 1 WHERE organization_id IS NULL'),
    knex.schema.alterTable('campaigns', function(table) {
      table.integer('organization_id').unsigned().notNullable().alter();
    })
  ]);
};

exports.down = function(knex) {
  return Promise.all([
    // Remove foreign keys and organization_id columns
    knex.schema.alterTable('supporters', function(table) {
      table.dropForeign('organization_id');
      table.dropColumn('organization_id');
    }),

    knex.schema.alterTable('transactions', function(table) {
      table.dropForeign('organization_id');
      table.dropColumn('organization_id');
    }),

    knex.schema.alterTable('recurring_plans', function(table) {
      table.dropForeign('organization_id');
      table.dropColumn('organization_id');
    }),

    knex.schema.alterTable('fundraising_teams', function(table) {
      table.dropForeign('organization_id');
      table.dropColumn('organization_id');
    }),

    knex.schema.alterTable('fundraising_pages', function(table) {
      table.dropForeign('organization_id');
      table.dropColumn('organization_id');
    }),

    knex.schema.alterTable('sync_jobs', function(table) {
      table.dropForeign('organization_id');
      table.dropColumn('organization_id');
    }),

    knex.schema.alterTable('campaigns', function(table) {
      table.integer('organization_id').unsigned().nullable().alter();
    })
  ]);
};