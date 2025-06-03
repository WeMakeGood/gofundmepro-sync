/**
 * Analytical Views Migration
 * 
 * Creates comprehensive analytical views for donor segmentation and reporting
 * Based on validated schema with Classy IDs as primary keys
 * 
 * Supports both SQLite and MySQL syntax
 */

exports.up = function(knex) {
  const createView = (viewName, query) => {
    return knex.raw(`CREATE VIEW ${viewName} AS ${query}`);
  };

  // Detect database type for syntax differences
  const isMySQL = knex.client.config.client === 'mysql2';
  const dateInterval = isMySQL ? 'DATE_SUB(NOW(), INTERVAL 12 MONTH)' : "DATE('now', '-12 months')";
  const dateInterval6 = isMySQL ? 'DATE_SUB(NOW(), INTERVAL 6 MONTH)' : "DATE('now', '-6 months')";
  const dateInterval24 = isMySQL ? 'DATE_SUB(NOW(), INTERVAL 24 MONTH)' : "DATE('now', '-24 months')";
  const julianDayFunc = isMySQL ? 'DATEDIFF' : 'JULIANDAY';

  return Promise.all([
    // Supporter Summary View - Complete donor profiles with segmentation
    createView('supporter_summary', `
      SELECT 
        s.id as supporter_id,
        s.organization_id,
        s.email_address,
        s.first_name,
        s.last_name,
        s.lifetime_donation_amount,
        s.lifetime_donation_count,
        s.monthly_recurring_amount,
        s.email_opt_in,
        s.city,
        s.state,
        s.country,
        
        -- Calculated metrics
        CASE 
          WHEN s.lifetime_donation_amount >= 1000 THEN 'Major Donor'
          WHEN s.lifetime_donation_amount >= 500 THEN 'Mid-Level Donor'
          WHEN s.lifetime_donation_amount >= 100 THEN 'Regular Donor'
          WHEN s.lifetime_donation_amount > 0 THEN 'Small Donor'
          ELSE 'No Donations'
        END as donor_segment,
        
        CASE 
          WHEN s.monthly_recurring_amount > 0 THEN 'Recurring'
          ELSE 'One-time'
        END as giving_type,
        
        -- Recent activity
        (SELECT MAX(t.purchased_at) 
         FROM transactions t 
         WHERE t.supporter_id = s.id AND t.status = 'success') as last_donation_date,
         
        (SELECT COUNT(*) 
         FROM transactions t 
         WHERE t.supporter_id = s.id AND t.status = 'success' 
           AND t.purchased_at >= ${dateInterval}) as donations_last_12_months,
           
        s.created_at,
        s.updated_at,
        s.last_sync_at
        
      FROM supporters s
    `),

    // Campaign Performance View - Campaign metrics and ROI analysis
    createView('campaign_performance', `
      SELECT 
        c.id as campaign_id,
        c.organization_id,
        c.name,
        c.type,
        c.status,
        c.goal,
        c.total_raised,
        c.donors_count,
        c.started_at,
        c.ended_at,
        
        -- Performance metrics
        CASE 
          WHEN c.goal > 0 THEN ROUND((c.total_raised / c.goal) * 100, 2)
          ELSE NULL 
        END as goal_percentage,
        
        CASE 
          WHEN c.donors_count > 0 THEN ROUND(c.total_raised / c.donors_count, 2)
          ELSE 0 
        END as average_donation,
        
        -- Transaction-based metrics
        (SELECT COUNT(*) 
         FROM transactions t 
         WHERE t.campaign_id = c.id AND t.status = 'success') as successful_transactions,
         
        (SELECT SUM(t.total_gross_amount) 
         FROM transactions t 
         WHERE t.campaign_id = c.id AND t.status = 'success') as actual_raised,
         
        (SELECT COUNT(DISTINCT t.supporter_id) 
         FROM transactions t 
         WHERE t.campaign_id = c.id AND t.status = 'success') as unique_donors,
         
        -- Duration
        CASE 
          WHEN c.started_at IS NOT NULL AND c.ended_at IS NOT NULL 
          THEN ${isMySQL ? 'DATEDIFF(c.ended_at, c.started_at)' : 'ROUND(JULIANDAY(c.ended_at) - JULIANDAY(c.started_at))'}
          ELSE NULL 
        END as duration_days,
        
        c.created_at,
        c.updated_at,
        c.last_sync_at
        
      FROM campaigns c
    `),

    // Donor Value Distribution View - Value tier analysis
    createView('donor_value_distribution', `
      SELECT 
        organization_id,
        'Major Donor (≥$1000)' as segment,
        COUNT(*) as supporter_count,
        SUM(lifetime_donation_amount) as total_value,
        AVG(lifetime_donation_amount) as average_value,
        SUM(monthly_recurring_amount) as monthly_recurring
      FROM supporters 
      WHERE lifetime_donation_amount >= 1000
      GROUP BY organization_id
      
      UNION ALL
      
      SELECT 
        organization_id,
        'Mid-Level Donor ($500-$999)' as segment,
        COUNT(*) as supporter_count,
        SUM(lifetime_donation_amount) as total_value,
        AVG(lifetime_donation_amount) as average_value,
        SUM(monthly_recurring_amount) as monthly_recurring
      FROM supporters 
      WHERE lifetime_donation_amount >= 500 AND lifetime_donation_amount < 1000
      GROUP BY organization_id
      
      UNION ALL
      
      SELECT 
        organization_id,
        'Regular Donor ($100-$499)' as segment,
        COUNT(*) as supporter_count,
        SUM(lifetime_donation_amount) as total_value,
        AVG(lifetime_donation_amount) as average_value,
        SUM(monthly_recurring_amount) as monthly_recurring
      FROM supporters 
      WHERE lifetime_donation_amount >= 100 AND lifetime_donation_amount < 500
      GROUP BY organization_id
      
      UNION ALL
      
      SELECT 
        organization_id,
        'Small Donor (<$100)' as segment,
        COUNT(*) as supporter_count,
        SUM(lifetime_donation_amount) as total_value,
        AVG(lifetime_donation_amount) as average_value,
        SUM(monthly_recurring_amount) as monthly_recurring
      FROM supporters 
      WHERE lifetime_donation_amount > 0 AND lifetime_donation_amount < 100
      GROUP BY organization_id
    `),

    // Donor Engagement Distribution View - Engagement status analysis
    createView('donor_engagement_distribution', `
      WITH recent_activity AS (
        SELECT 
          s.id as supporter_id,
          s.organization_id,
          s.lifetime_donation_amount,
          s.monthly_recurring_amount,
          MAX(t.purchased_at) as last_donation_date,
          COUNT(t.id) as total_transactions
        FROM supporters s
        LEFT JOIN transactions t ON s.id = t.supporter_id AND t.status = 'success'
        GROUP BY s.id, s.organization_id, s.lifetime_donation_amount, s.monthly_recurring_amount
      )
      
      SELECT 
        organization_id,
        CASE 
          WHEN monthly_recurring_amount > 0 THEN 'Active Recurring'
          WHEN last_donation_date >= ${dateInterval6} THEN 'Recently Active'
          WHEN last_donation_date >= ${dateInterval} THEN 'Moderately Active'
          WHEN last_donation_date >= ${dateInterval24} THEN 'Low Activity'
          WHEN last_donation_date IS NOT NULL THEN 'Inactive'
          ELSE 'Never Donated'
        END as engagement_status,
        
        COUNT(*) as supporter_count,
        SUM(lifetime_donation_amount) as total_lifetime_value,
        AVG(lifetime_donation_amount) as average_lifetime_value,
        SUM(monthly_recurring_amount) as total_monthly_recurring,
        SUM(total_transactions) as total_transactions
        
      FROM recent_activity
      GROUP BY organization_id, engagement_status
    `)
  ]);
};

exports.down = function(knex) {
  return Promise.all([
    knex.raw('DROP VIEW IF EXISTS donor_engagement_distribution'),
    knex.raw('DROP VIEW IF EXISTS donor_value_distribution'),
    knex.raw('DROP VIEW IF EXISTS campaign_performance'),
    knex.raw('DROP VIEW IF EXISTS supporter_summary')
  ]);
};