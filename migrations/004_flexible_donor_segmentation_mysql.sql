-- Migration: 004_flexible_donor_segmentation (MySQL Compatible)
-- Description: Create flexible, configurable donor segmentation

-- 1. Create donor segmentation configuration table
CREATE TABLE IF NOT EXISTS donor_segmentation_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    organization_id INT,
    segment_type VARCHAR(50) NOT NULL,
    segment_name VARCHAR(100) NOT NULL,
    min_amount DECIMAL(10,2),
    max_amount DECIMAL(10,2),
    min_count INT,
    max_count INT,
    days_threshold INT,
    description TEXT,
    color_code VARCHAR(7),
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (organization_id) REFERENCES organizations(id),
    UNIQUE KEY unique_segment (organization_id, segment_type, segment_name),
    INDEX idx_org_type (organization_id, segment_type),
    INDEX idx_amounts (min_amount, max_amount),
    INDEX idx_counts (min_count, max_count)
);

-- Insert this migration record
INSERT IGNORE INTO migrations (version, name) 
VALUES ('004', 'flexible_donor_segmentation');