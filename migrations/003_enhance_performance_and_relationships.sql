-- Migration: 003_enhance_performance_and_relationships
-- Description: Improve database performance, fix organization relationships, and add campaign performance views

-- 1. Populate organizations table with actual data from campaigns
INSERT OR IGNORE INTO organizations (classy_id, name, status, description, created_at, updated_at, last_sync_at)
SELECT DISTINCT 
    '64531', 
    'Eden Projects', 
    'active',
    'Environmental restoration and reforestation organization',
    datetime('now'), 
    datetime('now'), 
    datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE classy_id = '64531');

-- 2. Update campaigns to reference the proper organization
UPDATE campaigns 
SET organization_id = (
    SELECT id FROM organizations WHERE classy_id = '64531'
)
WHERE organization_id IS NULL;

-- 3. Create campaign performance view for fast analytics
CREATE VIEW IF NOT EXISTS campaign_performance AS
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
GROUP BY c.id, c.classy_id, c.name, c.status, c.campaign_type, c.goal, c.start_date, c.end_date, c.created_at, c.updated_at;

-- 4. Create supporter summary view for fast supporter analytics
CREATE VIEW IF NOT EXISTS supporter_summary AS
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
    COALESCE(rp_stats.active_recurring_plans, 0) as active_recurring_plans,
    COALESCE(rp_stats.total_monthly_recurring, 0) as monthly_recurring_amount,
    CASE 
        WHEN s.lifetime_donation_amount >= 1000 THEN 'Major Donor'
        WHEN s.lifetime_donation_amount >= 100 THEN 'Regular Donor'
        WHEN s.lifetime_donation_amount > 0 THEN 'Small Donor'
        ELSE 'Prospect'
    END as donor_segment,
    CASE 
        WHEN s.last_donation_date >= date('now', '-30 days') THEN 'Recent'
        WHEN s.last_donation_date >= date('now', '-90 days') THEN 'Active'
        WHEN s.last_donation_date >= date('now', '-365 days') THEN 'Lapsed'
        WHEN s.last_donation_date IS NOT NULL THEN 'Dormant'
        ELSE 'Never Donated'
    END as engagement_status,
    s.created_at,
    s.last_sync_at
FROM supporters s
LEFT JOIN (
    SELECT 
        rp.supporter_id,
        COUNT(CASE WHEN rp.status = 'active' THEN 1 END) as active_recurring_plans,
        SUM(CASE WHEN rp.status = 'active' THEN rp.amount ELSE 0 END) as total_monthly_recurring
    FROM recurring_plans rp
    GROUP BY rp.supporter_id
) rp_stats ON s.id = rp_stats.supporter_id;

-- 5. Create indexes for improved query performance
CREATE INDEX IF NOT EXISTS idx_transactions_status_amount ON transactions(status, gross_amount);
CREATE INDEX IF NOT EXISTS idx_transactions_purchased_date ON transactions(date(purchased_at));
CREATE INDEX IF NOT EXISTS idx_supporters_lifetime_amount ON supporters(lifetime_donation_amount);
CREATE INDEX IF NOT EXISTS idx_supporters_last_donation_date ON supporters(date(last_donation_date));
CREATE INDEX IF NOT EXISTS idx_campaigns_goal ON campaigns(goal);
CREATE INDEX IF NOT EXISTS idx_campaigns_type_status ON campaigns(campaign_type, status);
CREATE INDEX IF NOT EXISTS idx_recurring_plans_status_amount ON recurring_plans(status, amount);

-- 6. Update campaigns total_raised from actual transaction data
UPDATE campaigns 
SET total_raised = (
    SELECT COALESCE(SUM(t.gross_amount), 0)
    FROM transactions t 
    WHERE t.campaign_id = campaigns.id 
    AND t.status = 'success'
),
donor_count = (
    SELECT COALESCE(COUNT(DISTINCT t.supporter_id), 0)
    FROM transactions t 
    WHERE t.campaign_id = campaigns.id 
    AND t.status = 'success'
    AND t.supporter_id IS NOT NULL
);

-- Insert this migration record
INSERT OR IGNORE INTO migrations (version, name) 
VALUES ('003', 'enhance_performance_and_relationships');