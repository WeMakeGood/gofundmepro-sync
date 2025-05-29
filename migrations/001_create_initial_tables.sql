-- Migration: 001_create_initial_tables
-- Description: Create initial database tables for Classy data synchronization

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    status VARCHAR(50),
    description TEXT,
    website VARCHAR(255),
    custom_fields TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_organizations_classy_id ON organizations(classy_id);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);

-- Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    organization_id INTEGER,
    name VARCHAR(255),
    status VARCHAR(50),
    goal DECIMAL(10,2),
    total_raised DECIMAL(10,2),
    donor_count INTEGER,
    campaign_type VARCHAR(50),
    start_date DATETIME,
    end_date DATETIME,
    custom_fields TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_classy_id ON campaigns(classy_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_organization ON campaigns(organization_id);

-- Supporters table
CREATE TABLE IF NOT EXISTS supporters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    email_address VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    postal_code VARCHAR(20),
    country VARCHAR(2),
    lifetime_donation_amount DECIMAL(10,2),
    lifetime_donation_count INTEGER,
    first_donation_date DATETIME,
    last_donation_date DATETIME,
    custom_fields TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    sync_status VARCHAR(50)
);

CREATE INDEX IF NOT EXISTS idx_supporters_email ON supporters(email_address);
CREATE INDEX IF NOT EXISTS idx_supporters_classy_id ON supporters(classy_id);
CREATE INDEX IF NOT EXISTS idx_supporters_sync_status ON supporters(sync_status, last_sync_at);
CREATE INDEX IF NOT EXISTS idx_supporters_last_donation ON supporters(last_donation_date);

-- Recurring donation plans table
CREATE TABLE IF NOT EXISTS recurring_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    supporter_id INTEGER,
    campaign_id INTEGER,
    status VARCHAR(50),
    frequency VARCHAR(50),
    amount DECIMAL(10,2),
    currency VARCHAR(3),
    next_payment_date DATE,
    cancellation_date DATETIME,
    cancellation_reason TEXT,
    lifetime_value DECIMAL(10,2),
    payment_count INTEGER,
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    FOREIGN KEY (supporter_id) REFERENCES supporters(id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_recurring_plans_classy_id ON recurring_plans(classy_id);
CREATE INDEX IF NOT EXISTS idx_recurring_plans_status ON recurring_plans(status);
CREATE INDEX IF NOT EXISTS idx_recurring_plans_next_payment ON recurring_plans(next_payment_date);
CREATE INDEX IF NOT EXISTS idx_recurring_plans_supporter ON recurring_plans(supporter_id);
CREATE INDEX IF NOT EXISTS idx_recurring_plans_campaign ON recurring_plans(campaign_id);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    supporter_id INTEGER,
    campaign_id INTEGER,
    recurring_plan_id INTEGER,
    transaction_type VARCHAR(50),
    status VARCHAR(50),
    payment_method VARCHAR(50),
    gross_amount DECIMAL(10,2),
    fee_amount DECIMAL(10,2),
    net_amount DECIMAL(10,2),
    currency VARCHAR(3),
    purchased_at DATETIME,
    refunded_at DATETIME,
    custom_fields TEXT,
    question_responses TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    FOREIGN KEY (supporter_id) REFERENCES supporters(id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY (recurring_plan_id) REFERENCES recurring_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_classy_id ON transactions(classy_id);
CREATE INDEX IF NOT EXISTS idx_transactions_supporter ON transactions(supporter_id);
CREATE INDEX IF NOT EXISTS idx_transactions_campaign ON transactions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_transactions_purchased_at ON transactions(purchased_at);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type);

-- Fundraising teams table
CREATE TABLE IF NOT EXISTS fundraising_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    campaign_id INTEGER,
    name VARCHAR(255),
    description TEXT,
    goal DECIMAL(10,2),
    total_raised DECIMAL(10,2),
    member_count INTEGER,
    status VARCHAR(50),
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
);

CREATE INDEX IF NOT EXISTS idx_fundraising_teams_classy_id ON fundraising_teams(classy_id);
CREATE INDEX IF NOT EXISTS idx_fundraising_teams_campaign ON fundraising_teams(campaign_id);

-- Fundraising pages table
CREATE TABLE IF NOT EXISTS fundraising_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classy_id VARCHAR(255) UNIQUE NOT NULL,
    campaign_id INTEGER,
    team_id INTEGER,
    supporter_id INTEGER,
    title VARCHAR(255),
    goal DECIMAL(10,2),
    total_raised DECIMAL(10,2),
    status VARCHAR(50),
    created_at DATETIME,
    updated_at DATETIME,
    last_sync_at DATETIME,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY (team_id) REFERENCES fundraising_teams(id),
    FOREIGN KEY (supporter_id) REFERENCES supporters(id)
);

CREATE INDEX IF NOT EXISTS idx_fundraising_pages_classy_id ON fundraising_pages(classy_id);
CREATE INDEX IF NOT EXISTS idx_fundraising_pages_campaign ON fundraising_pages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_fundraising_pages_team ON fundraising_pages(team_id);
CREATE INDEX IF NOT EXISTS idx_fundraising_pages_supporter ON fundraising_pages(supporter_id);

-- Sync jobs tracking table
CREATE TABLE IF NOT EXISTS sync_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type VARCHAR(50),
    entity_type VARCHAR(50),
    status VARCHAR(50),
    started_at DATETIME,
    completed_at DATETIME,
    records_processed INTEGER,
    records_failed INTEGER,
    error_message TEXT,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status, started_at);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_entity_type ON sync_jobs(entity_type);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_completed ON sync_jobs(completed_at);

-- Migration tracking table
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255),
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert this migration record
INSERT OR IGNORE INTO migrations (version, name) 
VALUES ('001', 'create_initial_tables');