import type { APIRoute } from "astro";
import { nanoid } from "nanoid";
import { db, listNotes, latestJob, toSummary, nowIso } from "../../../../lib/db";

export const prerender = false;

// GET /api/admin/notes — list all notes (editor home)
export const GET: APIRoute = async () => {
  const notes = await listNotes();
  const summaries = await Promise.all(
    notes.map(async (n) => toSummary(n, await latestJob(n.id))),
  );
  return Response.json(summaries);
};

// POST /api/admin/notes — create a new empty note
export const POST: APIRoute = async () => {
  const id = nanoid(12);
  const now = nowIso();
  await db()
    .prepare(
      `INSERT INTO notes (id, title, document, plain_text, updated_at)
       VALUES (?, '', ?, '', ?)`,
    )
    .bind(id, JSON.stringify({ type: "doc", content: [] }), now)
    .run();
  const note = {
    id,
    title: "",
    slug: null,
    document: '{"type":"doc","content":[]}',
    plain_text: "",
    draft_revision: 1,
    public_revision: null,
    public_snapshot: null,
    visibility: "draft" as const,
    published_at: null,
    updated_at: now,
    deleted_at: null,
  };
  return Response.json(note, { status: 201 });
};
