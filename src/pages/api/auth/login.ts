import type { APIRoute } from "astro";
import { checkPassword, createSessionCookie, AUTH_DISABLED_LOCALLY } from "../../../lib/auth";

export const prerender = false;

// POST /api/auth/login  { password } → sets a 30-day signed cookie.
export const POST: APIRoute = async ({ request }) => {
  if (AUTH_DISABLED_LOCALLY) {
    return Response.json({ ok: true, note: "no AUTH_PASSWORD configured — open" });
  }

  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  if (!body?.password || !(await checkPassword(body.password))) {
    // Constant-ish delay blunts online brute force; real mitigation is a
    // long random password (documented in README).
    await new Promise((r) => setTimeout(r, 500));
    return Response.json({ error: "wrong password" }, { status: 401 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": await createSessionCookie(),
    },
  });
};
