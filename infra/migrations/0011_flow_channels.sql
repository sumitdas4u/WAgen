-- Add channel column to flows table
-- channel: 'web' | 'qr' | 'api'
ALTER TABLE flows ADD COLUMN IF NOT EXISTS channel VARCHAR(10) NOT NULL DEFAULT 'api';
