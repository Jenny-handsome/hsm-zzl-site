ALTER TABLE access_keys ADD COLUMN key_secret TEXT;

-- Existing keys created before this migration cannot recover their full secret
-- because only hashes were stored. Reset those keys in the admin panel if needed.
