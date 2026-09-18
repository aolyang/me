// Publish pipeline.
//
// Publish = TWO effects, deliberately decoupled:
//   1. INSTANT: an immutable snapshot becomes public in D1 (served by
//      /notes/:id via SSR). This never fails because of GitHub.
//   2. EVENTUAL: a durable export job commits the snapshot to GitHub;
//      CI builds and the /posts/:slug static page appears. Failures mark
//      the job `failed` and are retried — the note stays public meanwhile.
//
// Unpublish = instant tombstone in D1 + a delete job removing the repo file.

import { db, getNote, nowIso } from "./db";
import { putFile, deleteFile, notePath, noteFileContent } from "./github";
import { slugify } from "./slug";
import type { NoteExportFile, NoteRecord } from "./types";

export interface PublishResult {
  slug: string;
  publicRevision: number;
  draftRevision: number;
  jobStatus: "committed" | "failed";
  error?: string;
}

export async function publishNote(noteId: string): Promise<PublishResult | { error: string }> {
  const note = await getNote(noteId);
  if (!note || note.deleted_at) return { error: "note not found" };

  // Snapshot = current draft document + metadata, frozen at this revision.
  const slug = note.slug ?? await allocateSlug(note);
  const snapshotRevision = note.draft_revision;
  const publishedAt = note.published_at ?? nowIso();
  const snapshot: NoteExportFile = {
    schemaVersion: 1,
    noteId: note.id,
    slug,
    revision: snapshotRevision,
    title: note.title || "Untitled",
    publishedAt,
    document: JSON.parse(note.document),
  };
  const snapshotJson = JSON.stringify(snapshot.document);

  // Idempotency guard: republishing an unchanged draft is a no-op.
  if (note.visibility === "published" && note.public_revision === snapshotRevision) {
    return {
      slug: slug!,
      publicRevision: note.public_revision!,
      draftRevision: note.draft_revision,
      jobStatus: "committed",
    };
  }

  // 1) Atomic D1 transaction: publish the snapshot + record the export job.
  //    If anything below fails, the note is STILL public via /notes/:id.
  await db()
    .batch([
      db().prepare(
        `UPDATE notes SET slug = ?, public_revision = ?, public_snapshot = ?,
         visibility = 'published', published_at = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(slug, snapshotRevision, snapshotJson, publishedAt, nowIso(), noteId),
      db().prepare(
        `INSERT INTO publication_jobs (note_id, revision, action, status, created_at, updated_at)
         VALUES (?, ?, 'export', 'queued', ?, ?)`,
      ).bind(noteId, snapshotRevision, nowIso(), nowIso()),
      // Release this note's images for public reads (media:// keys appear
      // only in this note's document, so per-note flip is exact).
      db().prepare("UPDATE media SET public = 1 WHERE note_id = ?").bind(noteId),
    ]);

  // 2) Attempt the GitHub export inline. Failure -> job `failed`, retriable.
  const jobId = await lastJobId(noteId);
  const jobStatus = await runExportJob(jobId, noteId, snapshot, noteFileContent(snapshot));

  return {
    slug: slug!,
    publicRevision: snapshotRevision,
    draftRevision: snapshotRevision,
    jobStatus,
  } satisfies PublishResult;
}

export async function unpublishNote(noteId: string): Promise<{ ok: true } | { error: string }> {
  const note = await getNote(noteId);
  if (!note || note.deleted_at) return { error: "note not found" };
  if (note.visibility !== "published") return { error: "note is not published" };

  // Instant tombstone: hide from lists and /notes/:id immediately.
  await db()
    .prepare(
      `UPDATE notes SET visibility = 'unpublished', updated_at = ? WHERE id = ?`,
    )
    .bind(nowIso(), noteId)
    .run();

  // Only ever exported to the repo if it has a revision (i.e. was published).
  if (note.public_revision !== null) {
    await db()
      .prepare(
        `INSERT INTO publication_jobs (note_id, revision, action, status, created_at, updated_at)
         VALUES (?, ?, 'delete', 'queued', ?, ?)`,
      )
      .bind(noteId, note.public_revision, nowIso(), nowIso())
      .run();
    const jobId = await lastJobId(noteId);
    await runDeleteJob(jobId, noteId);
  }
  return { ok: true };
}

/** Retry failed jobs (editor button / editor load). */
export async function retryFailedJobs(noteId?: string): Promise<{ retried: number }> {
  const { results } = await db()
    .prepare(
      `SELECT id, note_id, action FROM publication_jobs
       WHERE status = 'failed' ${noteId ? "AND note_id = ?" : ""}
       ORDER BY id`,
    )
    .bind(...(noteId ? [noteId] : []))
    .all<{ id: number; note_id: string; action: string }>();
  let retried = 0;
  for (const job of results ?? []) {
    const note = await getNote(job.note_id);
    if (!note) continue;
    if (job.action === "export" && note.public_snapshot) {
      const snapshot: NoteExportFile = {
        schemaVersion: 1,
        noteId: note.id,
        slug: note.slug!,
        revision: note.public_revision!,
        title: note.title || "Untitled",
        publishedAt: note.published_at ?? nowIso(),
        document: JSON.parse(note.public_snapshot),
      };
      await runExportJob(job.id, note.id, snapshot, noteFileContent(snapshot));
      retried++;
    } else if (job.action === "delete") {
      await runDeleteJob(job.id, note.id);
      retried++;
    }
  }
  return { retried };
}

async function allocateSlug(note: NoteRecord): Promise<string> {
  const base = slugify(note.title || "note");
  // Slug is assigned at first publish and then immutable, so collisions with
  // future notes are impossible; only historical collisions matter, and a
  // single deterministic suffix resolves them.
  const existing = await db()
    .prepare("SELECT id FROM notes WHERE slug = ? AND id != ?")
    .bind(base, note.id)
    .first<{ id: string }>();
  return existing ? `${base}-${note.id.slice(0, 4)}` : base;
}

async function lastJobId(noteId: string): Promise<number> {
  const row = await db()
    .prepare("SELECT id FROM publication_jobs WHERE note_id = ? ORDER BY id DESC LIMIT 1")
    .bind(noteId)
    .first<{ id: number }>();
  if (!row) throw new Error("job row missing");
  return row.id;
}

async function runExportJob(
  jobId: number,
  noteId: string,
  snapshot: NoteExportFile,
  fileContent: string,
): Promise<"committed" | "failed"> {
  await db()
    .prepare("UPDATE publication_jobs SET status = 'committing', updated_at = ? WHERE id = ?")
    .bind(nowIso(), jobId)
    .run();
  try {
    const sha = await putFile(
      notePath(noteId),
      fileContent,
      `note(${noteId}): publish rev ${snapshot.revision} — ${snapshot.title}`,
    );
    await db()
      .prepare(
        "UPDATE publication_jobs SET status = 'committed', commit_sha = ?, updated_at = ? WHERE id = ?",
      )
      .bind(sha, nowIso(), jobId)
      .run();
    return "committed";
  } catch (err) {
    await db()
      .prepare("UPDATE publication_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .bind(String(err instanceof Error ? err.message : err).slice(0, 500), nowIso(), jobId)
      .run();
    return "failed";
  }
}

async function runDeleteJob(jobId: number, noteId: string): Promise<void> {
  await db()
    .prepare("UPDATE publication_jobs SET status = 'committing', updated_at = ? WHERE id = ?")
    .bind(nowIso(), jobId)
    .run();
  try {
    const sha = await deleteFile(notePath(noteId), `note(${noteId}): unpublish`);
    await db()
      .prepare(
        "UPDATE publication_jobs SET status = 'committed', commit_sha = ?, updated_at = ? WHERE id = ?",
      )
      .bind(sha, nowIso(), jobId)
      .run();
  } catch (err) {
    await db()
      .prepare("UPDATE publication_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .bind(String(err instanceof Error ? err.message : err).slice(0, 500), nowIso(), jobId)
      .run();
  }
}
