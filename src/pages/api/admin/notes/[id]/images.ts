import type { APIRoute } from "astro";
import { nanoid } from "nanoid";
import { db, getNote, nowIso } from "../../../../../lib/db";
import { runtimeEnv } from "../../../../../lib/env";

export const prerender = false;

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

// POST /api/admin/notes/:id/images — multipart upload → R2.
// Returns { src: "media://notes/<noteId>/<id>.<ext>" } for the editor.
export const POST: APIRoute = async ({ params, request }) => {
  const note = await getNote(params.id!);
  if (!note || note.deleted_at) return new Response("note not found", { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file field required" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return Response.json({ error: `unsupported type ${file.type}` }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "image exceeds 10MB" }, { status: 413 });
  }

  const id = nanoid(10);
  const key = `notes/${note.id}/${id}.${EXT[file.type]}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Immutable object key: uploading again produces a NEW key, never mutates
  // bytes under an existing (possibly already-published) URL.
  await runtimeEnv.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: file.type },
  });

  await db()
    .prepare("INSERT INTO media (key, note_id, mime, size, public, created_at) VALUES (?, ?, ?, ?, 0, ?)")
    .bind(key, note.id, file.type, file.size, nowIso())
    .run();

  return Response.json({ src: `media://${key}` }, { status: 201 });
};
