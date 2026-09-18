import type { APIRoute } from "astro";
import { db, getNote, nowIso } from "../../../../lib/db";

export const prerender = false;

// GET /api/admin/notes/:id — full record for the editor
export const GET: APIRoute = async ({ params }) => {
  const note = await getNote(params.id!);
  if (!note || note.deleted_at) return new Response("not found", { status: 404 });
  return Response.json(note);
};

// PATCH /api/admin/notes/:id — autosave with optimistic concurrency.
// Body: { expectedRevision, title?, document? }
export const PATCH: APIRoute = async ({ params, request }) => {
  const body = (await request.json().catch(() => null)) as
    | { expectedRevision?: number; title?: string; document?: unknown }
    | null;
  if (!body || typeof body.expectedRevision !== "number" || !body.document) {
    return Response.json({ error: "expectedRevision and document required" }, { status: 400 });
  }

  const note = await getNote(params.id!);
  if (!note || note.deleted_at) return new Response("not found", { status: 404 });

  if (note.draft_revision !== body.expectedRevision) {
    return Response.json(
      {
        error: "conflict",
        currentRevision: note.draft_revision,
        hint: "another session saved newer changes; reload",
      },
      { status: 409 },
    );
  }

  const title = typeof body.title === "string" ? body.title : note.title;
  const docJson = JSON.stringify(body.document);
  const plain = extractText(body.document);
  const now = nowIso();

  await db()
    .prepare(
      `UPDATE notes SET title = ?, document = ?, plain_text = ?,
       draft_revision = draft_revision + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(title, docJson, plain, now, params.id!)
    .run();

  return Response.json({ ok: true, revision: note.draft_revision + 1 });
};

// DELETE /api/admin/notes/:id — soft delete the working draft.
// A published note requires explicit unpublish first (see publish.ts).
export const DELETE: APIRoute = async ({ params }) => {
  const note = await getNote(params.id!);
  if (!note || note.deleted_at) return new Response("not found", { status: 404 });
  if (note.visibility === "published") {
    return Response.json(
      { error: "note is public — unpublish before deleting" },
      { status: 409 },
    );
  }
  await db()
    .prepare("UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .bind(nowIso(), nowIso(), params.id!)
    .run();
  return Response.json({ ok: true });
};

// Minimal plain-text extraction from a TipTap doc (used for search/lists).
function extractText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (!Array.isArray(n.content)) return "";
  return n.content.map(extractText).join("").slice(0, 20000);
}
