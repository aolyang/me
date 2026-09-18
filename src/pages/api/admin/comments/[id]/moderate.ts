import type { APIRoute } from "astro";
import { db } from "../../../../../lib/db";

export const prerender = false;

// POST /api/admin/comments/:id/moderate  { action: "approve" | "reject" }
export const POST: APIRoute = async ({ params, request }) => {
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;
  if (action !== "approve" && action !== "reject") {
    return Response.json({ error: "action must be approve or reject" }, { status: 400 });
  }
  const status = action === "approve" ? "approved" : "rejected";
  const res = await db()
    .prepare("UPDATE comments SET status = ? WHERE id = ?")
    .bind(status, params.id!)
    .run();
  if (res.meta.changes === 0) return new Response("not found", { status: 404 });
  return Response.json({ ok: true, status });
};
