import type { APIRoute } from "astro";
import { clearSessionCookie } from "../../../lib/auth";

export const prerender = false;

// POST /api/auth/logout — clear the session cookie
export const POST: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": clearSessionCookie() },
  });
};
