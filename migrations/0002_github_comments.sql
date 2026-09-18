-- GitHub-backed comment identities.
ALTER TABLE comments ADD COLUMN github_login TEXT;
ALTER TABLE comments ADD COLUMN avatar_url TEXT;
