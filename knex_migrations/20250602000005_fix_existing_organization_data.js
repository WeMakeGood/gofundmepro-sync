/**
 * Fix existing organization data
 * 
 * This migration updates all NULL organization_id values to point to the default organization (ID 1)
 * and ensures data integrity for the multi-organization system.
 */

exports.up = function(knex) {
  return Promise.all([
    // Update all campaigns with NULL organization_id to use organization 1
    knex.raw('UPDATE campaigns SET organization_id = 1 WHERE organization_id IS NULL'),
    
    // Update organizations table to store encrypted API credentials
    knex.schema.alterTable('organizations', function(table) {
      table.text('encrypted_credentials').nullable();
      table.text('sync_settings').nullable();
    })
  ]);
};

exports.down = function(knex) {
  return Promise.all([
    // First make organization_id nullable again, then set to NULL
    knex.schema.alterTable('campaigns', function(table) {
      table.integer('organization_id').unsigned().nullable().alter();
    }),
    
    // Remove the new columns from organizations (with safe checks)
    knex.schema.hasColumn('organizations', 'encrypted_credentials').then(exists => {
      if (exists) {
        return knex.schema.alterTable('organizations', function(table) {
          table.dropColumn('encrypted_credentials');
        });
      }
    }),
    
    knex.schema.hasColumn('organizations', 'sync_settings').then(exists => {
      if (exists) {
        return knex.schema.alterTable('organizations', function(table) {
          table.dropColumn('sync_settings');
        });
      }
    })
  ]).then(() => {
    // Now we can safely set organization_id to NULL after making it nullable
    return knex.raw('UPDATE campaigns SET organization_id = NULL WHERE organization_id = 1');
  });
};