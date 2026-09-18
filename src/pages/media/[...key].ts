import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import { runtimeEnv } from "../../lib/env";
import { isAdmin } from "../../lib/auth";

export const prerender = false;

// GET /media/notes/<noteId>/<file> — R2 delivery with privacy rules:
//   public=1  → anyone, immutable caching
//   public=0  → draft media: requires author (Access JWT)
export const GET: APIRoute = async ({ params, request }) => {
  const key = params.key;
  if (!key || !/^notes\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(key)) {
    return new Response("not found", { status: 404 });
  }

  const row = await db()
    .prepare("SELECT public, mime FROM media WHERE key = ?")
    .bind(key)
    .first<{ public: number; mime: string }>();

  if (!row) return new Response("not found", { status: 404 });

  if (!row.public) {
    const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!(await isAdmin(jwt))) {
      return new Response("unauthorized", { status: 401 });
    }
  }

  const obj = await runtimeEnv.MEDIA.get(key);
  if (!obj) return new Response("not found", { status: 404 });

  const headers = new Headers();
  headers.set("content-type", obj.httpMetadata?.contentType ?? row.mime);
  headers.set("cache-control", row.public ? "public, max-age=31536000, immutable" : "private, no-store");
  headers.set("etag", obj.httpEtag);

  return new Response(obj.body, { headers });
};
