import type { APIRoute } from "astro";
import { retryFailedJobs } from "../../../../lib/publish";

export const prerender = false;

// POST /api/admin/jobs/retry — retry all failed export/delete jobs
// (wired to a button in the editor list and fired on editor load).
export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const noteId = (body as { noteId?: string }).noteId;
  const result = await retryFailedJobs(typeof noteId === "string" ? noteId : undefined);
  return Response.json(result);
};
