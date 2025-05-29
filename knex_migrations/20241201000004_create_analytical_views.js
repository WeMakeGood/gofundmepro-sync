/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  const client = knex.client.config.client;
  
  // Different date functions for different databases
  const dateDiff = client === 'mysql2' || client === 'mysql' 
    ? 'DATEDIFF(NOW(), s.last_donation_date)'
    : "(julianday('now') - julianday(s.last_donation_date))";
    
  const now = client === 'mysql2' || client === 'mysql' ? 'NOW()' : "datetime('now')";

  return Promise.all([
    // Campaign Performance View
    knex.raw(`
      CREATE VIEW campaign_performance AS
      SELECT 
          c.id,
          c.classy_id,
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
      GROUP BY c.id, c.classy_id, c.name, c.status, c.campaign_type, c.goal, c.start_date, c.end_date, c.created_at, c.updated_at
    `),

    // Supporter Summary View
    knex.raw(`
      CREATE VIEW supporter_summary AS
      SELECT 
          s.id,
          s.classy_id,
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
          COALESCE(value_seg.color_code, '#e0e0e0') as value_tier_color,
          
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
          
          -- Engagement color mapping
          CASE 
              WHEN s.last_donation_date IS NULL THEN '#e0e0e0'
              WHEN ${dateDiff} <= 30 THEN '#4caf50'
              WHEN ${dateDiff} <= 90 THEN '#8bc34a'
              WHEN ${dateDiff} <= 180 THEN '#cddc39'
              WHEN ${dateDiff} <= 365 THEN '#ffeb3b'
              WHEN ${dateDiff} <= 730 THEN '#ff9800'
              ELSE '#f44336'
          END as engagement_color,
          
          -- Frequency-based segmentation
          CASE 
              WHEN s.lifetime_donation_count = 0 THEN 'No Donations'
              WHEN s.lifetime_donation_count = 1 THEN 'One-Time'
              WHEN s.lifetime_donation_count BETWEEN 2 AND 3 THEN 'Repeat'
              WHEN s.lifetime_donation_count BETWEEN 4 AND 10 THEN 'Regular'
              WHEN s.lifetime_donation_count BETWEEN 11 AND 25 THEN 'Loyal'
              ELSE 'Champion'
          END as frequency_segment,
          
          -- Frequency color mapping
          CASE 
              WHEN s.lifetime_donation_count = 0 THEN '#e0e0e0'
              WHEN s.lifetime_donation_count = 1 THEN '#9e9e9e'
              WHEN s.lifetime_donation_count BETWEEN 2 AND 3 THEN '#607d8b'
              WHEN s.lifetime_donation_count BETWEEN 4 AND 10 THEN '#795548'
              WHEN s.lifetime_donation_count BETWEEN 11 AND 25 THEN '#5d4037'
              ELSE '#3e2723'
          END as frequency_color,
          
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
          value_seg.segment_type = 'donor_value' 
          AND value_seg.organization_id = 1
          AND s.lifetime_donation_amount >= COALESCE(value_seg.min_amount, 0)
          AND (value_seg.max_amount IS NULL OR s.lifetime_donation_amount <= value_seg.max_amount)
      )
    `),

    // Donor Value Distribution View
    knex.raw(`
      CREATE VIEW donor_value_distribution AS
      SELECT 
          dsc.segment_name,
          dsc.description,
          dsc.color_code,
          COUNT(ss.id) as supporter_count,
          ROUND(SUM(ss.lifetime_donation_amount), 2) as total_lifetime_value,
          ROUND(AVG(ss.lifetime_donation_amount), 2) as avg_lifetime_value,
          ROUND(SUM(ss.monthly_recurring_amount), 2) as total_monthly_recurring,
          ROUND(COUNT(ss.id) * 100.0 / (SELECT COUNT(*) FROM supporter_summary), 1) as percentage_of_base
      FROM donor_segmentation_config dsc
      LEFT JOIN supporter_summary ss ON ss.donor_value_tier = dsc.segment_name
      WHERE dsc.segment_type = 'donor_value' AND dsc.organization_id = 1
      GROUP BY dsc.segment_name, dsc.sort_order, dsc.description, dsc.color_code
      ORDER BY dsc.sort_order
    `),

    // Donor Engagement Distribution View
    knex.raw(`
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
          engagement_color as color_code,
          COUNT(*) as supporter_count,
          ROUND(SUM(lifetime_donation_amount), 2) as total_lifetime_value,
          ROUND(AVG(CASE WHEN days_since_last_donation IS NOT NULL THEN days_since_last_donation END), 1) as avg_days_since_last_gift,
          ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM supporter_summary), 1) as percentage_of_base
      FROM supporter_summary
      GROUP BY engagement_status, engagement_color
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
    `)
  ]);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return Promise.all([
    knex.raw('DROP VIEW IF EXISTS donor_engagement_distribution'),
    knex.raw('DROP VIEW IF EXISTS donor_value_distribution'),
    knex.raw('DROP VIEW IF EXISTS supporter_summary'),
    knex.raw('DROP VIEW IF EXISTS campaign_performance')
  ]);
};