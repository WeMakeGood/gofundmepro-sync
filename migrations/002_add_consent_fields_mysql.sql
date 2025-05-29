-- Migration: 002_add_consent_fields (MySQL Compatible)
-- Description: Add consent and communication preference fields to supporters table

-- Add consent and communication tracking fields to supporters table
ALTER TABLE supporters ADD COLUMN email_opt_in BOOLEAN DEFAULT NULL;
ALTER TABLE supporters ADD COLUMN sms_opt_in BOOLEAN DEFAULT NULL;
ALTER TABLE supporters ADD COLUMN last_email_consent_date TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE supporters ADD COLUMN last_sms_consent_date TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE supporters ADD COLUMN last_emailed_at TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE supporters ADD COLUMN communication_preferences TEXT DEFAULT NULL;

-- Add indexes for consent fields (useful for filtering opt-in lists)
CREATE INDEX IF NOT EXISTS idx_supporters_email_opt_in ON supporters(email_opt_in);
CREATE INDEX IF NOT EXISTS idx_supporters_sms_opt_in ON supporters(sms_opt_in);
CREATE INDEX IF NOT EXISTS idx_supporters_email_consent_date ON supporters(last_email_consent_date);
CREATE INDEX IF NOT EXISTS idx_supporters_sms_consent_date ON supporters(last_sms_consent_date);

-- Insert this migration record
INSERT IGNORE INTO migrations (version, name) 
VALUES ('002', 'add_consent_fields');