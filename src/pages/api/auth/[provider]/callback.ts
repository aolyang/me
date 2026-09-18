import type { APIRoute } from "astro";
import { getProvider, verifyState, exchangeCode, allowedEmails, sanitizeNext } from "../../../../lib/oauth";
import { createSessionCookie } from "../../../../lib/auth";

export const prerender = false;

// GET /api/auth/github/callback — verify state → exchange code →
// AUTHOR_EMAILS allow-list → 30-day admin session cookie.
export const GET: APIRoute = async ({ url, request }) => {
  const p = getProvider();
  if (!p) return new Response("github oauth not configured", { status: 404 });

  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code) return new Response("missing code", { status: 400 });

  // state = "<hex>|admin|nextPath"
  const parts = stateRaw?.split("|") ?? [];
  if (parts.length !== 3) return new Response("bad state", { status: 400 });
  const [state, , nextRaw] = parts;
  const next = sanitizeNext(nextRaw);

  if (!(await verifyState(request.headers.get("cookie"), state))) {
    return new Response("state mismatch — retry login", { status: 403 });
  }

  let user;
  try {
    user = await exchangeCode(p, code, `${url.origin}/api/auth/${p.id}/callback`);
  } catch (err) {
    return new Response(`oauth failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
  }

  const allowed = allowedEmails();
  if (allowed.length > 0 && !allowed.includes(user.email)) {
    return new Response(`account ${user.email} is not the site author`, { status: 403 });
  }

  const headers = new Headers({ location: next });
  headers.append("set-cookie", await createSessionCookie());
  headers.append("set-cookie", "me_oauth_state=; Path=/api/auth; HttpOnly; Secure; Max-Age=0");
  return new Response(null, { status: 302, headers });
};
