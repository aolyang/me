import type { APIRoute } from "astro";
import { getProvider, makeState, stateCookie, sanitizeNext } from "../../../lib/oauth";

export const prerender = false;

// GET /api/auth/github?next=/editor/ — start the admin OAuth flow.
// State carries "<hex>|admin|nextPath" through GitHub's round-trip.
export const GET: APIRoute = async ({ url }) => {
  const p = getProvider();
  if (!p) return new Response("github oauth not configured", { status: 404 });

  const next = sanitizeNext(url.searchParams.get("next"));
  const state = makeState();

  const authUrl = new URL(p.authUrl);
  authUrl.searchParams.set("client_id", p.clientId);
  authUrl.searchParams.set("redirect_uri", `${url.origin}/api/auth/${p.id}/callback`);
  authUrl.searchParams.set("scope", p.scope);
  authUrl.searchParams.set("state", `${state}|admin|${next}`);

  const headers = new Headers({ location: authUrl.toString() });
  headers.append("set-cookie", await stateCookie(state));
  return new Response(null, { status: 302, headers });
};
