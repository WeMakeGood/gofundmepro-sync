/**
 * Update analytical views after field name fixes
 * 
 * This migration updates the campaign_performance view to use the correct
 * field names after the field name fixes in 20250602000001_fix_campaign_field_names.js
 */

exports.up = function(knex) {
  const client = knex.client.config.client;
  
  return Promise.all([
    // Drop and recreate campaign_performance view with correct field names
    knex.raw('DROP VIEW IF EXISTS campaign_performance'),
    knex.raw(`
      CREATE VIEW campaign_performance AS
      SELECT 
          c.id,
          c.classy_id,
          c.name,
          c.status,
          c.type as campaign_type,
          c.goal,
          c.started_at as start_date,
          c.ended_at as end_date,
          COALESCE(SUM(CASE WHEN t.status = 'success' THEN t.gross_amount ELSE 0 END), 0) as actual_raised,
          COALESCE(COUNT(CASE WHEN t.status = 'success' THEN t.id END), 0) as successful_transactions,
          COALESCE(COUNT(DISTINCT CASE WHEN t.status = 'success' THEN t.supporter_id END), 0) as unique_donors,
          ROUND(COALESCE(SUM(CASE WHEN t.status = 'success' THEN t.gross_amount ELSE 0 END), 0) * 100.0 / NULLIF(c.goal, 0), 2) as goal_percentage,
          COALESCE(AVG(CASE WHEN t.status = 'success' THEN t.gross_amount END), 0) as avg_donation_amount,
          c.created_at,
          c.updated_at
      FROM campaigns c
      LEFT JOIN transactions t ON c.id = t.campaign_id
      GROUP BY c.id, c.classy_id, c.name, c.status, c.type, c.goal, c.started_at, c.ended_at, c.created_at, c.updated_at
    `)
  ]);
};

exports.down = function(knex) {
  return Promise.all([
    // Just drop the view on rollback - the previous migration will recreate the original
    knex.raw('DROP VIEW IF EXISTS campaign_performance')
  ]);
};