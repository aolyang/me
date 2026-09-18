// D1 access helpers. Bindings come from cloudflare:workers via lib/env.ts
// (Astro 7 removed locals.runtime.env).
import { runtimeEnv } from "./env";
import type { NoteRecord, NoteSummary } from "./types";

export function db(): D1Database {
  return runtimeEnv.DB;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function getNote(id: string): Promise<NoteRecord | null> {
  const row = await db()
    .prepare("SELECT * FROM notes WHERE id = ?")
    .bind(id)
    .first<NoteRecord>();
  return row ?? null;
}

export async function listNotes(includeDeleted = false): Promise<NoteRecord[]> {
  const sql = includeDeleted
    ? "SELECT * FROM notes ORDER BY updated_at DESC"
    : "SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC";
  const { results } = await db().prepare(sql).all<NoteRecord>();
  return results ?? [];
}

export async function latestJob(noteId: string): Promise<NoteSummary["job"]> {
  const row = await db()
    .prepare(
      `SELECT id, status, action, error FROM publication_jobs
       WHERE note_id = ? AND status != 'committed'
       ORDER BY id DESC LIMIT 1`,
    )
    .bind(noteId)
    .first<{ id: number; status: string; action: string; error: string | null }>();
  return row ?? null;
}

export function toSummary(note: NoteRecord, job: NoteSummary["job"] = null): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    slug: note.slug,
    visibility: note.visibility,
    draftRevision: note.draft_revision,
    publicRevision: note.public_revision,
    updatedAt: note.updated_at,
    publishedAt: note.published_at,
    job,
  };
}
