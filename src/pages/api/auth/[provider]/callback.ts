import type { APIRoute } from "astro";
import { getProvider, verifyState, exchangeCode, allowedEmails, sanitizeNext } from "../../../../lib/oauth";
import { createSessionCookie } from "../../../../lib/auth";

export const prerender = false;

// GET /api/auth/:provider/callback — finish the OAuth flow:
// verify state → exchange code → check allow-list → issue session cookie.
export const GET: APIRoute = async ({ params, url, request }) => {
  const p = getProvider(params.provider!);
  if (!p) return new Response("provider not configured", { status: 404 });

  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code) return new Response("missing code", { status: 400 });

  // state = "<hex>.<base64 next path>"
  const dot = stateRaw?.indexOf(".") ?? -1;
  if (!stateRaw || dot < 0) return new Response("bad state", { status: 400 });
  const state = stateRaw.slice(0, dot);
  let next = "/editor/";
  try {
    next = sanitizeNext(atob(stateRaw.slice(dot + 1)));
  } catch {
    /* keep default */
  }

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
  // clear the one-shot state cookie
  headers.append("set-cookie", "me_oauth_state=; Path=/api/auth; HttpOnly; Secure; Max-Age=0");
  return new Response(null, { status: 302, headers });
};
