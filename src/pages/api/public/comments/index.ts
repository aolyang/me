import type { APIRoute } from "astro";
import { db, nowIso } from "../../../../lib/db";
import { verifyTurnstile } from "../../../../lib/turnstile";
import { runtimeEnv } from "../../../../lib/env";

export const prerender = false;

// GET /api/public/comments?contentId=... — approved comments, oldest first
export const GET: APIRoute = async ({ url }) => {
  const contentId = url.searchParams.get("contentId");
  if (!contentId || contentId.length > 100) {
    return Response.json({ error: "contentId required" }, { status: 400 });
  }
  const { results } = await db()
    .prepare(
      `SELECT id, author_name, body, created_at FROM comments
       WHERE content_id = ? AND status = 'approved' ORDER BY created_at ASC LIMIT 200`,
    )
    .bind(contentId)
    .all<{ id: number; author_name: string; body: string; created_at: string }>();
  return Response.json({ comments: results ?? [] });
};

// POST /api/public/comments — anonymous submission (Turnstile-verified,
// held for approval). Body: { contentId, name, body, turnstileToken }
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const payload = (await request.json().catch(() => null)) as
    | { contentId?: string; name?: string; body?: string; turnstileToken?: string }
    | null;
  if (!payload?.contentId || !payload.body?.trim()) {
    return Response.json({ error: "contentId and body required" }, { status: 400 });
  }
  if (payload.body.length > 5000 || (payload.name ?? "").length > 80) {
    return Response.json({ error: "too long" }, { status: 413 });
  }

  if (!(await verifyTurnstile(payload.turnstileToken, clientAddress))) {
    return Response.json({ error: "captcha verification failed" }, { status: 403 });
  }

  // Hash the IP for rate limiting / spam forensics; never store it raw.
  const ipHash = clientAddress
    ? Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientAddress + (runtimeEnv.TURNSTILE_SECRET ?? "salt"))),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : null;

  // Simple rate limit: max 5 comments per IP hash per hour.
  const recent = await db()
    .prepare(
      `SELECT COUNT(*) AS n FROM comments
       WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`,
    )
    .bind(ipHash)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5) {
    return Response.json({ error: "too many comments; try later" }, { status: 429 });
  }

  await db()
    .prepare(
      `INSERT INTO comments (content_id, author_name, body, status, ip_hash, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      payload.contentId,
      (payload.name ?? "").trim().slice(0, 80),
      payload.body.trim(),
      ipHash,
      nowIso(),
    )
    .run();

  return Response.json({ ok: true, moderation: "pending" }, { status: 201 });
};
