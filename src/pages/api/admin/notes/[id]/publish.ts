import type { APIRoute } from "astro";
import { publishNote, unpublishNote } from "../../../../../lib/publish";

export const prerender = false;

// POST /api/admin/notes/:id/publish           — publish / republish
// POST /api/admin/notes/:id/publish {action:"unpublish"} — unpublish
export const POST: APIRoute = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  if ((body as { action?: string }).action === "unpublish") {
    const result = await unpublishNote(params.id!);
    if ("error" in result) return Response.json(result, { status: 409 });
    return Response.json(result);
  }
  const result = await publishNote(params.id!);
  if ("error" in result) return Response.json(result, { status: 409 });
  return Response.json(result);
};
