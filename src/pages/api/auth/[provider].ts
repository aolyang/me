import type { APIRoute } from "astro";
import { getProvider, makeState, stateCookie, sanitizeNext } from "../../../lib/oauth";

export const prerender = false;

// GET /api/auth/:provider — start the OAuth flow.
// ?next= is preserved through the round-trip (path-only, validated).
export const GET: APIRoute = async ({ params, url }) => {
  const p = getProvider(params.provider!);
  if (!p) return new Response("provider not configured", { status: 404 });

  const next = sanitizeNext(url.searchParams.get("next"));
  const state = makeState();

  const authUrl = new URL(p.authUrl);
  authUrl.searchParams.set("client_id", p.clientId);
  authUrl.searchParams.set("redirect_uri", `${url.origin}/api/auth/${p.id}/callback`);
  authUrl.searchParams.set("scope", p.scope);
  authUrl.searchParams.set("state", `${state}.${btoa(next)}`);

  const headers = new Headers({ location: authUrl.toString() });
  headers.append("set-cookie", await stateCookie(state));
  return new Response(null, { status: 302, headers });
};
