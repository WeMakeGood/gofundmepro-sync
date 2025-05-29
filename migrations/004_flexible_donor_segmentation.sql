-- Migration: 004_flexible_donor_segmentation
-- Description: Create flexible, configurable donor segmentation

-- 1. Create donor segmentation configuration table
CREATE TABLE IF NOT EXISTS donor_segmentation_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER,
    segment_type VARCHAR(50) NOT NULL,
    segment_name VARCHAR(100) NOT NULL,
    min_amount DECIMAL(10,2),
    max_amount DECIMAL(10,2),
    min_count INTEGER,
    max_count INTEGER,
    days_threshold INTEGER,
    description TEXT,
    color_code VARCHAR(7),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Insert this migration record
INSERT OR IGNORE INTO migrations (version, name) 
VALUES ('004', 'flexible_donor_segmentation');