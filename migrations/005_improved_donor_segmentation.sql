-- Migration: 005_improved_donor_segmentation
-- Description: Create improved donor segmentation with separate evaluation criteria

-- 1. Insert default donor value tiers for Eden Projects organization
INSERT OR IGNORE INTO donor_segmentation_config (organization_id, segment_type, segment_name, min_amount, max_amount, description, color_code, sort_order) VALUES
-- Value-based segments (lifetime giving)
(1, 'donor_value', 'Prospect', 0, 0, 'No donations yet', '#e3f2fd', 1),
(1, 'donor_value', 'First-Time', 0.01, 24.99, 'First donation under $25', '#bbdefb', 2),
(1, 'donor_value', 'Small Donor', 25, 99.99, 'Lifetime giving $25-$99', '#90caf9', 3),
(1, 'donor_value', 'Regular Donor', 100, 499.99, 'Lifetime giving $100-$499', '#64b5f6', 4),
(1, 'donor_value', 'Committed Donor', 500, 999.99, 'Lifetime giving $500-$999', '#42a5f5', 5),
(1, 'donor_value', 'Major Donor', 1000, 4999.99, 'Lifetime giving $1K-$4.9K', '#2196f3', 6),
(1, 'donor_value', 'Principal Donor', 5000, 9999.99, 'Lifetime giving $5K-$9.9K', '#1e88e5', 7),
(1, 'donor_value', 'Transformational', 10000, NULL, 'Lifetime giving $10K+', '#1976d2', 8);

-- Engagement-based segments (recency)
INSERT OR IGNORE INTO donor_segmentation_config (organization_id, segment_type, segment_name, days_threshold, description, color_code, sort_order) VALUES
(1, 'engagement', 'Recent', 30, 'Donated in last 30 days', '#4caf50', 1),
(1, 'engagement', 'Active', 90, 'Donated in last 31-90 days', '#8bc34a', 2),
(1, 'engagement', 'Warm', 180, 'Donated in last 91-180 days', '#cddc39', 3),
(1, 'engagement', 'Cooling', 365, 'Donated in last 181-365 days', '#ffeb3b', 4),
(1, 'engagement', 'Lapsed', 730, 'Donated 1-2 years ago', '#ff9800', 5),
(1, 'engagement', 'Dormant', NULL, 'Donated 2+ years ago', '#f44336', 6);

-- Frequency-based segments (donation count patterns)
INSERT OR IGNORE INTO donor_segmentation_config (organization_id, segment_type, segment_name, min_count, max_count, description, color_code, sort_order) VALUES
(1, 'frequency', 'One-Time', 1, 1, 'Single donation', '#9e9e9e', 1),
(1, 'frequency', 'Repeat', 2, 3, '2-3 donations', '#607d8b', 2),
(1, 'frequency', 'Regular', 4, 10, '4-10 donations', '#795548', 3),
(1, 'frequency', 'Loyal', 11, 25, '11-25 donations', '#5d4037', 4),
(1, 'frequency', 'Champion', 26, NULL, '26+ donations', '#3e2723', 5);

-- 2. Create improved supporter summary view
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
    
    -- Engagement-based segmentation (recency)
    COALESCE(engagement_seg.segment_name, 'Never Donated') as engagement_status,
    COALESCE(engagement_seg.color_code, '#e0e0e0') as engagement_color,
    
    -- Frequency-based segmentation
    COALESCE(frequency_seg.segment_name, 'No Donations') as frequency_segment,
    COALESCE(frequency_seg.color_code, '#e0e0e0') as frequency_color,
    
    -- Calculated metrics
    CASE 
        WHEN s.last_donation_date IS NOT NULL THEN 
            CAST((julianday('now') - julianday(s.last_donation_date)) AS INTEGER)
        ELSE NULL 
    END as days_since_last_donation,
    
    CASE 
        WHEN s.first_donation_date IS NOT NULL AND s.last_donation_date IS NOT NULL THEN
            CAST((julianday(s.last_donation_date) - julianday(s.first_donation_date)) AS INTEGER)
        ELSE NULL
    END as donor_lifespan_days,
    
    CASE 
        WHEN s.lifetime_donation_count > 1 AND s.first_donation_date IS NOT NULL AND s.last_donation_date IS NOT NULL THEN
            ROUND(s.lifetime_donation_amount / 
                NULLIF(CAST((julianday(s.last_donation_date) - julianday(s.first_donation_date)) / 365.25 AS REAL), 0), 2)
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
)

-- Engagement-based segmentation (recency)
LEFT JOIN donor_segmentation_config engagement_seg ON (
    engagement_seg.segment_type = 'engagement'
    AND engagement_seg.organization_id = 1
    AND s.last_donation_date IS NOT NULL
    AND CAST((julianday('now') - julianday(s.last_donation_date)) AS INTEGER) <= COALESCE(engagement_seg.days_threshold, 99999)
    AND engagement_seg.sort_order = (
        SELECT MIN(dsc2.sort_order)
        FROM donor_segmentation_config dsc2
        WHERE dsc2.segment_type = 'engagement'
        AND dsc2.organization_id = 1
        AND CAST((julianday('now') - julianday(s.last_donation_date)) AS INTEGER) <= COALESCE(dsc2.days_threshold, 99999)
    )
)

-- Frequency-based segmentation
LEFT JOIN donor_segmentation_config frequency_seg ON (
    frequency_seg.segment_type = 'frequency'
    AND frequency_seg.organization_id = 1
    AND s.lifetime_donation_count >= COALESCE(frequency_seg.min_count, 0)
    AND (frequency_seg.max_count IS NULL OR s.lifetime_donation_count <= frequency_seg.max_count)
);

-- 3. Create segmentation analysis functions as views

-- View for donor value distribution
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
ORDER BY dsc.sort_order;

-- View for engagement distribution
CREATE VIEW donor_engagement_distribution AS
SELECT 
    dsc.segment_name,
    dsc.description,
    dsc.color_code,
    COUNT(ss.id) as supporter_count,
    ROUND(SUM(ss.lifetime_donation_amount), 2) as total_lifetime_value,
    ROUND(AVG(ss.days_since_last_donation), 1) as avg_days_since_last_gift,
    ROUND(COUNT(ss.id) * 100.0 / (SELECT COUNT(*) FROM supporter_summary WHERE last_donation_date IS NOT NULL), 1) as percentage_of_donors
FROM donor_segmentation_config dsc
LEFT JOIN supporter_summary ss ON ss.engagement_status = dsc.segment_name
WHERE dsc.segment_type = 'engagement' AND dsc.organization_id = 1
GROUP BY dsc.segment_name, dsc.sort_order, dsc.description, dsc.color_code
ORDER BY dsc.sort_order;

-- Insert this migration record
INSERT OR IGNORE INTO migrations (version, name) 
VALUES ('005', 'improved_donor_segmentation');