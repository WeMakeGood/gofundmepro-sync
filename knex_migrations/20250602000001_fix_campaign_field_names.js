/**
 * Fix campaign field names to match GoFundMe Pro API
 * 
 * Based on official API documentation analysis:
 * - campaign_type → type
 * - start_date → started_at  
 * - end_date → ended_at
 * 
 * Note: donor_count remains as-is since it's calculated data not directly from API
 */

exports.up = function(knex) {
  return knex.schema.alterTable('campaigns', function(table) {
    // Rename columns to match API field names
    table.renameColumn('campaign_type', 'type');
    table.renameColumn('start_date', 'started_at');
    table.renameColumn('end_date', 'ended_at');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('campaigns', function(table) {
    // Revert column names
    table.renameColumn('type', 'campaign_type');
    table.renameColumn('started_at', 'start_date');
    table.renameColumn('ended_at', 'end_date');
  });
};