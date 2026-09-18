// Middleware: copies the Cloudflare Access JWT header for lib/auth.ts, and
// rejects unauthenticated admin API calls with 401. Editor PAGES are not
// gated here — Cloudflare Access protects them at the edge (see README);
// the APIs double-check the JWT so a mis-configured Access app fails closed.
import { isAdmin } from "./lib/auth";
import type { MiddlewareHandler } from "astro";

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { request, locals, url } = context;
  const accessJwt = request.headers.get("Cf-Access-Jwt-Assertion");
  (locals as { accessJwt?: string | null }).accessJwt = accessJwt;

  if (url.pathname.startsWith("/api/admin") && !(await isAdmin(accessJwt))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  return next();
};
