DROP INDEX IF EXISTS users_firebase_uid_unique_idx;

ALTER TABLE users
  DROP COLUMN IF EXISTS firebase_uid;
