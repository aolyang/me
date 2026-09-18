import type { APIRoute } from "astro";
import { db } from "../../../../lib/db";

export const prerender = false;

// GET /api/admin/comments — moderation queue (pending first)
export const GET: APIRoute = async () => {
  const { results } = await db()
    .prepare(
      `SELECT id, content_id, author_name, body, status, created_at FROM comments
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 200`,
    )
    .all<{ id: number; content_id: string; author_name: string; body: string; status: string; created_at: string }>();
  return Response.json({ comments: results ?? [] });
};

// POST /api/admin/comments/:id/moderate — approve/reject handled at [id]/moderate.ts
