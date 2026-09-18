// Shared types for note documents and API payloads.

export interface NoteDoc {
  type: "doc";
  content?: unknown[];
  [key: string]: unknown;
}

export interface NoteRecord {
  id: string;
  title: string;
  slug: string | null;
  document: string; // serialized NoteDoc
  plain_text: string;
  draft_revision: number;
  public_revision: number | null;
  public_snapshot: string | null;
  visibility: "draft" | "published" | "unpublished";
  published_at: string | null;
  updated_at: string;
  deleted_at: string | null;
}

// Shape of the JSON file committed to content/notes/<noteId>.json.
export interface NoteExportFile {
  schemaVersion: 1;
  noteId: string;
  slug: string;
  revision: number;
  title: string;
  publishedAt: string;
  document: NoteDoc;
}

export interface NoteSummary {
  id: string;
  title: string;
  slug: string | null;
  visibility: NoteRecord["visibility"];
  draftRevision: number;
  publicRevision: number | null;
  updatedAt: string;
  publishedAt: string | null;
  /** latest non-committed / failed export job, for editor status display */
  job: { id: number; status: string; action: string; error: string | null } | null;
}
