-- Migration: 007_fix_date_calculations
-- Description: Fix date calculations to handle timezone-aware dates properly

-- Drop and recreate the supporter_summary view with proper date handling
DROP VIEW IF EXISTS supporter_summary;

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
    
    -- Value-based segmentation (configurable by organization)
    COALESCE(value_seg.segment_name, 'Unclassified') as donor_value_tier,
    COALESCE(value_seg.color_code, '#e0e0e0') as value_tier_color,
    
    -- Engagement-based segmentation (recency) - FIXED DATE PARSING
    CASE 
        WHEN s.last_donation_date IS NULL THEN 'Never Donated'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 30 THEN 'Recent'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 90 THEN 'Active'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 180 THEN 'Warm'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 365 THEN 'Cooling'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 730 THEN 'Lapsed'
        ELSE 'Dormant'
    END as engagement_status,
    
    -- Engagement color mapping
    CASE 
        WHEN s.last_donation_date IS NULL THEN '#e0e0e0'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 30 THEN '#4caf50'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 90 THEN '#8bc34a'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 180 THEN '#cddc39'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 365 THEN '#ffeb3b'
        WHEN CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER) <= 730 THEN '#ff9800'
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
    
    -- Calculated metrics - FIXED DATE PARSING
    CASE 
        WHEN s.last_donation_date IS NOT NULL THEN 
            CAST((julianday('now') - julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z')) AS INTEGER)
        ELSE NULL 
    END as days_since_last_donation,
    
    CASE 
        WHEN s.first_donation_date IS NOT NULL AND s.last_donation_date IS NOT NULL THEN
            CAST((julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z') - julianday(SUBSTR(s.first_donation_date, 1, 19) || 'Z')) AS INTEGER)
        ELSE NULL
    END as donor_lifespan_days,
    
    CASE 
        WHEN s.lifetime_donation_count > 1 AND s.first_donation_date IS NOT NULL AND s.last_donation_date IS NOT NULL THEN
            ROUND(s.lifetime_donation_amount / 
                NULLIF(CAST((julianday(SUBSTR(s.last_donation_date, 1, 19) || 'Z') - julianday(SUBSTR(s.first_donation_date, 1, 19) || 'Z')) / 365.25 AS REAL), 0), 2)
        ELSE s.lifetime_donation_amount
    END as annual_giving_rate,
    
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
    AND value_seg.organization_id = 1  -- TODO: Make this dynamic based on supporter's organization
    AND s.lifetime_donation_amount >= COALESCE(value_seg.min_amount, 0)
    AND (value_seg.max_amount IS NULL OR s.lifetime_donation_amount <= value_seg.max_amount)
);

-- Insert this migration record
INSERT OR IGNORE INTO migrations (version, name) 
VALUES ('007', 'fix_date_calculations');