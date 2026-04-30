-- Add default header media URL to message_templates
-- This stores a persistent public URL (Supabase) for the template's header image/video/document.
-- Used as the default media when dispatching the template from any channel (broadcast, sequence, flow, webhook).
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS header_media_url TEXT;
