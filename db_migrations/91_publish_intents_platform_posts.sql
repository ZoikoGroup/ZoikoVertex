-- Per-platform post IDs returned by the social APIs after publishing.
-- Each entry: { platform, account_id, post_id, kind?, matched?, saved_at }.
-- Used by the Workflows "Published Content" detail view to fetch live post metadata
-- (permalink, media, timestamp) from Meta. platform_post_id stays for campaign boosts.
ALTER TABLE publish_intents
  ADD COLUMN IF NOT EXISTS platform_posts JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
