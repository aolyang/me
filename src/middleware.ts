// Middleware: gates /api/admin/* AND /editor pages behind the session
// cookie. Editor pages redirect to /login; APIs fail 401 (fetch clients).
import { isAdmin } from "./lib/auth";
import type { MiddlewareHandler } from "astro";

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { request, url } = context;

  if (url.pathname.startsWith("/api/admin") || url.pathname.startsWith("/editor")) {
    if (!(await isAdmin(request.headers.get("cookie")))) {
      if (url.pathname.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      // Page: bounce to login, remember destination.
      return context.redirect(`/login?next=${encodeURIComponent(url.pathname)}`, 302);
    }
  }

  return next();
};
