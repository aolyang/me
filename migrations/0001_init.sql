-- Initial schema for notes, publication jobs, media, and comments.
CREATE TABLE notes (
  id TEXT PRIMARY KEY,              -- stable nanoid, used in /notes/:id and contentId
  title TEXT NOT NULL DEFAULT '',
  slug TEXT,                        -- assigned at first publish, then immutable
  document TEXT NOT NULL,           -- TipTap JSON, working draft
  plain_text TEXT NOT NULL DEFAULT '',
  draft_revision INTEGER NOT NULL DEFAULT 1,
  public_revision INTEGER,          -- revision of current public snapshot (NULL = never published)
  public_snapshot TEXT,             -- immutable TipTap JSON snapshot currently public
  visibility TEXT NOT NULL DEFAULT 'draft',  -- draft | published | unpublished
  published_at TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_notes_visibility ON notes(visibility, updated_at DESC);

CREATE TABLE publication_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,             -- export | delete
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | committing | committed | failed
  commit_sha TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_jobs_pending ON publication_jobs(status, updated_at);

CREATE TABLE media (
  key TEXT PRIMARY KEY,             -- notes/<noteId>/<nanoid>.<ext> (immutable keys)
  note_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id TEXT NOT NULL,         -- note id or post frontmatter commentId
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,               -- plain text only, escaped on display
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  ip_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_comments_content ON comments(content_id, status, created_at);
